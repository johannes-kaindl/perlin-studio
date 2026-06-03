# Perlin Live Wallpaper (macOS)

A small menu-bar app that renders [Perlin Studio](../)'s noise **live** as an
animated macOS desktop background, on the GPU via Metal.

## Honest caveat: this is a desktop-level window, not a "system wallpaper"

There is **no public API** on macOS for a third-party app to install a moving
wallpaper. Apple's own animated wallpapers run through a private system
extension; the legacy `ScreenSaver` framework is unreliable on macOS 26 (Tahoe).
The only robust, smooth, public-API route — the one used by Plash, Backdrop,
Wallper, etc. — is to draw a borderless window pinned at **desktop level**
(above the desktop picture, below the icons). That's what this app does. It uses
**only public AppKit + Metal**, no private APIs.

Consequence: the noise sits behind your icons like a wallpaper, but macOS still
considers your *real* wallpaper to be whatever is set in System Settings.

## Requirements

- macOS 14+ (developed and tested on macOS 26 "Tahoe", Apple Silicon)
- Swift toolchain (Xcode or Command Line Tools)

## Build & run

```bash
cd macos
node scripts/export-presets.js   # regenerate presets if perlin-presets.js changed
swift build
swift run
```

It appears as a menu-bar icon (no Dock icon). The menu lets you pick a preset,
pause/resume, and toggle **Pause on battery** (on by default). It renders on all
displays and auto-pauses when fully covered (e.g. a fullscreen app) or on
battery.

A signed, notarized `.app` bundle for sharing is a later step; `swift run` is
enough for personal use and on-device testing.

## Headless validation

```bash
swift run PerlinLiveWallpaper --selftest             # compile shader + render all presets offscreen
swift run PerlinLiveWallpaper --render marble out.png # render one preset to a PNG (parity check)
```

`--selftest` compiles the runtime MSL, builds the pipeline and renders every
bundled preset to an offscreen buffer, asserting a non-trivial varied field
(exit 0 on success) — the GPU counterpart to the studio's `smoke-test.js`.

## How it relates to the studio

Noise **parameters** stay single-source in the studio's `perlin-presets.js`;
`scripts/export-presets.js` resolves them to JSON the app decodes. The noise
**algorithm** is re-implemented in Metal Shading Language (`NoiseShader.swift`),
a direct port of `perlin.js` (non-tiling 3D advancing-time path). v1 supports
the gradient / posterize / hsv colour modes; `flow` and per-channel RGB are
deferred.
