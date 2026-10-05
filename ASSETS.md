# Yoru — Asset provenance

## Kestrel chassis
- Source: **fancy motorcycle**, by **Teh_Bucket**, April 17, 2019.
- Original page: https://opengameart.org/content/fancy-motorcycle
- Official download: https://opengameart.org/sites/default/files/bike.obj
- License: **CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/
- License checked September 22, 2026. Author's page lists CC0 and describes an untextured 10k-triangle model.
- Original source retained: `assets/models/fancy-motorcycle-source.obj`.
- Prepared asset: `assets/models/kestrel.glb` (10,110 triangles, 7 material primitives, 733 KB).
- Changes: scale and axis conversion, component separation into chassis and wheel pivots, PBR material assignment, custom paint, lights, rider and animated vector-thrust assembly. No manufacturer branding added.
- Reproduce conversion: `python3 tools/prepare-bike.py` (requires numpy).

## Kenney traffic cars (Car Kit)
- Source: **Car Kit**, by **Kenney** (www.kenney.nl).
- Original page: https://opengameart.org/content/car-kit
- Official download: https://opengameart.org/sites/default/files/kenney_car-kit_3.1.zip
- License: **CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/
- License checked September 23, 2026. Author's page and zip metadata list CC0.
- Original source retained: `.asset-work/kenney_car-kit_3.1.zip` (not committed).
- Prepared assets: `assets/models/traffic/sedan.glb`, `assets/models/traffic/van.glb`, `assets/models/traffic/taxi.glb`.
- Changes: none to the model data; only three distinct vehicle meshes were kept from the full zip. They are loaded once as templates and cloned at runtime for traffic variety, mixed with the existing procedural `makeCar()` cars.
- Reproduce: download the zip, extract `Models/GLB format/{sedan,van,taxi}.glb` to `assets/models/traffic/`.

## Kenney racing hazards (Racing Kit)
- Source: **Racing Kit**, by **Kenney** (www.kenney.nl).
- Original page: https://opengameart.org/content/racing-kit
- Official download: https://opengameart.org/sites/default/files/Racing%20Kit%20%281.2%29.zip
- License: **CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/
- License checked September 23, 2026. Author's page and zip metadata list CC0.
- Original source retained: `.asset-work/Racing Kit (1.2).zip` (not committed).
- Prepared assets:
  - `assets/models/hazards/barrier-red/barrierRed.gltf` + `barrierRed.bin`
  - `assets/models/hazards/fence-straight/fenceStraight.gltf` + `fenceStraight.bin` + `net.png`
- Changes: no model edits; only the `barrierRed` and `fenceStraight` glTF pairs (and the fence's `net.png` texture) were kept from the full zip. The glTF files ship separated (no GLB variant in the archive and no local conversion tool was available), so `.gltf` + `.bin` + texture are kept together per model. Each instance is re-centered in code by bounding-box center/bottom so it sits on the road.
- Reproduce: download the zip, extract `Models/glTF format/barrierRed.{gltf,bin}`, `Models/glTF format/fenceStraight.{gltf,bin}` and `Models/glTF format/net.png` to the matching `assets/models/hazards/` subfolders.

## Rival policy net weights (synthetic placeholder)
- File: `assets/ai/rival-policy-synthetic.json` (MLP 40→128→128→3, 22,147 params, ~441 KB, format `neon-rash-mlp@1`).
- Origin: generated in-repo by `tools/ai-train/train_bc.py --init-only --seed 7` (Xavier-uniform random init). **Not trained on any data — an untrained placeholder** so the B7 browser runner and feature flag have something deterministic to load. Its `meta.label` says so, and `meta.trained` is `false`.
- License: original generated content, project Apache-2.0. No external source.
- Date generated: October 3, 2026.
- Reproduce: `podman build -t neon-ai-train -f tools/ai-train/Containerfile .` then `podman run --rm -v "$PWD":/work -w /work neon-ai-train --init-only --seed 7 --out assets/ai/rival-policy-synthetic.json` (deterministic weights — only the `meta.exported` date field varies; see `tools/ai-train/README.md`).

## Rival policy net weights (behaviour cloning, heuristic expert)
- File: `assets/ai/rival-policy-bc.json` (MLP 40→128→128→3, 22,147 params, ~444 KB, format `neon-rash-mlp@1`).
- Origin: generated in-repo — `tools/gen-dataset.mjs` (headless `src/sim.js`, heuristic expert `driveRival`, all 4 worlds × all 6 bikes × 4 seeds = 96 races, 268,683 frames, DAgger-style noise bursts on the executed action) then `tools/ai-train/train_bc.py` (NumPy Adam, 20 epochs) in the `neon-ai-train` container. **Training data is heuristic-expert, not human** — labelled per record (`expert` field), in the tool output, and in `meta.label`/`meta.dataset`; no human telemetry exists yet.
- License: original generated content, project Apache-2.0. No external source.
- Date generated: October 3, 2026.
- Reproduce: `podman run --rm -v "$PWD":/app -w /app node:20 node tools/gen-dataset.mjs` then `podman run --rm -v "$PWD":/work -w /work neon-ai-train --data telemetry/heuristic-expert.jsonl --epochs 20 --out assets/ai/rival-policy-bc.json` (weights deterministic given the dataset; `meta.exported` varies). Evaluate before trusting: `node tools/eval-policy.mjs` (acceptance bands are declared in the tool).

## Other content
Five bikes, riders, road, scenery and synth audio are original procedural content. Three.js is MIT (bundled unchanged under `vendor/`, MIT is Apache-2.0-compatible); see vendor/THREE-LICENSE.txt. No assets from the original Road Rash executable are included. No downloaded Sketchfab models are included in this build.

## Shaders
The menu backdrop uses the 2D simplex noise function from **webgl-noise** by Ashima Arts and Stefan Gustavson, MIT licensed. The GLSL is inlined in `src/menu-backdrop.js`; see the inline comment for the original repository URL and license. This is the standard MIT-licensed Ashima/Gustavson simplex noise implementation.

## Notes
Bundled third-party components keep their own licenses (Three.js and webgl-noise are MIT; Kestrel and Kenney assets are CC0); MIT and CC0 are both compatible with the project's Apache-2.0 license. The Kestrel asset is a detailed geometric upgrade, not a photoreal scanned motorcycle. It has no source texture maps. The rider and districts still need a dedicated art pass.

## Future Sketchfab imports
Prefer CC0 or CC BY with clear original authorship. Record author, source URL, exact license, download date, modifications and attribution. Avoid NC/ND for this reusable build. A model license does not establish rights to manufacturer trademarks or ripped game content. Use official authorized downloads, then prepare GLB with named wheel pivots, metre scale, Y-up and nose toward -Z. Keep collision and gameplay capabilities separate from the visual mesh.
