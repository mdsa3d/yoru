# Neon Rash v3 — Uplift Plan: Graphics Realism + Rival AI

Design only. No existing file was changed to write this plan. Status tags: **[implemented]** (in code
today), **[partial]**, **[planned]** (this plan proposes it), **[not stated]** (no source says).
Sources inspected: `CLAUDE.md`, `ROADMAP.md`, `CHANGELOG.md` (3.0.0–3.9.0), `src/*.js`,
`server/*.mjs`, `tests/`, `.spec-ai-depth.md`, `../decision-engine/laya/README.md`,
`../decision-engine/laya/onnx/README.md`, github.com/LingDong-/dither-sketches (README).

## 0. Contradictions found (fix these before starting)

1. **ROADMAP §4 says rival AI is "🔲 Not started"** and lists "the 3 existing archetypes
   (VIPER/GHOST/ECHO)". But `src/rivals.js` already has 5 `PERSONALITIES` (adds SABLE, KITE),
   7 `TACTICS` (`slipstream`,`block`,`bait`), a `duel` encounter, `surveyRivals()`, `bandOf()`
   lane claims, `guardTactic()` and `SkillTracker` — i.e. most of `.spec-ai-depth.md` A–D.
2. **That code is not wired.** `src/main.js:10` imports neither `surveyRivals` nor `SkillTracker`;
   `main.js:112` calls `controlRival(a,i,p,obstacles,director,dt)` with no `field`, and
   `main.js:108` calls `director.update(...)` with no `field`, so `duel`, lane bands, pincer and
   the strike lock are dead paths. `rosterFor` *is* used (`main.js:59`, so SABLE/KITE can spawn).
   No test in `tests/` references `surveyRivals|SkillTracker|guardTactic`; CHANGELOG has no entry.
3. **Laya's vocabulary lags the code.** `server/laya-worker.mjs` only offers tactics
   race/overtake/defend/yield and encounters recover/balanced/pressure.
4. **Laya size.** User brief says "~1.7 GB"; `laya/README.md:24` confirms "about 1.7 GB, fp32",
   421M parameters (`onnx/README.md:22`), ModernBERT encoder + decision head, Apache-2.0 weights.
   Local `laya/` is 380 MB because weights download to `~/.cache/receptron-laya` on first use.
5. **"Dither" ≠ dithering.** dither-sketches is a set of sketches in the *Dither programming
   language* (3D asteroids with infinite generated map, generative Chinese mountain landscape,
   generative apartment façades). It is not a dithering shader. The dither post-process below is
   an independent, stylistic idea. Repo licence: **not stated** in the fetched README — check
   before copying any code; port *ideas* only.

Recommended: Phase B0 (wire + test the existing AI-depth code) before any ML work.

---

## A. Graphics realism uplift

### A1. What exists today (`src/world.js` unless noted)
| Feature | Status | Evidence |
|---|---|---|
| WebGLRenderer, no native AA, DPR cap 1.75 | implemented | `world.js:58` |
| NeutralToneMapping, exposure 1.05 / per-world 1.0–1.15 | implemented | `world.js:58`, grep `toneMappingExposure` |
| HDR pipeline: HalfFloat RT, MSAA 4 (adaptive 0/4) | implemented | `world.js:64`, `setSamples` `:89` |
| Post: RenderPass → UnrealBloom(.42,.62,.75) → OutputPass → grade+CA ShaderPass | implemented | `world.js:64`, `GRADE_SHADER` `:15` |
| IBL: PMREM from the per-world procedural sky mesh | implemented | `world.js:60,104` (`RoomEnvironment` imported but unused) |
| Lights: hemi + sun (PCFSoft, 2048/512 adaptive) + rim + shadowing headlight spot | implemented | `world.js:61–66`, `setShadowQuality` `:90` |
| Materials: MeshStandard / MeshPhysical | implemented | `models.js`, `environment.js`, `world.js` |
| FogExp2 per world | implemented | `world.js:102` |
| Adaptive quality (render scale .6–1, MSAA, shadow size, effect gating) | implemented | `world.adapt()` `:91–100` |
| Instanced contact shadows/reflections, light-shaft cones, wet-road envMapIntensity | implemented | CHANGELOG 3.6.0/3.8.0 |
| SSAO/GTAO, SSR, TAA/SMAA/FXAA, CSM, HDRI files, DoF, motion blur | **absent** | not in `vendor/addons/` (only EffectComposer, Render/Shader/Output/Mask/UnrealBloom passes) |
| DoF, true motion blur | rejected | ROADMAP §3 ("poor cost/benefit") |

So the game already has a correct PBR + HDR + bloom + tone-map baseline. "Realism" gaps are
mostly *ambient occlusion, anti-aliasing when MSAA is off, shadow range, and asset/texture detail*.

### A2. Gap list, cost and risk (all **planned**)
Each new addon must be vendored from three r180 into `vendor/addons/` (no bundler — `CLAUDE.md`).
| # | Item | Visual gain | GPU cost | Effort | Notes / risk |
|---|---|---|---|---|---|
| G1 | SMAA or FXAA pass when `samples===0` | med | low (FXAA) / med (SMAA) | S | Fixes jaggies on `low`/auto-degraded path; vendor `FXAAPass`/`SMAAPass` |
| G2 | Cascaded shadows (`CSM` addon) or sun-follow re-fit | med | med–high | M | Current single 56×52 m sun frustum (`world.js:62`); CSM multiplies shadow draws; gate to `high` |
| G3 | GTAO/SAO pass (`GTAOPass`) | high (grounding) | **high** (normal+depth prepass) | M | Biggest perf risk; `high` only, half-res; must not break `setSamples` RT disposal contract (`world.js:16`) |
| G4 | Per-world HDRI or richer sky for PMREM | med | load-time only | S–M | Needs CC0 HDRI + `ASSETS.md` entry (~1–8 MB each); or keep procedural sky + add sun disc/cloud gradient |
| G5 | Texture detail: normal/roughness maps on road, KTX2 compression | high | VRAM | M–L | Needs `KTX2Loader` + transcoder vendored; asset provenance required |
| G6 | Physically-based headlight (IES-like falloff), light probes for tunnels | low–med | low | S | |
| G7 | Screen-space reflections on wet road | med | high | L | Existing env-map + instanced reflections already cover most of it; **not recommended** |
| G8 | WebGPU renderer + TSL | n/a now | — | XL | Rewrite of every ShaderPass; **not recommended** this cycle |
Cheap first: G1, G4, G6. Costly: G3, G2, G5. Perf budget: frame-time p95 tracked by
`FrameStats` (`timing.js`); ROADMAP §8 notes mobile targets are **unverified on real hardware** —
every new pass must be gated by `quality==='high'||autoEffects` and auto-disabled by `adapt()`.

### A3. Optional dither/halftone style toggle (**planned**, stylistic — NOT realism)
- New `ShaderPass` after the grade pass: ordered Bayer 4×4/8×8 or halftone dots on luminance,
  palette-quantised per world (reuse `world-data.js` colours). Stateless like `GRADE_SHADER`, so
  `setSamples` disposal stays safe. Toggle in setup (`setup.style='dither'`), off by default.
- Cost: one full-screen pass, negligible. Risk: fights bloom/CA (apply after them), HUD unaffected.
- Honest label in UI: "Retro dither (stylised)". It reduces fidelity by design.

### A4. What from dither-sketches is worth porting (ideas only; licence not stated)
- **Generative building façades** → procedural city-world façade textures / instanced window grids
  (pairs with ROADMAP §5 "more content"). Worth it.
- **Generative mountain-range landscape** → layered ridge silhouettes for solstice/alpine skyline
  and the PMREM sky (`environment.js`). Worth it.
- **Infinite generated map** → seeded segment generator for track-layout variation (ROADMAP §5);
  today `road(s)` (`physics.js`) is a fixed two-sine function. Worth a spike.
- The Dither language/runtime itself: not portable or needed.

---

## B. Rival AI uplift

### B1. How rivals are driven today
- **Rivals are kinematic, not physical.** `controlRival` (`rivals.js`) sets `a.lane`/`a.speedLimit`
  and integrates `a.v += clamp(target-a.v,-10dt,6.5dt)`; it never calls `step()`/`stepVehicle()`
  from `physics.js`. Rivals ignore grip, gears, tyres, weather, curvature (`curvature(s)`), slip.
- **Pace = rubber-band constant.** `main.js:59`: `target = bike.vmax*.84 + i*1.9` (air `vair*.74`)
  — derived from the *player's* bike, × personality `pace` .95–1.07.
- **Director** (`rivals.js`): one global encounter, re-evaluated every .75 s, 6 s dwell, fairness
  guardrails override Laya. **implemented**.
- **Laya**: optional (`setup.brain==='laya'`), `DecisionClient` POSTs every ≥.8 s, 900 ms timeout,
  to `server.mjs` → worker → `model.systemOne(...)` returning one `tactic` + `encounter` for *all*
  rivals for 3 s. **implemented**. CPU, 2 threads, ~2 GB RAM (`laya/README.md:26`).
- **Why "not great":** (1) no physics → they can't be out-braked/out-cornered, they just track a
  speed; (2) every rival follows the same remote tactic; (3) coordination code is unwired (§0.2);
  (4) Laya is a text-in classifier with ≥.8 s cadence — structurally unable to steer; (5) cross-
  session `SkillTracker` exists but is unused; (6) only 3 rivals (`main.js:59`).

### B2. Target architecture (**planned**)
```
Laya (optional, server)  → tactic/encounter every ≥0.8 s   [keep; tactical only]
Director + guardrails    → fairness clamps, difficulty tier [keep]
Policy net (browser)     → throttle/brake/steer @ 30–60 Hz per rival, driving physics.step()
Fallback                 → existing controlRival heuristics if model missing/slow
```
Policy I/O sketch: inputs ≈ 40 floats (own s-rel, x, v, vx, gear, rpm, surfaceGrip; road
curvature/slope samples at +10..+80 m; 4 nearest actors rel s/x/v; next 2 hazards; tactic one-hot;
tier). Outputs: steer ∈[-1,1], throttle, brake (the same `input` shape `step()` consumes).
Size: MLP 40→128→128→3 (~22k params, <100 KB). Inference: **hand-rolled MLP in JS** preferred
(Float32Array matmul, ~0.05 ms × rivals, zero deps, no-build friendly). `onnxruntime-web`
(WASM ~10 MB) only if the net outgrows ~200k params. Weights as JSON/bin in `assets/ai/` + `ASSETS.md`.

### B3. Phases
| Phase | Scope | Effort | Model fit |
|---|---|---|---|
| **B0** Wire existing depth | Call `surveyRivals` per step, pass `field` to `Director.update`/`controlRival`, use `SkillTracker` across a session (localStorage), extend Laya criteria to new tactics/`duel`; tests; CHANGELOG + ROADMAP status | S (1–2 d) | kimi k3 (impl), sonnet 5.5 (docs) |
| **B1** Physical rivals | Rivals drive `stepVehicle()` via a heuristic "pure-pursuit" controller producing `input`; retune `target` | M (3–5 d) | opus 5.5 design, kimi k3 impl |
| **B2** Headless sim | Extract `simulate()` from `main.js` (DOM-coupled) into `src/sim.js` pure module; seed PRNG replacing `Math.random` in `main.js` traffic respawn (`main.js:128`); fixed 1/120 step (`timing.js`) | M (3–5 d) | opus 5.5 (refactor plan), kimi k3 |
| **B3** Telemetry | Opt-in, local-only recorder: per 1/30 s `{obs, input, tactic, world, bike, seed}` → ring buffer → JSONL download; no network upload (no backend exists, ROADMAP §7) | S–M | kimi k3 |
| **B4** Imitation learning | Behaviour cloning on player laps + B1 heuristic laps (DAgger with heuristic as expert); train in Python/PyTorch **in a container**; export to JSON weights | M (1 wk) | opus 5.5 (data/loss design), kimi k3 |
| **B5** RL fine-tune | PPO/SAC in headless sim (Node or a Python port of `physics.js` — port must be golden-tested against JS); reward = progress − collision − off-road − unfair-contact; self-play vs frozen copies | L (2–4 wk) | opus 5.5 |
| **B6** Difficulty tiers | Rookie/Pro/Elite/Adaptive: same net, tier input + action noise + reaction delay + top-speed cap; Adaptive maps `SkillTracker.rating` → tier | S | sonnet 5.5 / kimi k3 |
| **B7** Ship | Browser MLP runner, fallback, perf gate, feature flag `setup.rivalBrain='net'` | S | kimi k3 |

Headless determinism feasibility: `physics.js` is pure (no DOM, no randomness, explicit `dt`),
`hazards.js`/`rivals.js` have 0 `Math.random`; the blockers are `main.js` (1 `Math.random`,
DOM-coupled `simulate`) and float differences if training sim is not the JS sim. Running the
**actual JS** in Node (`node:worker_threads` × N envs) avoids port drift; speed ≫ realtime is
expected but **not measured** — B2 must benchmark steps/s before committing to on-policy RL.

### B4. Fine-tuning Laya itself — not recommended
- Needs: the PyTorch checkpoint (HF `convaiinnovations/laya`, Apache-2.0), labelled
  (state-text → tactic) pairs, GPU for a 421M-param ModernBERT model, re-export via
  `laya/export/export_onnx.py`, re-validation against the JS reference (`laya/README.md:106`
  warns JS/Python number formatting differs).
- Convai training/fine-tuning code or recipe: **not stated** in the local READMEs. HF repo lists
  `rl_agent_config.json`, `rl_common.py`, `rl_agent_api.py` (download allow-list) — whether these
  support training is **not stated / unverified**.
- Why not: wrong tool (classifier, ≥.8 s latency, server-only, ~2 GB RAM) for continuous control;
  a 22k-param MLP beats it on every axis that matters here. Keep Laya for coarse tactic/encounter.

### B5. Risks
| Risk | Mitigation |
|---|---|
| Superhuman / unfair rivals | Director guardrails stay authoritative; tier caps; reward penalises contact |
| BC overfits one world/bike | Train on all 4 worlds × 6 bikes; domain-randomise tyres/weather |
| Sim drift Python vs JS | Use JS sim in Node, or golden-trace parity tests |
| Perf on mobile | MLP budget ≤0.5 ms/frame total; fallback to heuristics under `adapt()` low |
| Telemetry privacy | Local only, opt-in, no upload; documented in README |
| Dead code repeats (§0.2) | Each phase lands with wiring test + CHANGELOG/ROADMAP update |

---

## C. Test strategy (all tests in podman/docker — never on host)
- Add `Containerfile.test` (**planned**): `node:20` base + Playwright Chromium (browser smoke
  already uses swiftshader, `tests/browser-v3-smoke.cjs`) + optional `python:3.12` stage for B4/B5.
  Run: `podman run --rm -v "$PWD":/app:Z -w /app neon-test npm test` (docker equivalent).
- Keep the current Node suite green (CLAUDE.md says 29 pass; recount in container at B0 start).
- New pure tests: `surveyRivals` wiring; `field` passed path; `SkillTracker` persistence;
  seeded-sim determinism (same seed ⇒ identical 60 s trace hash); MLP forward vs reference
  vectors; policy never exceeds tier caps; guardrails override net (health<32 ⇒ yield).
- Eval harness (headless): 200 seeded races per tier → finish-position distribution, contact rate,
  off-road time; acceptance bands per tier fixed before training.
- Graphics: render-skip in Node (no WebGL); Playwright screenshots per world × quality in
  container, frame-time p95 from `FrameStats` with each new pass on/off; dither toggle snapshot.

## D. Sequencing & sub-agent fit
1. B0 (wire existing) → 2. G1+G4+A3 (cheap visuals) → 3. B1+B2 → 4. B3+B4 → 5. G3/G2 (gated)
→ 6. B5+B6+B7. A4 procedural ports ride with ROADMAP §5 content work.
- **opus 5.5 (reasoning):** B2 sim extraction plan, B4/B5 learning design, reward shaping, G3 perf.
- **kimi k3 (implementation):** B0, B1, B3, B7, G1, G4, A3 shader, Containerfile.
- **sonnet 5.5 (simple):** docs (CHANGELOG/ROADMAP/ASSETS), test boilerplate, B6 tier tables.

Unknowns (not stated anywhere inspected): real-device mobile GPU budget; Node sim steps/s;
dither-sketches licence; Convai training code; acceptable telemetry retention policy.
