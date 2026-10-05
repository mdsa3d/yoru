# Rival AI

**Short version:** the rivals you race today are a hand-built heuristic system, and that is the default.
A learned policy network has been built, trained and evaluated, but **it is not shipped** — no candidate passed the
acceptance bands declared before testing.

| Layer | Where | Status |
|---|---|---|
| Heuristic tactics + Director | `src/rivals.js`, `src/sim.js` | ✅ Default |
| Session skill adaptation | `SkillTracker` in `src/rivals.js` | ✅ Default |
| Physics-driven rivals | `driveRival`, `?rival-physics` | 🧪 Opt-in |
| Policy net | `driveNet`, `src/mlp.js`, `src/obs.js`, `src/tiers.js` | 🧪 Opt-in, untrained placeholder loaded |
| Laya tactic service | `server/` | 🧪 Optional; real inference not validated |

## Heuristic rivals (shipped)

- **Roster:** three rivals per race, rotated from five personalities — VIPER (aggressive), GHOST (technical),
  ECHO (patient), SABLE (ruthless), KITE (draft).
- **Tactics:** `race`, `overtake`, `defend`, `yield`, `slipstream`, `block`, `bait`.
- **Field survey** every step: leader-first ordering, lane-band claims so rivals don't stack, pincer flanks under pressure,
  draft targets, sustained-proximity duel detection, and a single designated striker with a shared 3.5 s lockout.
- **Director** encounters: `recover`, `balanced`, `pressure`, `duel`. Damage or low health forces `recover` (rivals back off);
  this guardrail overrides any model suggestion. Pressure widens passing chances and shortens reaction time without
  raising rival top speed.
- **Pace** targets derive from fixed reference speeds (68 m/s road, 101 m/s air), not from the player's bike.
- **SkillTracker** rates the player from place, speed ratio and crashes, persists in `localStorage`, and nudges rival pace
  (±6 %, applied at race start) and Director aggression between races.

## Physics-driven rivals (`?rival-physics`)

`driveRival` converts the same tactical plan (lane + speed limit) into the player's input shape and steps the full
`stepVehicle()` model with pure pursuit. Director guardrails stay authoritative because both controllers share `planRival()`.
It remains opt-in until it is proven by evaluation.

## Policy net (experimental, not shipped)

Pipeline, all in-repo and reproducible:

1. **Data** — `tools/gen-dataset.mjs` runs the headless sim with the heuristic `driveRival` as the expert. Training data is
   **heuristic-expert, not human**; no human telemetry has ever been recorded.
2. **Observation** — `src/obs.js` v2: 50 normalised floats (v1's 40 + lane error, speed-limit headroom, stun, tactic one-hot).
3. **Behaviour cloning** — `tools/ai-train/train_bc.py` (NumPy, containerised), MLP 50→128→128→3, race-level holdout.
4. **DAgger** — two rounds rolling out the learner through the shipped `rivalBrain:'net'` path; 288 races, 796,065 frames.
   Held-out MSE fell from ≈0.36 (v1 obs) to **0.0112**.
5. **Evolution strategies** — `tools/rl/` (OpenAI-ES, warm-started from BC) against the real JS sim, including a multi-tier
   objective. On the training reward the best pro-tier run scored 90.19 vs the heuristic's 84.70 on held-out seeds.
6. **Difficulty tiers** — `src/tiers.js` wraps each policy with Rookie / Pro / Elite action noise (σ .16 / .07 / .02) and
   reaction delay (.30 / .13 / .045 s).

### Acceptance gate (`tools/eval-policy.mjs`)

Bands were fixed before the first evaluation and have not been loosened. N = 200 races per tier per brain, identical race
cards and scripted player; the net must pass **all** bands at Rookie **and** Pro **and** Elite.

| Band | Metric (net − heuristic) | Threshold |
|---|---|---|
| B1 | player finish place | ≤ +0.20 |
| B2 | rival contacts per race | ≤ +0.50 |
| B3 | player off-road time | ≤ +1.0 s |
| B4 | race time | ≤ +4 % |
| B5 | wreck rate | ≤ +3 pp |
| B6 | lead-rival distance at finish | ≥ −5 % |

### Result: not shipped

Six candidates were measured (CHANGELOG 3.20.0). Best outcomes: `es-pro` passed Pro and Elite but failed Rookie contacts;
`es-mt2` passed Rookie but missed Pro contacts by 0.05 and Elite pace by 0.48 pp. **None passed all three tiers.**
The contact excess grows with tier noise (Rookie worst), and fixing it cost pace elsewhere. A higher training reward did
not translate into passing the gate.

Consequences, exactly as in the code today:
- the default brain is `heuristic`;
- `?rival-brain=net` (only together with `?rival-physics`) loads `assets/ai/rival-policy-synthetic.json`, an **untrained
  random-init placeholder**, labelled as such in the Garage and in `ASSETS.md`;
- trained candidates live in the untracked `telemetry/` folder and are not part of the game;
- any load or runtime failure falls back to the heuristic.

Handoff notes and commands: `tools/ai-train/RESUME.md`.

## Laya (optional local model)

`npm run setup:laya` installs a CPU-only ONNX Runtime and `@receptron/laya@0.1.2`; `npm run start:laya` starts the server
with the worker. First use downloads about 1.7 GB of weights (upstream figure). The model only chooses a tactic and pacing
state for the Director; it never drives directly and never runs in the render/physics loop. Installation and import were
verified; **real model inference and decision quality have not been validated**.
