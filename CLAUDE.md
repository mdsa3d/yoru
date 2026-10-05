# YORU — Agent Context

Concise conventions for Claude/agent sessions working in this repo. For full project docs see `README.md`; for asset provenance see `ASSETS.md`; for release notes see `CHANGELOG.md`.

## Build and runtime

- **No build step.** The game runs directly in the browser from static files.
- **Three.js r180 is vendored** under `vendor/` and loaded via the import map in `index.html`:
  ```json
  {"imports":{"three":"./vendor/three.module.js","three/addons/":"./vendor/addons/"}}
  ```
  Do not add a bundler or install Three.js from `node_modules` for the runtime.

## Dev server

- `node server.mjs` serves the game on `http://localhost:8080`.
- Optional Laya decision service: `node server.mjs --laya` or `LAYA=1 node server.mjs`.
- The server is for local development only; it is not a hardened production host.

## Code style

- `src/*.js` uses a **dense, minimal-whitespace style** (see `src/timing.js`, `src/physics.js`).
- Match this style for new code; do not reformat existing files to a different style.

## Tests

- `npm test` runs all Node tests in `tests/*.test.mjs`.
- Currently 29 tests pass. Any change must keep them passing.
- Add tests for new pure-logic code where feasible. Pure functions can be tested without a browser/WebGL context; visual/render code may reasonably skip coverage — state the reason when skipping.

## Assets

- Any imported 3D model, texture, font, or other external asset **must** get a provenance entry in `ASSETS.md`.
- Required fields: source, author, exact license + URL, date checked, files kept, changes made, and reproduce steps. See the existing Kestrel and Kenney entries for the exact format.

## Changelog

- Update `CHANGELOG.md` for user-facing changes.

## Security / project-local skills

- This repo has one project-local Claude Skill installed: `three-best-practices` (plain-markdown MIT content, vetted, see `.claude/skills/README.md`).
- Any future skill or plugin addition must be reviewed the same way: fetch and read the actual `SKILL.md`/script content before installing, prefer small single-purpose repos over large aggregators, and never blindly run third-party installer scripts.
