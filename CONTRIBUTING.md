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

There's no formal test suite. Instead three levels:

### 1. Syntax checks (mandatory before each commit)

```bash
node --check perlin.js && node --check perlin-studio.js
```

### 2. Math sanity checks (when changing `perlin.js`)

Write a temporary Node script that verifies the Perlin properties.
Template:

```js
global.window = {};
require("./perlin.js");
const P = global.window.MTPerlin;

const perm = P.makePermutation(42);

// 1. Reproducibility
console.assert(P.perlin3(perm, 1.3, 2.7, 0.5) === P.perlin3(perm, 1.3, 2.7, 0.5));

// 2. Grid-point value = 0
console.assert(Math.abs(P.perlin3(perm, 1, 1, 0)) < 1e-10);

// 3. Value range
let min = Infinity, max = -Infinity;
for (let i = 0; i < 10000; i++) {
  const v = P.perlin3(perm, Math.random()*100, Math.random()*100, Math.random()*100);
  if (v < min) min = v; if (v > max) max = v;
}
console.assert(min > -1 && max < 1);
console.log("perlin3 range:", min, max);

// 4. Loop identity (for perlin4 with a circular orbit)
const r = 0.5;
const a = P.perlin4(perm, 1, 1, Math.cos(0)*r, Math.sin(0)*r);
const b = P.perlin4(perm, 1, 1, Math.cos(2*Math.PI)*r, Math.sin(2*Math.PI)*r);
// Not exactly identical in practice because of floats — `safeProgress` makes it robust
console.log("Loop endpoints diff:", Math.abs(a - b));
```

### 3. Manual browser test

At least before submitting a PR:

- [ ] Default preset renders right after page load
- [ ] Play starts a smooth animation (no flicker)
- [ ] Loop toggle switches between loop and linear mode, slider adapts
- [ ] All 6 built-in presets load without console errors
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
