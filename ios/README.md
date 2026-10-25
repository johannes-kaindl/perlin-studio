# Perlin Live Photo — native iOS/iPadOS app

A native SwiftUI app that turns the studio's Perlin noise into an **Apple Live
Photo** on your iPhone/iPad: a live Metal preview, curated controls, image
masking, and one-tap export to Photos.

It reuses the **portable core** of the macOS app (`../macos/Sources/PerlinLiveWallpaper/`)
by file reference — the noise renderer (Metal), presets, gradients, and the
`AVAssetWriter` Live Photo exporter are shared, single-sourced. Only the SwiftUI
UI (`ios/Sources/*.swift`) is iOS-specific.

## What it does

- **Live preview** of the animated noise (`MetalPreviewView`, an `MTKView`
  running the shared `Renderer`).
- **Curated controls** bound directly to the preset: preset, colour mode,
  gradient, zoom, detail, warp, speed. (More controls are additive — each is one
  SwiftUI binding to an existing `Preset` field.)
- **Image masking** — pick a photo as an alpha-or-luminance mask (fit/fill,
  invert) so the noise shows only inside a shape (e.g. flames/smoke in a form),
  composited over **black** or the **source image**.
- **Create Live Photo** — renders an HEVC clip + paired HEIC still (with the
  QuickTime content-identifier + still-image-time markers) and saves the Live
  Photo straight to **Photos** (`PHAssetCreationRequest`).

## Build & run

Requires Xcode and `xcodegen` (the `.xcodeproj` is generated, not committed):

```sh
cd ios && xcodegen generate && cd ..
# Simulator:
xcodebuild -project ios/PerlinLivePhoto.xcodeproj -scheme PerlinLivePhoto \
  -sdk iphonesimulator -configuration Debug -derivedDataPath ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
# Device (Developer-account signing):
xcodebuild -project ios/PerlinLivePhoto.xcodeproj -scheme PerlinLivePhoto \
  -sdk iphoneos -configuration Debug -derivedDataPath ios/DerivedData \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<your-team> CODE_SIGN_STYLE=Automatic build
```

The shared core (and the Live Photo export) is headlessly testable from the
macOS package: `swift run --package-path macos PerlinLiveWallpaper --selftest`.

## Note on animated wallpaper

The generated Live Photo animates **in Photos** (long-press). It does **not**
work as an *animated lock-screen wallpaper*: iOS gates animated Live Photo
wallpapers to genuine camera captures (verified — even a real transplanted
`live-photo-info` track is rejected for synthetic frames). The **still** works as
a wallpaper. The design history was in `docs/superpowers/specs/` until 2026-10-26 (see `git log -- docs/superpowers`).
