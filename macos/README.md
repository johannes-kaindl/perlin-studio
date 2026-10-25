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
pause/resume, and toggle **Animate on battery**. It renders on all displays.

**Open Editor…** (⌘E) runs the full Perlin Studio in a window; editing live-drives
the wallpaper (an injected bridge forwards the studio's parameters — the web
source is untouched). Your last look is remembered across launches. An **image
mask** set in the editor also drives the wallpaper: the window goes non-opaque so
your real desktop wallpaper shows through where the mask hides the noise. The mask
keeps its aspect ratio (never stretched) — toggle **Mask: Fill screen** to switch
between fit (whole image, margins show your wallpaper) and fill (cover, cropped).

**Save Current as…** stores the current look (params + mask) as a named preset in
the menu; saved looks apply as a complete look on click (hold Option to remove).

Frames are driven by the app's own run-loop timer (MTKView's internal display
link doesn't fire reliably for a desktop-level window). Power policy follows the
power *source*: on AC it runs at 30 fps; on battery it pauses by default, or runs
at a reduced 10 fps if **Animate on battery** is enabled.

A signed, notarized `.app` bundle for sharing is a later step; `swift run` is
enough for personal use and on-device testing.

## Live Photo export (animated iPhone wallpaper)

"Export Live Photo…" turns the current preset into an Apple Live Photo and adds
it to Photos (with iCloud Photos on, it appears on your iPhone). Set it manually:
**iPhone → Settings → Wallpaper → Add New Wallpaper → Photos → "Live Photo"
filter → pick it → Add → Set as Wallpaper Pair**, with the Live-Photo play
toggle ON. There is no API to set the wallpaper automatically. Headless:
`swift run --package-path macos PerlinLiveWallpaper --export-livephoto <preset> <out-basename>`.

The same Live Photo can be used as an animated Apple Watch *Photos* face (it
animates on touch-and-hold, or on wrist-raise with Always-On Display off).

## Headless validation

```bash
swift run --package-path macos PerlinLiveWallpaper --selftest             # compile shader + render all presets offscreen
swift run --package-path macos PerlinLiveWallpaper --render marble out.png # render one preset to a PNG (parity check)
```

`--selftest` compiles the runtime MSL, builds the pipeline and renders every
bundled preset to an offscreen buffer, asserting a non-trivial varied field
(exit 0 on success) — the GPU counterpart to the studio's `smoke-test.js`.

## How it relates to the studio

Noise **parameters** stay single-source in the studio's `perlin-presets.js`;
`scripts/export-presets.js` resolves them to JSON the app decodes. The noise
**algorithm** is re-implemented in Metal Shading Language (`NoiseShader.swift`),
a direct port of `perlin.js` (non-tiling 3D advancing-time path). It covers
every studio colour mode — gradient / posterize / hsv / rgb (incl. per-channel
"nebula") / flow — plus the domain warp, `layer2` compositing and the image mask
(see above). Tileable noise is the only studio feature not ported.

## Packaging a signed, notarized `.app`

> Full distribution & Gatekeeper guide (signing, notarization, "Open Anyway"):
> [`docs/how-to/install-the-macos-app.md`](../docs/how-to/install-the-macos-app.md).

`scripts/build-app.sh` assembles `dist/Perlin Live Wallpaper.app` (menu-bar app,
icon from the studio art), Developer-ID signs it with the hardened runtime, and
— with `--notarize` — notarizes and staples it. `dist/` is gitignored.

```bash
cd macos
./scripts/build-app.sh                 # build + assemble + Developer-ID sign
```

To notarize, set up a notarytool keychain profile once (it stores an
app-specific password from appleid.apple.com — nothing secret lives in the repo):

```bash
xcrun notarytool store-credentials jkaindl \
  --apple-id you@example.com --team-id U9X7M39R56 --password <app-specific-pw>

./scripts/build-app.sh --notarize      # build, sign, notarize, staple
```

The result is a double-clickable, Gatekeeper-approved `.app`. Override the
signing identity or profile with `SIGN_ID=…` / `NOTARY_PROFILE=…`.
