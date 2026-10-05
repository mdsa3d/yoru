## What

<!-- What changed and why. Link issues; update CHANGELOG.md for user-facing changes. -->

## Verification

- [ ] `podman run --rm -v "$PWD":/app -w /app node:20 npm test` passes (N/N tests)
- [ ] Browser smoke checked (state renderer: real GPU vs SwiftShader)
- [ ] `ASSETS.md` provenance added for any new external asset
- [ ] No `localStorage` keys or `neon-rash-mlp@` format tags renamed
- [ ] `src/` changes match the existing dense style; no reformat-only diffs

## Notes for reviewers

<!-- Hardware tested (GPU/browser), ?bench=1 numbers if perf-relevant, anything unverified. -->
