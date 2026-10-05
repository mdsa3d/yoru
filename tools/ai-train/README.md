# ai-train — behaviour cloning for the rival policy net (UPLIFT-PLAN B4)

> **Resuming this work? Read `RESUME.md` first** (2026-10-05 handoff: bands, file
> locations, GPU vs CPU split, open diagnosis). Status: not shipped.

NumPy-only trainer that turns recorded telemetry into JSON weights loadable by
`src/mlp.js`. Everything runs **inside podman/docker only** — never on the host.

## Build

```sh
podman build -t neon-ai-train -f tools/ai-train/Containerfile .   # docker: same
```

On a network with TLS interception (corporate proxy), pip inside the build will
fail certificate verification. Drop the proxy's root CA as a `.crt` file into
`tools/ai-train/docker-ca/` before building — the Containerfile trusts it via
`update-ca-certificates`. The directory ships empty; verification is never
disabled. (On macOS, export from the login/system keychain, e.g.
`security find-certificate -c "<Proxy Root CA>" -p > tools/ai-train/docker-ca/proxy.crt`.)
Remove the `.crt` again after building; it is machine-local configuration.

## Telemetry schema (settled, 3.17.0; obs widened to v2 in 3.20.0)

ONE canonical schema, shared by `src/telemetry.js`, `tools/gen-dataset.mjs` and
`parse_line()` — one JSON object per recorded step:

```json
{"obs": [50 floats],
 "input": {"steer": 0.0, "throttle": 0.0, "brake": 0.0},
 "tactic": "race",
 "tacticDetail": {"encounter": "pressure", "director": "block", "rivals": ["block"]},
 "world": "akuma", "bike": "nightblade", "seed": 123}
```

- `obs` is the shared `src/obs.js` vector. **v2 (3.20.0, default `--obs-width 50`)**:
  the v1 40-float layout (normalised by fixed per-channel divisors) plus a 10-float
  plan block (lane error, speed-limit headroom, stun, tactic one-hot) — see the header
  of `src/obs.js`. v1 (40 floats, raw units) remains accepted via `--obs-width 40`.
  Export format tag follows the width: `neon-rash-mlp@1` for 40, `neon-rash-mlp@2`
  otherwise (same serialisation; both load in `src/mlp.js`).

- `tactic` is **one string id** — one of the seven `rivals.js` tactics. Rich
  tactical context (the pre-3.17.0 object form) moves to the **optional**
  `tacticDetail` object, which the trainer validates (must be an object) and
  otherwise ignores. `src/telemetry.js` canonicalises legacy object tactics into
  this shape at record time, so on-disk JSONL always matches.
- `obs` must be a list of exactly `--obs-width` (default 50) finite numbers —
  the shared `src/obs.js` vector, so recorder and net cannot drift.
- `--holdout F` (default 0.1) holds out whole (world, bike, seed) races — a row-level
  split would leak temporally correlated frames. Per-epoch holdout MSE is printed and
  the **best-holdout epoch's weights are exported** (`meta.holdoutMse`/`holdoutEpoch`),
  so a long schedule cannot ship an overfit tail epoch.
- `input` is accepted as `{steer,throttle,brake}` **or** a 3-element list;
  ranges enforced: steer ∈ [−1,1], throttle/brake ∈ [0,1].
- `world`/`bike` strings; `seed` an int. Informational (not trained on) but
  validated; seed/world/bike coverage is summarised into the export's
  `meta.dataset` provenance block.
- Generated datasets carry an extra `expert` provenance field
  (`"heuristic-expert, not human"`); unknown extra fields are ignored.
- Invalid lines are skipped with a stderr note; the run aborts if more than
  50 % of rows are invalid (schema drift guard).

Round-trip proof (recorder JSONL → `parse_line()`): regenerate the fixture with
`node tools/ai-train/gen_fixture.mjs`, then in this container:

```sh
podman run --rm -v "$PWD":/work -w /work --entrypoint python neon-ai-train \
    tools/ai-train/roundtrip_check.py tests/fixtures/telemetry-roundtrip.jsonl
```

If the schema ever drifts again, only `parse_line()` (and the recorder's
`normTactic`) should need to change.

## Real training data (3.17.0; DAgger rounds 3.20.0)

There is no human telemetry yet. `tools/gen-dataset.mjs` generates the training
set headlessly: the heuristic expert (`driveRival` pure pursuit) drives all
three rivals across all 4 worlds × all 6 bikes × N seeds, with DAgger-style
noise bursts injected into the *executed* action while the recorded label stays
the expert action at the visited state. **All generated data is labelled
`heuristic-expert, not human`** (per-record `expert` field and the tool's
stdout).

DAgger rounds (3.20.0): `--policy weights.json` rolls out the *learner* through
the shipped `rivalBrain:'net'` path (tiers cycle rookie/pro/elite per race) and
records the expert's action at each learner-visited state via `driveNet`'s hook
seam. Aggregate all rounds with repeated `--data` — that is the DAgger
algorithm. `--flight N` makes every Nth race a flight launch (default 8, 0 =
street only). Generate + train + evaluate:

```sh
podman run --rm -v "$PWD":/app -w /app node:20 node tools/gen-dataset.mjs        # round 0 -> telemetry/heuristic-expert.jsonl
podman run --rm -v "$PWD":/work -w /work neon-ai-train \
    --data telemetry/heuristic-expert.jsonl --epochs 25 --out telemetry/rival-policy-bc-r1.json
podman run --rm -v "$PWD":/app -w /app node:20 node tools/gen-dataset.mjs \
    --policy telemetry/rival-policy-bc-r1.json --out telemetry/dagger-round1.jsonl
podman run --rm -v "$PWD":/work -w /work neon-ai-train \
    --data telemetry/heuristic-expert.jsonl --data telemetry/dagger-round1.jsonl \
    --epochs 40 --out assets/ai/rival-policy-bc.json --label "..."
podman run --rm -v "$PWD":/app -w /app node:20 node tools/eval-policy.mjs        # acceptance bands inside
```

## Train

```sh
podman run --rm -v "$PWD":/work -w /work neon-ai-train \
    --data telemetry/lap1.jsonl --data telemetry/lap2.jsonl \
    --out assets/ai/rival-policy.json --label "BC on 12 recorded laps"
```

Weights export format is `neon-rash-mlp@1` (row-major `W[i*units+j]`,
`x @ W + b`, hidden `tanh`, output `identity` — range clamping lives in
`src/tiers.js`). Weights are rounded through float32 before serialization so
the JSON decimals round-trip exactly into the browser `Float32Array`.

## Smoke run (no telemetry required)

```sh
# 1. Fabricate a teacher, train briefly, export (labels itself synthetic-only)
podman run --rm -v "$PWD":/work -w /work neon-ai-train \
    --synthetic 4000 --epochs 5 --out assets/ai/rival-policy-smoke.json

# 2. Regenerate the parity fixtures (also covers assets/ai/rival-policy-synthetic.json)
podman run --rm -v "$PWD":/work -w /work --entrypoint python neon-ai-train \
    tools/ai-train/make_reference.py

# 3. Prove exported-JSON -> JS forward parity (1e-5) in the node container
podman run --rm -v "$PWD":/app -w /app node:20 node tools/ai-train/parity_check.mjs
```

`--init-only` writes a seeded random init with no training (this is how the
shipped `assets/ai/rival-policy-synthetic.json` placeholder was produced —
see ASSETS.md; it is **untrained** and not a driving policy).

## Files

- `Containerfile` — python:3.12-slim + pinned NumPy, entrypoint is `train_bc.py`.
- `train_bc.py` — validation, Adam trainer, `neon-rash-mlp@1` exporter.
- `make_reference.py` — regenerates `tests/fixtures/mlp-*.json` parity vectors.
- `parity_check.mjs` — Node-side parity check against those fixtures.
