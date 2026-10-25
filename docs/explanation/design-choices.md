# Design choices

Why Perlin Studio is built the way it is. The decisions are short; the long-form reasons live in `docs/internal/decisions.md` for contributors.

## No build, no dependencies

The studio is plain scripts that attach a global each, loaded in order. That keeps three properties: it opens by double-clicking `index.html` (`file://`), any static web host serves it as is, and the `<perlin-noise>` element can be embedded from a single file. ES modules would break the first of these (module scripts are blocked under `file://`), and a bundler or framework would break all three. What you read in the repository is what runs.

## One noise, two renderers

The CPU path (a worker running `perlin.js`) is the reference. The GPU path (`perlin-gl.js`, a WebGL2 shader) is a port of the same maths — same permutation table, same gradients, same warp, tiling, layers and colour modes — so a preset gives the same picture on both and a seed means the same thing. A shader-native noise would have been shorter and a little faster, but it would have split every seed into two different images. The GPU path is opt-in and checked against the CPU by a script, not trusted.

## Loops by construction

The seamless loop is not a cross-fade. In loop mode the noise is four-dimensional and the two extra axes trace a circle, so after one revolution every input is back where it started. The angle is folded into `[0, 1)` before any trigonometry, so progress 1 is computed exactly like progress 0. The cellular noise types loop differently — each point circles inside its own cell — for the same reason: an exact return, not an approximation.

## Relief lighting from three samples

The surface slope for relief lighting comes from the same three-sample stencil as the Flow colour mode, rather than from analytic derivatives. Analytic derivatives would have to be carried through the domain warp, the second layer and the tiling; the stencil costs more samples but works with every feature and is the same code on both renderers.

## No service worker

The installable app has no offline cache on purpose. The site is small, always served fresh, and a cache would add a version to bump with every release. See [Install as an app](../how-to/install-the-pwa.md).

## Where to read more

- How the code is layered and how the maths works: [Architecture](architecture.md).
- What the controls do to the picture: [How the parameters shape the image](how-the-parameters-shape-the-image.md).
