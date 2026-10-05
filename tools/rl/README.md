# rl — B5 reinforcement learning for the rival policy net (UPLIFT-PLAN B5)

Dependency-free Node trainer that evolves a `src/mlp.js`-shape policy
(default **50→128→128→3** — the v2 obs width from `src/obs.js`, `--hidden`
configurable) against the **actual JS headless sim** (`src/sim.js`) — no Python
port, so no sim drift. Rollouts are parallelised with `worker_threads`.
Everything runs **inside podman/docker only** (same `node:20` image as the test
suite). Warm starts accept both `neon-rash-mlp@1` (width 40) and `@2` (width 50)
weights; since 3.20.0 the trainer operates on the v2 50-float schema, so a @1
init is rejected by the width check unless it matches the configured shape.

## Algorithm choice: OpenAI-ES (not PPO)

- The reward path runs through `impact()`, wall scraping and contact
  predicates — discontinuous, non-differentiable events. ES only needs forward
  passes; a hand-rolled PPO (backprop + GAE + clipping, zero deps) is far
  easier to get subtly wrong.
- ES parallelises rollout-for-rollout across workers with no gradient
  plumbing, and treats the tier wrapper's action noise/delay as part of the
  dynamics (it *is* part of the shipped dynamics).
- Antithetic sampling + centered-rank fitness shaping + Adam on the mean;
  deterministic given `--seed` (seeded mulberry32 throughout; every candidate
  in a generation sees the same episode seeds — common random numbers).

## Reward (one documented pure function: `reward.js`)

`reward = progress − collision − off-road − unfair-contact`, per 1/120 s step,
for the trained rival (rival 0). See the header comment in `reward.js` for the
exact event definitions and weights. Notable honesty points:

- **Collision** against traffic/drones is a *reward-only* measurement using the
  sim's own player-collision predicate — the sim core never resolves
  rival–traffic crashes physically.
- **Unfair contact** = contact with the player while the Director says
  `recover` (rivals ordered to back off), or triggering the rival strike.

## Guardrails during training = guardrails in play

The agent is driven through the exact shipped path: `rivalBrain:'net'` →
`driveNet()` → per-rival `makeTierPolicy()` (action noise, reaction delay,
clamps for `--tier`) with `planRival()`'s Director-guardrailed speed limit
hard-enforced after the net. The policy cannot learn to cheat the guardrails;
`tests/rl-env.test.mjs` proves a pinned-throttle policy stays speed-limited.

## Usage (container)

```sh
podman run --rm -v "$PWD":/app -w /app node:20 node tools/rl/train.mjs \
    --minutes 14 --generations 400 --pop 16 --episodes 2 \
    --tier pro --seed 1 --workers 6 --max-seconds 45
```

Options: `node tools/rl/train.mjs --help`-style header comment in `train.mjs`.
Warm start: `--init assets/ai/rival-policy-bc.json` (optional — a missing file
warns and falls back to seeded random init). Self-play: `--self-play` drives
the player with a frozen copy of the policy, refreshed every
`--self-play-refresh` generations. Resume: `--resume tools/rl/out/checkpoint.json`.
Multi-tier: `--tier all` (3.20.0) evaluates every candidate at all three tiers
and averages — single-tier refinement overfits that tier's noise/delay (measured:
pro-only failed rookie contacts, rookie-only drained pace everywhere). With
`--tier all` the held-out `eval.json` gains a `perTier` fitness breakdown.

## Outputs (tools/rl/out/ — NEVER assets/ai; promotion is a human decision)

- `rival-policy-rl.json` — `neon-rash-mlp@1` weights of the final ES mean +
  meta (algorithm, reward weights, held-out numbers).
- `checkpoint.json` — resumable state (theta + Adam moments + config + curve).
- `curve.jsonl` — one JSON line per generation: the true learning curve.
- `eval.json` — held-out evaluation (seeds from a disjoint range, never
  trained on) of the trained mean **vs the heuristic baseline**
  (`rivalBrain:'physical'`, same instrumentation).

If the curve is flat, say so — do not promote.

## Files

- `reward.js` — pure reward function (unit-tested in `tests/rl-reward.test.mjs`).
- `es.js` — OpenAI-ES core (unit-tested in `tests/rl-es.test.mjs`).
- `params.js` — theta ↔ `neon-rash-mlp@1` packing, seeded init.
- `env.js` — seeded episode evaluation in the real sim (unit-tested in
  `tests/rl-env.test.mjs`).
- `worker.mjs` — rollout worker.
- `train.mjs` — CLI orchestrator, checkpointing, held-out eval, export.
