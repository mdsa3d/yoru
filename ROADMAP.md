# Yoru v3 — Production Roadmap

Tracking doc for pushing this game toward the highest production values realistically
achievable for a solo-maintained, no-build, vanilla-Three.js browser project. This is
not a AAA studio and won't pretend to be one (AAA = 100–500+ person teams, 3–5 year
timelines, $50–200M budgets, licensed engines/middleware, mocap, QA departments) — the
goal here is "feels like a polished commercial indie/AA game," pursued incrementally.

Status legend: 🔲 not started · 🔶 in progress · ✅ done

## 2026-09-24 — session scope decision

All 8 areas below were identified as valuable. Given one-session bandwidth, the user
chose to execute **polish + audio + graphics** this session (recommended as highest
current leverage, since content/AI/graphics have already seen recent investment while
polish and audio have had comparatively little). The rest are tracked below for future
sessions, not abandoned.

## 1. ✅ Game-feel polish
Shipped 2026-09-25 (CHANGELOG 3.4.0–3.9.0): camera-shake-ready smoothPos refactor,
hit-stop/time-dilation on hard impacts (with leaderboard-debt compensation), a
Points-based spark system, tire smoke, rain splash, boost trail, geometric speed
lines, an instanced skid-mark decal system, HUD vignette/damage-flash/RPM-gauge/
minimap/rank-flash/countdown-beat/finish-desaturation polish.

## 2. ✅ Audio
Shipped 2026-09-25 (CHANGELOG 3.5.0): RPM/gear-derived engine pitch curve, per-kind
crash/impact differentiation, Director-encounter-reactive music layering, per-world
musical mood, rain/wind/tire-grip audio layers, UI sounds, menu-transition fades,
and bounded nearest-actor spatial panning.

## 3. ✅ Further graphics
Shipped 2026-09-25 (CHANGELOG 3.6.0, 3.8.0, 3.9.0): instanced contact shadows/
reflections/hazard pools (~100→~10 draw calls), a velocity-scaled rain rebuild,
6 environment/prop detail fixes (drone pod, debris variety, oil/puddle textures,
car body variety, sign polish/double-sided fix), wet-road envMapIntensity,
cone-mesh headlight light shafts, a stateless post-OutputPass colour-grade +
chromatic-aberration ShaderPass (per-world grade, boost/damage-reactive), a
first-person cockpit-view fix (Kestrel falls back to hide-all — no named cockpit
nodes in its GLB), and a desert/alpine roadside prop reskin (ocean left as-is,
world count still 4). Rejected per spec: true motion blur, depth-of-field
(no vendored passes, poor cost/benefit at this game's fixed camera distance).

## 4. 🔶 Rival AI / Laya depth
Beyond the 2026-09-24 difficulty retune (measured top-speed-based targets, faster
think/lateral response, pressure-aware defending — see CHANGELOG 3.2.0): more encounter
variety beyond race/overtake/defend/yield, smarter Laya-driven multi-rival coordination
(currently each rival reacts independently to the same Director state), rival personality
expansion beyond the 3 existing archetypes (VIPER/GHOST/ECHO), adaptive difficulty that
responds to player skill across a session, not just within one race.
**In progress.** Done (CHANGELOG 3.10.0): personalities expanded to 5 (SABLE, KITE) with a
rotating roster; new tactics (slipstream/block/bait) and the duel encounter are now wired —
`surveyRivals` runs per step in `main.js` and its `field` is passed to `Director.update` and
`controlRival` (lane-band claims, pincer flanks, duel detection live); `SkillTracker` adapts
pace/aggression between races and persists to `localStorage`; Laya vocabulary and state
sanitisation cover the new tactics/encounter. Done (CHANGELOG 3.13.0): race rules extracted
into the DOM-free deterministic `src/sim.js` (seeded PRNG, fixed 1/120 step; `main.js`
delegates to it) with a measured benchmark (node:20 container: physical ~217k–253k steps/s,
kinematic up to ~1M steps/s); a pure-pursuit `driveRival` lets rivals drive `stepVehicle()` with the
player's input shape behind the `?rival-physics` flag (kinematic `controlRival` stays the
default; Director guardrails authoritative on both paths via the shared `planRival`); rival
pace targets no longer scale with the player's bike; opt-in local-only telemetry recorder
(`?telemetry=1`, 30 Hz JSONL ring buffer, no upload). Done (CHANGELOG 3.15.0): the policy
net is now wired into the race loop (`setup.rivalBrain='net'` + `?rival-physics`, doubly
opt-in) with one seeded tier-wrapped policy per rival, a shared `src/obs.js` 40-float obs
builder for both telemetry and the net, heuristic fallback on fetch/load/non-finite
failure, and Director speed guardrails enforced after the net. Done (CHANGELOG 3.17.0):
the telemetry/trainer `tactic` drift is settled (one string id + optional `tacticDetail`,
round-trip-tested into `train_bc.py`'s `parse_line()`); the rival-strike rule now keys on
the survey `field.striker` with a shared 3.5 s lockout and duel gating (spec §B.4) instead
of roster index 0; a real training set exists (`tools/gen-dataset.mjs` — heuristic-expert,
**not human**, 4 worlds × 6 bikes × 4 seeds = 96 races, 268,683 frames, DAgger noise
bursts); and a BC net was trained from it (`assets/ai/rival-policy-bc.json`). The seeded
eval harness (`tools/eval-policy.mjs`, acceptance bands declared before running, 200
races/tier/brain) gives an **honest negative**: the BC net is measurably worse than the
heuristic overall (fails competitiveness at rookie/elite and contact rate at rookie;
passes all bands at pro), so the `rivalBrain='net'` path still loads the synthetic
placeholder and the default brain stays `heuristic`. Done (CHANGELOG 3.20.0): the 3.17.0
diagnosis was executed — obs **v2** (50 floats, `neon-rash-mlp@2`, v1 frozen and
width-dispatched so the placeholder still loads) adds the plan-state channels the expert
mapping provably depends on (lane error, speed-limit headroom, stun, tactic one-hot) plus
fixed normalisation; race-level-holdout BC with two real DAgger rounds (288 races,
796k frames incl. flight launches) cut held-out MSE 0.36 → **0.0112**; warm-started ES
(5 real 12–15 min runs incl. a new `--tier all` multi-tier objective) beats the heuristic
on the training reward (held-out 90.2 vs 84.7, 0 % off-road). **But the acceptance bands
still fail: no candidate passes all three tiers** — best results: es-pro passes pro+elite,
es-mt2 passes rookie; the contact band (tier-noise-monotone) and the pace band trade off
just outside the gate. Placeholders kept; v2 candidates staged in `telemetry/`. Still open:
closing the last ~0.1-contact / ~0.5 pp gap (likely needs contact-aware data or reward
shaping near the player, or revisiting tier noise at close range); physics-driven rivals
are not yet the default; every rival still follows one shared remote tactic; no human
telemetry has ever been recorded (B3 remains opt-in and local-only).

## 5. 🔲 More content
Additional worlds/tracks beyond the current 4 (`src/world-data.js`), more bikes beyond
the current 6 (`BIKES` in `src/physics.js`), more hazard type variety beyond
debris/oil/puddle/closure (`src/hazards.js`), track-layout variation within a world
rather than one fixed 4000m sprint per world.
**Not started — future session.**

## 6. 🔲 Progression / meta systems
Unlocks (bikes/paint/worlds gated by achievement), achievements/challenges, a proper
career/campaign mode structure instead of standalone races, multiple race modes beyond
race/free (time trial, elimination, checkpoint sprint variants).
**Not started — future session.**

## 7. 🔲 Multiplayer / leaderboards
Biggest scope jump of all 8 areas — requires a real backend (server-authoritative state
or at minimum a persistent leaderboard API), which does not exist today (the current
`server.mjs`/`decision-service.mjs` is local-dev-only, explicitly not a hardened
production host per CLAUDE.md). Would need: a hosting decision, a persistence layer,
anti-cheat consideration for submitted times, and either WebRTC/WebSocket real-time
sync (true multiplayer) or simple async leaderboard submission (much smaller scope).
**Not started — future session. Recommend scoping this as its own dedicated session
given the architectural decisions required before any code is written.**

## 8. 🔲 Mobile/touch polish
Touch controls already exist (`show('touch', matchMedia('(pointer:coarse)').matches)`
in main.js, flight touch controls, pointer-capture button handling). Further polish
would mean: on-screen control layout/ergonomics review on real devices, performance
profiling on actual mobile GPUs (current adaptive-quality system targets are unverified
on real mobile hardware), haptic feedback (Vibration API) on impacts, PWA/installability.
**Not started — future session.**

---
*Update this file's status markers as each area is executed. See CHANGELOG.md for
the user-facing record of what shipped in each version.*
