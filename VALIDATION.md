# Yoru — Version 3 validation — 22 September 2026

## Passed

20 Node tests: original road and flight tests; bounded catch-up and interpolation; 30/144 Hz render timestep consistency; damage overriding model pressure; bounded rival acceleration and traffic avoidance; stale response rejection after restart; invalid/failed model fallback; pressure changing passing behavior without top-speed boosts; HTTP asset serving and disabled-service behavior.

Headless Chromium / SwiftShader browser checks:
- Four world selections and garage persistence.
- Street acceleration, takeoff, climb, boost, pause/resume and off-road landing.
- Gate success/miss, altitude-separated traffic collision, drone and pylon contact, finish and record save.
- Imported Kestrel GLB successfully loaded and rendered.
- Three rivals, low-health recovery, and explicit Laya-offline/local-AI HUD.
- Desktop and mobile viewports; no JavaScript errors in the checked flows.

Run `npm test` without dependency installation. Optional browser checks:
```
npm install --no-save --omit=optional playwright
npx playwright install chromium
node tests/browser-v2-smoke.cjs
node tests/browser-v3-smoke.cjs
```
Set `CHROMIUM_PATH` for an existing Chromium binary. Ports 8080 and 8094 must be free. Screenshots come from the renderer, not concept art.

## Limits

This session used software rendering, which is very slow here. `previews/v3-software-renderer-metrics.json` records that environment explicitly; it is not evidence of real-device smoothness or a before/after benchmark. Frame statistics are available in-game for hardware testing. Unit tests confirm the timing design, not hardware FPS. Under severe stalls the catch-up cap deliberately slows simulation instead of generating unbounded work.

The default ONNX Runtime installation hit a proxy timeout while downloading optional providers. The documented CPU-only installation succeeded; importing @receptron/laya and its native runtime passed. Model initialization downloaded the 3.8 MB ONNX graph but did not finish the weight bundle within a 45-second verification window. No real ONNX inference or model decision-quality benchmark was completed. The adapter uses the upstream documented API. Its failure paths and local fallback were exercised. The large model weights are not bundled.

Kestrel is imported untextured geometry with newly assigned materials. The rider and districts remain procedural; this is not the completed photoreal art pass. No Sketchfab assets, copied commercial game content or manufacturer-endorsed replicas are bundled. See ASSETS.md.

No hardware GPU performance, physical mobile/gamepad, Firefox/Safari, human audio listening, long-session enjoyment test or hosted deployment was performed. Physics remains an approximate simcade model; no articulated suspension, rigid-body pileups or ragdolls.
