# Design — Native iOS editor (full Perlin app)

**Date:** 2026-06-05
**Status:** Approved (design), implementation pending
**Scope:** Grow the proof-of-concept iOS app (`ios/` — currently just a preset
picker + "Generate Live Photo") into a full **native SwiftUI editor**: a live
Metal preview, curated parameter controls, image masking (the creative
highlight — "flames/smoke inside a shape"), and a mask-aware Live Photo export.
Builds on the iOS app from `2026-06-04-ios-live-photo-design.md` (Phase 2 / the
deferred native app), now realized.

---

## 1. Background / what exists

- `ios/` already has a working app on-device: SwiftUI `App` + a one-screen
  `ContentView` (preset menu + "Generate Live Photo"), reusing the portable core
  from `macos/Sources/PerlinLiveWallpaper/` by file reference (`Renderer`,
  `NoiseShader`, `GPUContext`, `Preset`, `PresetStore`, `LivePhotoExporter`,
  `LivePhotoExportOptions`, `PhotoLibraryDelivery`). It signs + deploys to the
  device (team `U9X7M39R56`) via xcodegen.
- The portable `Renderer` already supports the full v1 shader feature set
  (gradient / posterize / hsv / rgb / flow + domain warp + layer2) **and image
  masking** (`setMask(base64Png:invert:fill:)`, alpha-or-luminance, fit/fill).
- The macOS app establishes the patterns to mirror: a live `MTKView` renderer
  (`MetalNoiseView`, AppKit-only — needs an iOS sibling) and a named custom-look
  library (`CustomPresetStore` — deferred here, see §9).

---

## 2. Goals / non-goals

**Goal (v1):** A native SwiftUI iOS/iPadOS app where you start from a preset,
**tune a curated set of parameters with a live animated preview**, optionally
**mask the noise into an image's shape** (with a chosen background), and export
the result as a Live Photo into Photos. Polished enough to feel complete
(app icon, launch screen, iPad layout).

**Design principle — incremental controls:** the editor is structured so that
*adding a control later is one SwiftUI binding to an existing `Preset` field* —
the renderer and exporter already consume the whole `Preset`. v1 ships a curated
subset; more (up to full parity) can be added without architectural change.

**Non-goals (v1):**
- Full parameter parity with the desktop studio (layer2, loop, every
  colour-mode sub-param) — incremental, later.
- Saving named custom looks ("Look speichern") — self-contained, v1.1 (§9).
- A gradient *editor* (custom stops) — v1 offers the **named** gradients only.
- Embedding the web studio in a `WKWebView` (the macOS approach) — the user
  chose a *native* editor.
- Animated wallpaper (Apple blocks synthetic Live Photo motion as wallpaper —
  see `reference`/the prior session; out of our control).

---

## 3. Architecture

Native SwiftUI app reusing the portable core unchanged. New iOS units:

| Unit | Responsibility |
|------|----------------|
| `EditorModel` (`ObservableObject`) | The single source of editable state: a mutable `EditorParams` (mirrors the `Preset` fields the controls touch) + mask state (image, on/off, invert, fit/fill, background mode). Publishes changes; produces a concrete `Preset` for the renderer/exporter. |
| `EditorParams` (struct) | Mutable mirror of the relevant `Preset` fields (the `Preset` model stays immutable/`Codable`). A `toPreset()` builds the render/export `Preset`. |
| `MetalPreviewView` (`UIViewRepresentable`) | Hosts an `MTKView` running `Renderer.draw(in:time:)` on its own frame clock (the iOS sibling of `MetalNoiseView`). Re-applies params/mask from `EditorModel` live. |
| `EditorView` (SwiftUI) | The screen: the preview on top, a scrollable control panel below (preset picker, curated sliders, colour/gradient, mask section), and a "Create Live Photo" button. Adapts to iPad/landscape. |
| `MaskController` | Wraps `PhotosPicker` → `UIImage` → base64 PNG for `Renderer.setMask`; owns the background-mode choice. |

Shared core changes (small, in `macos/Sources/…`, kept cross-platform):
- **`LivePhotoExporter`** gains a **mask-aware render path** (see §6).
- A tiny **gradients resource** (named gradient stops) is bundled so the gradient
  picker has options (see §4) — generated from `perlin-presets.js` like the
  presets, single-sourced.

---

## 4. Curated controls (v1)

Each binds to an existing `Preset` field; the preview updates live.

| Control | Field(s) | Notes |
|---|---|---|
| **Preset** (picker) | loads a built-in `Preset` as the base look | the 10 bundled presets |
| **Colour mode** (segmented) | `colorMode` | gradient / posterize / hsv / flow (rgb optional) |
| **Gradient** (picker) | `gradient` | named gradients (bundled); shown when mode = gradient/posterize |
| **Zoom / scale** (slider) | `scaleX`, `scaleY` | one master "zoom" drives both |
| **Detail** (slider) | `octaves` | 1–8 |
| **Speed** (slider) | `scaleT` | time scale |
| **Warp** (slider) | `warpStrength` | 0 = off |

Adding e.g. persistence/lacunarity/layer2 later = one row each. (Documented as
the incremental path, not built in v1.)

---

## 5. Image masking (creative highlight)

- **Pick** an image via `PhotosPicker` → convert to base64 PNG → `setMask`.
- Controls: **on/off**, **invert**, **fit/fill** (aspect), source is
  alpha-or-luminance (handled by `setMask` exactly like the studio).
- **Background mode** (what fills the non-noise area, since a Live Photo is
  opaque): **Black** (default — noise/flames glow in darkness), **Colour**
  (picker), or **Source image** (the picked image stays visible, noise appears
  only in the masked region). All three are cheap — it's just *what the masked
  noise is composited over*.

---

## 6. Mask-aware Live Photo export (the real new core work)

Today `LivePhotoExporter` renders via `Renderer.renderBGRA`, which ignores the
mask. v1 adds a render path that, per frame:
1. renders the noise **with the mask applied** (noise where the mask is on,
   transparent where off — the `Renderer` already produces premultiplied-alpha
   output when a mask is set), then
2. **composites that over the chosen background** (black / solid colour / the
   source image scaled with the same fit/fill) → an **opaque** RGBA frame, then
3. encodes it as before (HEVC + the content-identifier + still-image-time
   markers). The still frame uses the same composite.

The existing no-mask path is unchanged. The compositing can live in the shader
(pass a background colour/texture) or as a CPU/Metal blend after the masked
render — the plan picks the cleaner one; the contract is "opaque masked frames."

---

## 7. Live preview

`MetalPreviewView` hosts an `MTKView` (iOS `UIView`) with `preferredFramesPerSecond
= 30`; an `MTKViewDelegate` calls `Renderer.draw(in:time:)` with a monotonic
clock (same advancing-time model as the wallpaper). `EditorModel` changes update
the renderer's `Preset` (rebuild gradient LUT / perm buffer as needed) and mask
live. Paused when the app backgrounds.

---

## 8. Polish

App icon (a rendered Perlin still), launch screen, iPad/landscape layout
(SwiftUI adapts; verify the control panel scrolls and the preview scales),
`NSPhotoLibraryAddUsageDescription` (already present). Bundle id, team, and
xcodegen wiring already exist.

---

## 9. Deferred (v1.1+, architected-for)

- **"Look speichern"** — name/save the current params+mask as a custom look
  (reuse the `CustomPresetStore` pattern). Self-contained; not in v1.
- **More controls → full parity** (persistence, lacunarity, base seed, layer2,
  loop, per-colour-mode sub-params, custom **gradient editor**). Each is an
  additive row (the v1 architecture is built for this).
- Mask from the **camera**; share-sheet export; multiple saved projects.

---

## 10. Testing

- **Headless (macOS, CI-style):** extend the existing `--selftest` /
  `LivePhotoExporter.selfTest` to cover the **mask-aware export** path (render a
  masked clip onto each background mode; assert opaque output + the Live-Photo
  markers + UUID still hold).
- **Simulator (autonomous):** run the app in the booted simulator; drive a
  scripted generate (the existing `PERLIN_AUTORUN` hook) and confirm a valid
  Live Photo lands in the sim library; smoke the preview renders (no crash).
- **On-device (user):** the editor feel, live preview smoothness, the mask
  effect, and a real masked Live Photo in Photos — the acceptance test.

---

## 11. Build sequence (for the plan)

1. `EditorParams` + `EditorModel` (state + `toPreset()`), unit-checkable.
2. `MetalPreviewView` (iOS `MTKView` host) — static render of a preset first,
   then the live clock.
3. `EditorView` shell: preview + preset picker + **one** slider wired live
   (prove the binding→preview loop), then fill in the curated controls.
4. Bundle the named gradients; wire the colour-mode + gradient pickers.
5. Mask section: `PhotosPicker` → `setMask`; on/off/invert/fit-fill in the
   preview.
6. Mask-aware export in `LivePhotoExporter` (+ background modes) + selftest.
7. Wire "Create Live Photo" to the masked export + `PhotoLibraryDelivery`.
8. Polish: app icon, launch screen, iPad layout pass.
9. Simulator smoke + adversarial review; on-device acceptance by the user.
