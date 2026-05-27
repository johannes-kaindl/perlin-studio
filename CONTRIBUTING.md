# Contributing

Thanks for your interest! This doc describes the developer workflow. It
aims to stay low-friction — the stack is intentionally small.

## Setup

There's no build step and no dependencies. You only need:

- A modern browser (Chrome, Firefox, Safari)
- Optional: Python 3 for a local server during development
- Optional: Node.js for the sanity checks

```bash
git clone https://codeberg.org/jkaindl/perlin-studio.git
cd perlin-studio
python3 -m http.server 8000
# → http://localhost:8000
```

Opening `index.html` by double-click works too, but a local HTTP server
is handier during development (hot reload on browser refresh, none of
the `file://` CORS rough edges when debugging).

## Code style

- **Vanilla JS**, ES2020+ browser targets. No TypeScript migration
  without discussion.
- **No dependencies** without a clear reason — the tool needs to stay
  statically deployable.
- **Comments and UI strings in English**, as well as identifiers and
  commit messages.
- Function names in `camelCase`, constants in `UPPER_SNAKE_CASE`.

Pragmatic: if you disagree with the existing style somewhere, raise it
in the issue/PR — we'll decide together.

## Tests

Three levels, in order of how often you'll touch them:

### 1. Syntax checks (mandatory before each commit)

```bash
node --check perlin.js && node --check perlin-studio.js
```

### 2. Math smoke tests (mandatory when changing `perlin.js`)

```bash
node scripts/smoke-test.js
```

The script runs 25 invariants in ~0.1 s. Exit 0 = all pass; exit 1
on any failure with a one-line reason. The Forgejo deploy workflow
runs the same script before publishing, so a regression here also
blocks the live site.

If you add a new top-level function to `perlin.js`:

1. List it in `MTPerlin = { ... }` at the bottom of the file so the
   smoke can import it.
2. Add it to the `${fn.toString()}` interpolation block in
   `WORKER_SOURCE` so the worker can call it too.
3. Add a smoke assertion for the new behaviour. Pattern: one test
   for the **off** state (bit-identical to pre-feature output —
   regression guard), one for the **on** state (output actually
   diverges meaningfully — guards against silent no-ops).

For ad-hoc investigations the smoke uses the same `global.window =
{}` + `require()` pattern documented in [AGENTS.md](AGENTS.md) — copy
that and explore.

### 3. Manual browser test

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

At least before submitting a PR:

- [ ] Default preset renders right after page load
- [ ] Play starts a smooth animation (no flicker)
- [ ] Loop toggle switches between loop and linear mode, slider adapts
- [ ] All 9 built-in presets load without console errors
  (`default`, `lava`, `aurora`, `clouds`, `terrain`, `circuit`,
  `marble`, `nebula`, `flow`)
- [ ] Warp section: pushing `strength` above 0 visibly distorts the
  noise; pulling it back to 0 returns to the baseline look
- [ ] Tile X / Y: setting both to a small integer (4–8) produces a
  visibly repeating texture
- [ ] Custom gradient: picking `Custom …` in the gradient dropdown
  reveals the inline stops editor; adding / removing / dragging
  stops updates the preview live
- [ ] RGB → Per-channel noise toggle changes the output visibly
  (channels drift independently)
- [ ] Flow colour mode renders a wind-map-like image (not a noise
  pattern)
- [ ] Theme toggle (sun/moon, top-right of the topbar) flips dark↔
  light and the choice survives a reload
- [ ] WebM export produces a downloadable file that plays in VLC
- [ ] WebM with loop=on repeats seamlessly
- [ ] Resizing `width`/`height` renders at the new resolution
- [ ] FPS counter shows sensible numbers during play

If your browser blocks the worker: the FPS counter says `… (main)` —
that's the main-thread fallback, not an error.

## Pull requests

1. **Branch** from `main` with a descriptive name (`feature/gradient-editor`,
   `fix/loop-float-edge`).
2. **Commit messages in English**, imperative mood (e.g. `Loop toggle
   updates slider range`).
3. **Update CHANGELOG.md** in the `[Unreleased]` section.
4. **Description**: what changed, why, how it was tested.

PRs without visible test effort will be returned.

## Issues

Bug reports — ideally include:
- Browser + version
- Step-by-step reproduction
- Console output if any
- What you expected vs. what happened

Feature requests — ideally include a concrete use case. The math/render
architecture in particular is sensitive to unmotivated changes.

## Out of scope

Please **discuss before working on**:

- Migration to frameworks (React, Vue, Svelte) or bundlers (Webpack, Vite)
- Adding dependencies that aren't small and essential
- Mocks/stubs for internal modules — sanity checks are sufficient
- File renames without a refactoring reason
- Auto-formatting across the whole repo

## License

Contributions are released under [GNU AGPL-3.0](LICENSE). By submitting
a PR you agree that your contribution will be published under this
license.
