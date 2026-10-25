# Decisions

Why things are the way they are. One entry per decision, newest first. The agent core (`AGENTS.md`) carries only the rule; the reason lives here.

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
