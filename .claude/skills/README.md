# Project-local Claude Skills

This directory contains project-local skills used by Claude/agent sessions working on YORU (formerly NEON RASH 3). These are plain-markdown reference files, not executable scripts.

## Installed skills

### `three-best-practices`

- **Source repository:** https://github.com/emalorenzo/three-agent-skills
- **Exact subpath used:** `skills/three-best-practices/`
- **License:** MIT
- **Date installed:** 2026-09-23
- **Why this skill:** This project uses vanilla Three.js r180 with no build step and no React, so the React Three Fiber skill in the same source repo (`r3f-best-practices`) is not applicable. The `three-best-practices` skill covers memory/dispose patterns, GLTF loading, GLSL shaders, mobile performance, and general WebGL optimization — all directly relevant to existing bugs and features in this codebase.
- **Files kept:** `SKILL.md` and all `rules/*.md` files from the subpath above. No scripts, package manifests, or repository-root files (e.g. `AGENTS.md`, `R3F_BEST_PRACTICES.md`, `package.json`) were copied.
- **Vetting:** The source repository was confirmed via GitHub API tree listing to contain only markdown files in this subpath. The files were fetched with a sparse git checkout; no third-party installer script was executed.

### `threejs-shaders`, `threejs-postprocessing`, `threejs-lighting`, `threejs-materials`, `threejs-textures`, `threejs-animation`, `threejs-interaction`, `threejs-loaders`, `threejs-fundamentals`, `threejs-geometry`

- **Source repository:** https://github.com/CloudAI-X/threejs-skills
- **Exact subpaths used:** all 10 subdirectories under `skills/` (full set — `threejs-shaders`, `threejs-postprocessing`, `threejs-lighting`, `threejs-materials`, `threejs-textures` installed 2026-09-23; `threejs-animation`, `threejs-interaction`, `threejs-loaders`, `threejs-fundamentals`, `threejs-geometry` added 2026-09-24 once the project moved into an active improvement phase and the overlap-with-`three-best-practices` tradeoff was no longer a reason to skip them — more reference coverage is pure upside once already vetted).
- **License:** MIT
- **Why these skills:** API-reference/tutorial-style Three.js patterns (GLSL/ShaderMaterial, EffectComposer/bloom/DOF, light/shadow setup, PBR materials, UV/env-map/render-target textures, keyframe/skeletal/morph-target animation, GLTF/texture loading + async patterns, raycasting/camera-controls/input, scene/camera/renderer fundamentals, instancing/custom BufferGeometry) — complementary to `three-best-practices`, which is optimization-focused rather than API-reference-focused.
- **Vetting caveat:** the source repo has 3,300+ stars but was created 2026-01-19 by a GitHub account created only 16 days earlier (2026-01-03) — a pattern consistent with star inflation. Its own README also links a clone command to a different, nonexistent repository (`pinkforest/threejs-playground`, 404), which is at minimum sloppy and was not corrected before install. Despite this, every `SKILL.md`'s actual content (fetched directly, not via the README's broken instructions or any installer script) contains only plain Markdown/JS/GLSL code examples, and each file was scanned for prompt-injection and command-execution patterns with none found across all 10 modules. Installed on content merit; provenance credibility is lower than `three-best-practices` and should be re-reviewed if this source repo changes materially.

## Adding future skills

1. Read the actual `SKILL.md` and any rule/script content before installing.
2. Prefer small, single-purpose repositories over large aggregators or registry sources.
3. Never blindly run third-party installer scripts (`npx add-skill`, curl-to-shell, etc.).
4. Record provenance here: source URL, exact subpath, license, date, rationale, and vetting notes.
