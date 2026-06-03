# Design — Perlin Live Wallpaper (macOS)

**Date:** 2026-06-03
**Status:** Approved (design), implementation autonomous
**Scope:** A native macOS companion app that renders the studio's Perlin noise
live as an animated desktop wallpaper. First target of a possible
cross-platform "wallpaper generator" direction; iOS/iPadOS deferred.

---

## 1. Background & feasibility (verified)

A multi-agent research pass (6 dimensions, adversarially verified) established
the hard constraints on Apple platforms as of **iOS/iPadOS/macOS 26** (June 2026):

- **No public API** lets a third-party app *set* the wallpaper on iOS (only the
  Shortcuts "Set Wallpaper" action — stills only, user-installed). macOS has
  `NSWorkspace.setDesktopImageURL` but it sets **static / dynamic-HEIC images
  only — never video**.
- True **animated/video wallpapers** (Apple "Aerials") run through a **private**
  `WallpaperAerialsExtension` (undocumented XPC). Third parties cannot register
  custom video as a real system wallpaper. An Apple DTS engineer stated a public
  appex screensaver API "won't happen in macOS 26".
- The legacy `ScreenSaver` `.saver` framework still exists but is **severely
  broken on Tahoe** (runaway CPU/GPU/RAM, secondary-monitor failures) — ruled out.
- The only way to a **smooth, live, third-party** animated desktop is a
  **borderless window pinned at desktop level behind the icons** (the
  Plash / Backdrop / Wallper pattern). This uses **public AppKit only** — no
  private APIs, App-Store-distributable — but is architecturally "a window
  faking a wallpaper", not an Apple-declared wallpaper API.

### Decisions taken (with the user)

1. **First target:** macOS live desktop (over iPhone lock screen / dynamic HEIC).
2. **Approach:** native menu-bar app drawing a desktop-level window — the
   *least-hacky option that still delivers genuine live motion* (public AppKit,
   no private APIs, no broken legacy framework).
3. **Renderer:** **Metal** fragment shader (`MTKView`) computing fBm Perlin on
   the GPU — native, lowest-power for live rendering, never-repeating. Accepted
   cost: the **noise algorithm** is re-implemented in MSL (a second source for
   the *algorithm*; **parameters/presets stay single-source** in the JS).
4. **Battery default:** auto-pause on battery / Low Power Mode is **ON** by default.
5. **Repo layout:** lives in a **`macos/`** subdirectory of this repo (shared
   license, presets, docs; the zero-build web core is untouched).
6. **Distribution:** Developer-ID-notarized build / direct Xcode run for personal
   + on-device use. Mac App Store optional later.

---

## 2. Goals / non-goals

**Goal (MVP):** an on-device-runnable macOS 26 app that renders a chosen
Perlin preset as a smooth, infinite, never-repeating desktop wallpaper across
all displays, with proper power behaviour, driven by presets authored in the
existing studio.

**Non-goals (v1):**
- iOS/iPadOS Live Photo path (separate future spec).
- The studio's `flow` and per-channel-RGB (`rgbMultiChannel`) colour modes
  (multi-sample stencils — deferred).
- Tileable noise / 4D loop mode (a wallpaper wants infinite advance, not a loop).
- In-app parameter editor or gradient editor (presets only).
- Domain warp is **in** (cheap, needed for `marble`); layer-2 compositing is
  **out** of v1 (would need a second noise field per pixel — deferred).

**Parked (separate fix, not this feature):** `perlin-studio.js`
`chooseRecorderMime()` offers only `video/webm`, so MediaRecorder recording
silently fails on Safari/iOS today. Relevant only for the future iOS path.

---

## 3. Architecture

A single SwiftPM **executable** target (`PerlinLiveWallpaper`), pure AppKit +
Metal/MetalKit, **no third-party Swift dependencies**. Built and compile-checked
with `swift build`; runs as an accessory (menu-bar-only) app via
`NSApp.setActivationPolicy(.accessory)` — no `Info.plist` `LSUIElement` needed,
no `.xcodeproj` required for the MVP.

### Components (each one file, one responsibility)

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `main.swift` | Bootstraps `NSApplication`, accessory policy, installs `AppController`. | AppKit |
| `AppController.swift` | Owns the `NSStatusItem` + menu (preset list, Pause/Play, "Pause on battery", Quit), the `WallpaperWindowManager`, and the `PowerMonitor`. Wires user intent → state. | AppKit |
| `WallpaperWindowManager.swift` | One desktop-level `NSWindow` per `NSScreen`; reacts to screen connect/disconnect & arrangement changes; pushes the active preset + paused state to each window's renderer. | AppKit |
| `DesktopWindow.swift` | A single borderless desktop-level window hosting one `MetalNoiseView`; carries occlusion-based pause. | AppKit, Metal |
| `MetalNoiseView.swift` | `MTKView` subclass: owns the `Renderer`, drives the frame clock, applies the FPS cap, and reports occlusion. | MetalKit |
| `Renderer.swift` | Metal device/queue/pipeline; builds the permutation buffer + gradient LUT texture from a `Preset`; sets uniforms; encodes the full-screen-triangle draw. Compiles MSL **from source at runtime** (`makeLibrary(source:)`) — no metallib build step. | Metal |
| `NoiseShader.swift` | The MSL source as a Swift string constant (fade/grad/perlin3/fbm3/warp + gradient/posterize/hsv colour). | — |
| `Preset.swift` | `Codable` model mirroring the resolved studio params (incl. gradient stops); maps `colorMode` → an Int the shader switches on. | Foundation |
| `PresetStore.swift` | Loads the bundled resolved-preset JSONs, exposes an ordered list + a default. | Foundation |
| `PowerMonitor.swift` | Publishes on-battery / Low-Power-Mode changes (`IOPSCopyPowerSourcesInfo`, `ProcessInfo.isLowPowerModeEnabled` + `NSProcessInfoPowerStateDidChange`). | IOKit, Foundation |

### The desktop-level window (load-bearing technique)

For each `NSScreen`:
- `NSWindow(contentRect: screen.frame, styleMask: .borderless, …)`
- `window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)`
  — above the desktop picture, below the icons.
- `collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]`
- `ignoresMouseEvents = true`, `isOpaque = true`, `hasShadow = false`,
  `backgroundColor = .black`, not in the window cycle, no title bar.
- Observe `NSApplication.didChangeScreenParametersNotification` to rebuild
  windows on display changes.

This is the only "workaround" in the design; everything else is conventional.
Documented honestly in the app's README as "a desktop-level window, not a
system wallpaper".

---

## 4. The Metal renderer

### Noise (MSL port of `perlin.js`, parity-checked)

Ported verbatim from `perlin.js`, **non-tiling path only** (`repeat = 0`, i.e.
`& 255`), 3D advancing-time model (`loop = false`):

- `makePermutation(base)` is computed **in Swift** (exact port: `offset =
  ((base%256)+256)%256`, `perm[i] = BASE_PERM[(i+offset)&255]`, duplicated to
  512) and uploaded as a 512-entry `uint` buffer. Keeps the seed identical to
  the studio.
- MSL: `fade`, `lerp`, `grad(hash,x,y,z)`, `perlin3`, `fbm3(octaves,
  persistence, lacunarity)` — direct translations of the JS. `fbm3` returns
  `[0,1]` exactly as the JS (`(n+1)*0.5`).
- **Domain warp** (`warpedFbm3`): two single-octave `perlin3` displacements with
  the same `137/23` and `211/-53` offsets, gated by `warpStrength`.

### Screen-space → noise-space mapping (visual parity)

The studio tuned presets against a `width×height` preview (e.g. 384×256).
To preserve a preset's *composition* at any screen resolution without stretch:

```
unitsPerPixel = 1.0 / drawableHeight        // reference = screen height
coordX = fragX * unitsPerPixel * presetHeight * scaleX
coordY = fragY * unitsPerPixel * presetHeight * scaleY
```

A wider screen reveals *more* noise horizontally (no distortion);
`scaleX != scaleY` presets (e.g. `aurora`) keep their intended anisotropy.

### Time

`tz = elapsedSeconds * scaleT`, where `elapsedSeconds` comes from a monotonic
clock (`CACurrentMediaTime()`), matching the studio's "`t += 1`/s, scaled by
`scaleT`" convention. Infinite, non-repeating.

### Colour (1D LUT in the shader)

- Build a **256×1 RGBA gradient texture** on the CPU from the preset's resolved
  `gradient` stops (linear interpolation — exact port of `gradientLookup`).
- Shader colour modes (uniform `colorMode` int):
  - `gradient` → sample the LUT at the noise value.
  - `posterize` → quantise `floor(n*steps)/(steps-1)` then sample the LUT
    (exact port).
  - `hsv` → `hue = hsvHueShift + n*hsvHueRange`, `hsvToRgb` in MSL.
- v1 bundles presets using only these modes.

### Draw

Full-screen triangle (no vertex buffer); fragment shader does noise → colour.
FPS capped via `MTKView.preferredFramesPerSecond` (default **30**). Paused state
sets `isPaused = true` / stops the clock so the GPU is idle.

---

## 5. Power & lifecycle

| Trigger | Behaviour |
|---------|-----------|
| Window fully occluded (`occlusionState` loses `.visible`) | pause that window's `MTKView`. |
| A fullscreen app / Space covers the desktop | follows from occlusion → paused. |
| Display sleep / screen lock | system stops drawing; `MTKView` idles. |
| On battery / Low Power Mode (default ON) | pause all rendering; resume on AC. Toggle in the menu. |
| Display connect/disconnect/rearrange | `WallpaperWindowManager` rebuilds windows. |

The per-display occlusion pause solves the #1 complaint about live-wallpaper
apps (battery drain) from day one.

---

## 6. Preset sharing (single source for parameters)

Parameters stay authored once in `perlin-presets.js`. A tiny **Node export
script** (`macos/scripts/export-presets.js`, reusing `resolveParams` +
`BUILTIN_PRESETS` exactly like the smoke test imports them) writes
`macos/Sources/PerlinLiveWallpaper/Resources/presets/<name>.json` — the same
resolved shape as `examples/marble.json`. The Swift `Preset` is `Codable`
against that shape. Regenerating presets is a documented one-liner; the
algorithm port is validated separately by visual parity.

**v1 bundled presets** (gradient / posterize / hsv only):
`default`, `lava`, `aurora`, `clouds`, `terrain`, `circuit`, `marble`,
`composite`. Excluded for now (documented): `nebula` (rgbMulti), `flow`.

---

## 7. Repo layout

```
macos/
├── Package.swift
├── README.md                         # what it is, the "window not wallpaper" honesty, build/run
├── .gitignore                        # .build/
├── scripts/
│   └── export-presets.js             # perlin-presets.js → Resources/presets/*.json
└── Sources/PerlinLiveWallpaper/
    ├── main.swift
    ├── AppController.swift
    ├── WallpaperWindowManager.swift
    ├── DesktopWindow.swift
    ├── MetalNoiseView.swift
    ├── Renderer.swift
    ├── NoiseShader.swift
    ├── Preset.swift
    ├── PresetStore.swift
    ├── PowerMonitor.swift
    └── Resources/presets/*.json       # generated, but committed for a buildable checkout
```

Conventions follow `AGENTS.md`: **English** identifiers/UI strings/comments;
comments explain *why*; no third-party Swift deps.

---

## 8. Distribution & on-device testing

- **MVP:** `swift build` then run the produced binary, or `swift run`. It
  becomes a menu-bar app immediately (accessory policy). Good enough to validate
  on the user's own Mac.
- **Shareable build:** a Developer-ID-signed + notarized `.app` later (the user
  has a paid account). Packaging into a real `.app` bundle (Info.plist,
  signing) is a follow-up once behaviour is confirmed.

---

## 9. Risks / validate early on-device

1. **Window placement on Tahoe 26.x:** the wallpaper subsystem is reportedly
   fragile in 26.x; confirm the window sits behind icons, across all Spaces and
   displays, and doesn't fight Stage Manager / fullscreen. *(Highest risk.)*
2. **Real power draw** at 30 fps full-screen Metal on a 4K/5K display; tune the
   FPS cap if needed.
3. **Visual parity** shader ↔ studio for each bundled preset (especially warp
   and the screen-space mapping).
4. **Runtime MSL compile** succeeds under SwiftPM (no Xcode metallib step).

---

## 10. Build sequence (for the plan)

1. Scaffold `macos/` (Package.swift, .gitignore, README stub).
2. `export-presets.js` → generate the 8 preset JSONs; commit them.
3. `Preset` + `PresetStore` (+ decode test against the generated JSON).
4. `NoiseShader` (MSL) + `Renderer`; compile-check via a tiny offscreen render.
5. `MetalNoiseView` (clock, FPS cap, occlusion).
6. `DesktopWindow` + `WallpaperWindowManager` (the desktop-level technique).
7. `PowerMonitor` + wire battery pause.
8. `AppController` (status item, menu) + `main.swift`.
9. `swift build` green; manual on-device smoke (the user runs it).
10. Adversarial code review pass; fix; commit.
```
