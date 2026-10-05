# Contributing to YORU

Thanks for your interest. This is a solo-maintained, no-build, vanilla-Three.js
browser game — contributions that respect those constraints are welcome.

## Ground rules

- **No build step.** The game runs directly in the browser from static files.
  Three.js r180 is vendored under `vendor/` and loaded via the import map in
  `index.html`. Do not add a bundler or a runtime npm dependency.
- **Dense style in `src/`.** `src/*.js` uses a dense, minimal-whitespace style
  (see `src/timing.js`, `src/physics.js`). Match it for new code and do not
  reformat existing files.
- **Saved data is sacred.** Do not rename `localStorage` keys or the
  `neon-rash-mlp@1/@2` weight-format tags — existing records, setups and
  policy weights must keep loading.
- **Asset provenance is mandatory.** Any imported 3D model, texture, font or
  other external asset must get a provenance entry in `ASSETS.md` (source,
  author, exact license + URL, date checked, files kept, changes made,
  reproduce steps). Prefer CC0 or CC BY; avoid NC/ND.

## Testing (container-first)

Run the Node test suite in a container so results are reproducible:

```
podman run --rm -v "$PWD":/app -w /app node:20 npm test
```

(`docker` works the same.) All tests must pass before submitting. Add tests for
new pure-logic code where feasible — pure functions are testable without a
browser/WebGL context; visual/render code may reasonably skip coverage if you
state the reason.

Optional browser smoke tests (SwiftShader software rendering — proves the game
boots and plays, not real-GPU performance):

```
npm install --no-save --omit=optional playwright
npx playwright install chromium
node tests/browser-v3-smoke.cjs
```

## Pull requests

- Describe what changed, why, and how it was verified (test counts, container
  image, browser/GPU where relevant).
- Update `CHANGELOG.md` for user-facing changes.
- See `CLAUDE.md` for the full repo conventions and `ROADMAP.md` for direction.

## License

By contributing you agree that your contributions are licensed under the
project's Apache-2.0 license (see LICENSE and NOTICE).
