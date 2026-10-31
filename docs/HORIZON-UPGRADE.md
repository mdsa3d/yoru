# Horizon upgrade — 2026-10-06

Presentation combines cinematic motorsport composition, lime/cyan cyberpunk
accents, and restrained futuristic instruments. The menu, garage, world picker,
HUD and pause/results panels share these treatments. Garage controls are grouped
by ride configuration, visuals, and rivals/sound. Keyboard focus is visible;
Tab stays within garage/world dialogs; Escape closes them even from a slider or
select. Reduced-motion preferences disable UI animations. Runtime remains static,
with the existing vendored Three.js import map and no new runtime dependencies.

## Rival training

This work trains the **driving policy**, not the optional Laya language model.
Laya continues to suggest Director tactics through its existing optional service.
The game's heuristic default and experimental policy loading are gated separately.

Fresh v2 (50-float) telemetry was necessary: only the legacy 40-float BC model was
present, while the newer candidate paths in RESUME.md were absent.

- Expert round: 96 races, 266,652 frames, 94 completions, 2 wrecks.
- Learner correction round: 96 races, 265,278 frames, 93 completions, 3 wrecks.
- Sources are generated **heuristic-expert, not human** demonstrations.
- Initial BC: 30 epochs, 50→128→128→3, best held-out MSE 0.028232.
- Aggregated DAgger: 40 epochs, same architecture, best epoch 38, MSE 0.011538.
  Entire races are held out. Imitation MSE alone does not establish racing quality.

ES now selects the initial, intermediate, or final mean with the highest reward
on fixed validation seeds; it retains that selection in checkpoints, including
resume. The final held-out test uses a different seed range. A late regression
therefore cannot automatically replace an earlier, better validated model.
This uses average reward across configured tiers, with the existing Akuma setup;
it does not by itself establish generalization across worlds or all gameplay bands.

The acceptance harness gains `--parallel` to evaluate tiers in separate workers,
and `--out` to preserve previous reports. The race cards, metrics and six acceptance
bands are unchanged. Serial/parallel reports matched exactly on a deterministic
2-race-per-tier, 8-second verification sample.

## Reproduce

Run from the repository root; all training and simulation checks use containers.

```sh
docker build -t yoru-ai-train -f tools/ai-train/Containerfile .
docker run --rm -v "$PWD":/app -w /app node:20 node tools/gen-dataset.mjs \
  --out telemetry/horizon-expert.jsonl --seeds 4 --rate 10
docker run --rm -e OPENBLAS_NUM_THREADS=1 -v "$PWD":/work -w /work yoru-ai-train \
  --data telemetry/horizon-expert.jsonl --epochs 30 --batch 512 \
  --out telemetry/rival-policy-bc-final.json
docker run --rm -v "$PWD":/app -w /app node:20 node tools/gen-dataset.mjs \
  --policy telemetry/rival-policy-bc-final.json --out telemetry/horizon-dagger.jsonl --seeds 4
docker run --rm -e OPENBLAS_NUM_THREADS=1 -v "$PWD":/work -w /work yoru-ai-train \
  --data telemetry/horizon-expert.jsonl --data telemetry/horizon-dagger.jsonl \
  --epochs 40 --batch 512 --out telemetry/rival-policy-bc-final.json
docker run --rm -v "$PWD":/app -w /app node:20 node tools/rl/train.mjs \
  --init telemetry/rival-policy-bc-final.json --tier all --generations 60 \
  --pop 12 --episodes 2 --workers 6 --sigma 0.004 --lr 0.001 --seed 12 \
  --validation-episodes 6 --validate-every 10 --eval-episodes 12 --minutes 4
docker run --rm -v "$PWD":/app -w /app node:20 node tools/eval-policy.mjs \
  --policy tools/rl/out/rival-policy-rl.json --races 200 --parallel \
  --out telemetry/horizon-acceptance.json
```

Candidate weights, resumable checkpoints and full datasets remain local training
artifacts. No candidate may replace the runtime weights until every acceptance band
passes at Rookie, Pro and Elite. UI previews are in `previews/horizon-*.png`.

## Inference and validation

At load time the MLP packs each neuron's input weights contiguously, retaining the
existing on-disk format, float32 operands and float64 summation order. No additional
persistent weight copy or per-call allocation is introduced. A local Node 20 CPU
microbenchmark (five alternating before/after runs of 5,000 passes, 50→128→128→3)
measured median time 240.79 ms before and 171.55 ms after, a 28.8% reduction.
100 input vectors produced exactly identical outputs. These timings were measured
while other container work was running; they are evidence for this local CPU run,
not a browser FPS or GPU claim.

- Unit suite: 154/154 passing, including Python/JS policy parity and real-sim tests.
- Existing browser smoke: steering, acceleration, collisions, combat, finish,
  restart, pause, save/garage and phone layout; zero browser errors.
- `tests/browser-horizon-smoke.cjs`: dialog Tab wrap, Escape from controls,
  world picker, visible actions at 390×844, 360×640, 360×560, 844×390 and 1280×720,
  reduced motion and mobile HUD. Browser checks used software-rendered Chromium.
- Previews: `previews/horizon-menu.png`, `horizon-worlds.png`,
  `horizon-mobile.png`, `horizon-hud-mobile.png`.

## Refinement result

The four-minute ES run completed 20 generations (244 seconds of training,
5,322 simulation steps/s). The selected model is generation 10: validation reward
83.865 vs 83.257 for the BC warm start and 83.338 at generation 20.
Final evaluation on 12 separate seeds per tier found average reward 83.313 vs
84.696 for the physical heuristic. Rookie reward was 85.266; Pro 81.916; Elite
82.757. The candidate is **not uniformly better** than the baseline on this test.
These 45-second rollouts are diagnostic, not full-race acceptance evidence.

## Full-race acceptance result: not promoted

200 races per tier and brain, with identical scripted players and race cards
(1,200 full simulated races total), using the original six acceptance bands:

| Tier | Excess contacts/race | Lead-rival distance change | Verdict |
|---|---:|---:|---|
| Rookie | +0.920 | −5.68% | FAIL: contacts and pace |
| Pro | +1.150 | −1.26% | FAIL: contacts |
| Elite | +0.300 | −2.06% | PASS |

The contact limit is +0.50/race; the rival-distance floor is −5%. All other bands
passed at all tiers. The candidate is retained locally for further research;
**the default heuristic and experimental placeholder fetch remain unchanged**.
This run confirms the previous contact-versus-pace diagnosis rather than solving
it. Improved imitation accuracy and model selection did not eliminate the tier
noise/reaction-delay problem. Future driving-quality work needs contact-aware
training or an explicitly evaluated close-range controller, not more of this same
reward-only refinement. Full numbers are in `horizon-acceptance-results.json`.

The completed outcome is a UI polish pass, faster neural inference, a more reliable
training/export pipeline and an evaluated new candidate. It does **not** establish
a stronger shipped learned driver or full AAA production quality.
