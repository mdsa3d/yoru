# RESUME — rival-policy training handoff (written 2026-10-05, after 3.20.0)

Status: **not shipped.** The obs-schema fix and DAgger pipeline landed and work (BC
held-out MSE 0.36 → 0.0112), but no candidate net passes the pre-declared acceptance
bands at all three tiers, so `setup.rivalBrain='net'` still loads the synthetic untrained
placeholder and the default brain stays `heuristic`. Do not promote any weights into
`assets/ai/` until `tools/eval-policy.mjs` prints `VERDICT: net is NOT WORSE ...`
(exit code 0) with the bands below **unchanged**.

## Pre-declared acceptance bands (fixed 3.17.0 — do not loosen)

In `tools/eval-policy.mjs`, N=200 races/tier/brain, identical race cards and scripted
player for both brains; the net must satisfy ALL of these at rookie AND pro AND elite:

| band | metric | threshold |
|---|---|---|
| B1 | mean player finish-place delta (finishers) | ≤ +0.20 places |
| B2 | rival-contact rate delta | ≤ +0.50 contacts/race |
| B3 | player off-road time delta | ≤ +1.0 s/race |
| B4 | mean race-time delta (finishers) | ≤ +4 % |
| B5 | wreck-rate delta | ≤ +3 percentage points |
| B6 | mean lead-rival distance at race end | ≥ −5 % vs heuristic |

## Where things are

- Data (gitignored, regenerable): `telemetry/heuristic-expert.jsonl` (round 0, expert +
  noise bursts, 266,652 frames), `telemetry/dagger-round1.jsonl`, `telemetry/dagger-round2.jsonl`
  (learner rollouts, expert labels). All obs **v2, 50 floats, normalised** (`src/obs.js`).
- Candidate weights (untracked, `neon-rash-mlp@2`, 50→128→128→3):
  `telemetry/rival-policy-bc-final.json` (BC, best pace),
  `telemetry/rival-policy-es-pro.json` (**passes pro+elite**),
  `telemetry/rival-policy-es-rookie.json` (rookie contact discipline),
  `telemetry/rival-policy-es-mt2.json` (**passes rookie**),
  `telemetry/rival-policy-es-mt3.json` (best pace under multi-tier ES).
  `tools/rl/out/checkpoint.json` resumes the last (mt3) ES run.
- Gate results: `telemetry/eval-results.json` (last run, mt3); the full six-candidate
  table is in `CHANGELOG.md` 3.20.0.
- ES curve: `tools/rl/out/curve.jsonl` — **flat-to-regressing** (mt3 ≈ 88.2 mid-run →
  81.5 at gen 188). More minutes of the same ES recipe is not the fix.

## What runs where (5070 Ti machine)

**CPU-bound Node (the GPU does NOT help):** everything that steps the JS sim —
dataset generation, DAgger rollouts, ES rollouts, and the eval harness — because the
policy is evolved/evaluated against `src/sim.js` in Node by design (no sim drift).
On the 5070 Ti machine these just use more/faster CPU workers (`--workers`).

```sh
# tests (always, in container)
podman run --rm -v "$PWD":/app -w /app node:20 npm test

# data (round 0 expert + noise; ~7 s) and DAgger rounds (~100 s each)
podman run --rm -v "$PWD":/app -w /app node:20 node tools/gen-dataset.mjs --out telemetry/heuristic-expert.jsonl
podman run --rm -v "$PWD":/app -w /app node:20 node tools/gen-dataset.mjs \
    --policy <current-best.json> --out telemetry/dagger-roundN.jsonl

# ES refinement (Node, CPU; ~15 min budgets were used; checkpoint-resumable)
podman run --rm -v "$PWD":/app -w /app node:20 node tools/rl/train.mjs \
    --minutes 15 --tier all --init telemetry/rival-policy-bc-final.json \
    --sigma 0.008 --lr 0.004 --workers 10 --seed 6
# or resume: --resume tools/rl/out/checkpoint.json

# the gate (~11 min single-threaded)
podman run --rm -v "$PWD":/app -w /app node:20 node tools/eval-policy.mjs \
    --policy <candidate.json> --races 200
```

**GPU-able Python (this is what the 5070 Ti is actually for):** the BC/DAgger
*retrain* — `tools/ai-train/train_bc.py` is currently NumPy-CPU in the
`neon-ai-train` container (`podman build -t neon-ai-train -f tools/ai-train/Containerfile .`).
At 800k frames × 40 epochs it is minutes on CPU, but if you scale data 10× or widen the
net, port `train()`/`forward()` to PyTorch CUDA (the export format stays
`neon-rash-mlp@2`; weights must round-trip through float32 exactly as
`export_json()` does — keep `tools/ai-train/parity_check.mjs` green):

```sh
podman run --rm -v "$PWD":/work -w /work neon-ai-train \
    --data telemetry/heuristic-expert.jsonl --data telemetry/dagger-round1.jsonl \
    --data telemetry/dagger-round2.jsonl --epochs 40 --out <out.json>
# --holdout 0.1 (race-level split) and best-holdout-epoch export are built in
```

## Open diagnosis / ideas (in priority order)

1. **Contact band vs pace band trade-off.** B2 excess is tier-noise-monotone
   (elite +0.0…0.3, pro +0.5…1.3, rookie +0.9…1.3 contacts/race): the tier wrapper's
   noise/delay rubs the player at close range. Rookie-tier ES learns berth discipline
   (+0.17 contacts) but pays 0.4–0.9 pp of pace and breaks B6. Closest miss: mt2 failed
   pro by 0.05 contacts and elite by 0.48 pp. Promising: (a) oversample near-player
   frames in BC/DAgger (contact-weighted loss); (b) add a close-range berth bonus to
   `tools/rl/reward.js` (it is one tested pure function — retune carefully, the
   drive-fast > drive-dirty > parked ordering is load-bearing); (c) revisit tier
   noise shaping at close range (would change shipped difficulty feel — needs a
   gameplay decision, not a metrics decision).
2. **Obs gaps that remain:** no upcoming-curvature/lookahead channel (the expert does
   not use one, but a net beating the expert might); player-recorded telemetry frames
   carry a degenerate plan block (players have no lane/speed-limit plan).
3. **Dormant tier speed cap:** `TierController.limitSpeed` has no caller — rookie/pro
   pace differences on the net path come from noise+delay only. Flagged, not fixed.
4. BC MSE plateau is **solved** (0.0112); if it regresses after obs changes, check
   channel scaling first (raw units saturate tanh — measured).

## Promotion checklist (when a candidate passes)

1. `node tools/eval-policy.mjs --policy <candidate>` → all tiers PASS, exit 0.
2. Copy weights to `assets/ai/rival-policy-bc.json`, update `ASSETS.md` provenance.
3. Flip the fetch path in `src/main.js` (`rival-policy-synthetic.json` →
   `rival-policy-bc.json`) — **owned by the graphics workstream**; keep
   `setup.rivalBrain` default `heuristic` and the Garage label "experimental".
4. `npm test` in the container; update CHANGELOG + ROADMAP §4.
