# Decisions

Why things are the way they are. One entry per decision, newest first. The agent core (`AGENTS.md`) carries only the rule; the reason lives here.

## 2026-10-25 — cellular fields hash with the Perlin permutation table and loop by circling points

Voronoi (Worley) is a second kind of field, not a colour mode. Two choices: the cell hash reads the same permutation table as Perlin (so `base` seeds it, tiling wraps the same way, and the GPU port needs no second hash), and time makes every point circle inside its own cell with a per-cell phase instead of moving a third or fourth axis. A circling point closes the loop exactly with a 2D 3×3 search; a 4D Worley field would search 81 cells per pixel and octave. The cost is that the loop radius means nothing for cells, and the motion is a plain sine (harmonic), not the wandering of Perlin. A shader-native integer hash (as in the first spike) was rejected for the same reason as for the GPU renderer: it would fork every seed into two images.

## 2026-10-25 — relief lighting by a 3-point stencil, on both renderers

The first idea was Quilez' analytic noise derivatives for normals. They would have to be carried through the domain warp, layer 2 and tiling (a chain rule per feature), and would exist only in the shader. The flow mode already measures a slope with a 3-point stencil, so relief lighting reuses it: the same code on the CPU and the GPU, and it works with every feature that changes the height. The price is three samples (six with layer 2) and a slightly noisy slope in strongly warped areas. Flow and per-channel RGB ignore the overlay because they already need several samples per pixel.

## 2026-10-25 — the GPU renderer is a port of the CPU maths, opt-in, and stays out of presets

A WebGL2 spike (4D loop fBm with a hash-based noise) rendered 1080p in 7 ms against 1.2 s for the CPU path, which made a GPU renderer worth building. Three choices:

- **Port, not a second noise.** `perlin-gl.js` reads the same permutation table and gradients and mirrors the CPU functions, so a preset renders the same image on both renderers and the repo's determinism claims (ANGEBOT) survive. A shader-native noise (integer hash) would have been simpler and a little faster but would have forked every seed into two images. `scripts/check-gl-parity.mjs` is the proof: at most one colour level apart, tile exact, loop closure bytewise.
- **Opt-in, per viewer.** The renderer select defaults to CPU and lives in `localStorage`, not in presets or exports: it changes speed, never the image. Revisit the default after the GPU path has run on more than one machine (only an Apple M5 Pro, Chromium, was measured).
- **Fallback instead of parity everywhere.** Flow and multi-channel RGB need several noise samples per pixel and render on the CPU, frame by frame, rather than being ported in the first slice.

The Metal port in `macos/` is a second, independent copy of the same maths; the parity script does not cover it.

## 2026-10-25 — hero.png stays 1200×630 and over the PNG budget

`assets/hero.png` is the `og:image` (`index.html` declares 1200×630). Lossless recompression (`oxipng -o max -Z`) takes it from 832 KB to 576 KB, not below the 400 KB budget; the noise does not compress further. A 984×517 render fits (379 KB) but trips the linter's `image-scale` check (it assumes dpr-2 captures and flags files under 1200 px embedded wider than half their width), and embedding at 492 px would make the README hero much smaller. The gallery images were rendered at 560 px instead of 700 px (embedded at 280 px, 2× for retina) and all fit. Revisit if the linter learns to treat rendered images differently, or if `image-budget` starts weighing `assets/`.

## 2026-09-05 — one remote: Forgejo only

The GitHub mirror was removed. GitHub stays only where it is functionally required (the Obsidian store chain), and this is not a plugin; the GitHub account had been flagged since 2026-08-30, so the mirror was anonymously 404 anyway. The confidential security channel is e-mail (`security@jkaindl.de`, see `SECURITY.md` and `.well-known/security.txt`). The repo moved off Codeberg on 2026-07-30; the old `jkaindl.codeberg.page` deploy is frozen, not live.

## 2026-07-30 — deploy via `scripts/deploy-page.sh`

The site is published by rsync over SSH to `pages.jkaindl.de/perlin-studio/` instead of a Pages branch. The script carries the four macOS deploy guards of CORE-OPS-01 (real rsync 3.x, `--chmod=D755,F644`, no `grep -q` at the end of a pipe under `pipefail`, `${VAR}` braces before UTF-8); don't remove them. The old Codeberg deploy published the whole repo, the new one only the site, so `docs/examples/*.webm` and `dist/` are re-included explicitly: both are hotlinked from outside.

## Tags carry a `v` prefix

Every tag from `v0.4.0` on is `vX.Y.Z`. This deviates from CORE-GIT-03 (no prefix) and is a documented deviation: the prefix is the lived convention here, so new tags stay consistent with it.

## Zero-dependency, no-build (PROF-WEB-01)

The tool must run by double-clicking `index.html` and embed as a Web Component from a single script. That excludes ES modules (CORS under `file://`), a bundler and a framework; the five plain scripts attach `window` globals instead. Migrating to TypeScript, a bundler or a framework needs the maintainer's say-so.

## No package.json, no service worker

The native version lives only in `macos/packaging/Info.plist` (`scripts/bump-version.sh`), so a package.json would be a second place to drift (PROF-NAT-02 adapted). The PWA has no service worker on purpose, so there is no cache version to bump (PROF-WEB-04 not applicable).

## iOS Live Photo cannot animate as a wallpaper

Apple content-gates animated Live Photos as an iOS 26 wallpaper; a synthetic one animates in Photos only. Don't retry the graft.
