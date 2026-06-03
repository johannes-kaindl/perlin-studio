# Design — Embedded Studio Editor + Full-Parity Wallpaper (macOS)

**Date:** 2026-06-03
**Status:** Approved (design), implementation autonomous
**Builds on:** `2026-06-03-macos-live-wallpaper-design.md` (the live Metal wallpaper).

---

## 1. Goal

Let the user create/customise wallpaper looks with the **full** Perlin Studio
feature set, without rebuilding the editor natively. An editor window hosts the
existing studio in a `WKWebView`; every parameter change is sent **live** to the
native Metal wallpaper. One editor (the web one), native GPU wallpaper.

Decisions taken (with the user):
1. **Embed** the web editor (`WKWebView`) — not a native re-implementation.
2. **Live apply** — every change updates the real desktop wallpaper immediately.
3. **Full shader parity** — port `flow`, `nebula` (per-channel RGB) and `layer2`
   to Metal so the wallpaper renders anything the editor produces. `tile` and
   image `mask` are out of scope (irrelevant for a fullscreen wallpaper).
4. Studio is **bundled locally** (copied at build) — not loaded from the
   deployed URL. Last-applied look is **persisted** across launches. A named
   custom-preset library in the menu is deferred.

## 2. Architecture / components

| Unit | Responsibility |
|------|----------------|
| `EditorWindowController.swift` | An `NSWindow` hosting a `WKWebView`; opened from the menu ("Edit…"). Installs the script-message handler and loads the bundled studio. |
| `WallpaperBridge.swift` | `WKScriptMessageHandler`: receives resolved params from the page, decodes to `Preset`, calls `manager.apply`. Also the `WKUserContentController` wiring. |
| `Resources/studio/` | The studio web files (index.html, styles.css, perlin*.js, assets), copied at build by `scripts/copy-studio.js` (single-source from the repo root — mirrors `export-presets.js`). |
| studio bridge hook (in `perlin-studio.js`) | Feature-gated: only active when `window.webkit?.messageHandlers?.perlinWallpaper` exists (i.e. inside the app). On change, `postMessage(resolveParams(gatherParams()))`, debounced. Inert on the normal web deployment — keeps it zero-build / `file://`-safe / dependency-free. |
| `PresetStore` (persistence) | Save the last-applied resolved preset JSON to `~/Library/Application Support/PerlinLiveWallpaper/current.json`; restore on launch. |
| `NoiseShader` + `Renderer` + `Preset` (extended) | Parity port: `flow`, `nebula`/rgb-multi, single-channel `rgb`, `layer2`; the `Preset` model gains the corresponding fields; the uniform struct + a second permutation buffer (for `layer2Base`) are added. |

## 3. Data flow

```
WKWebView (studio, JS engine renders the editor preview)
   └─ on param change → resolveParams(gatherParams())   [resolved: named gradient → concrete stops]
        └─ window.webkit.messageHandlers.perlinWallpaper.postMessage(params)
             └─ WallpaperBridge (Swift) decodes → Preset → WallpaperWindowManager.apply
                  └─ Metal wallpaper updates immediately (+ persisted as current.json)
App launch: current.json → Preset → wallpaper.
```

Sending **resolved** params keeps the gradient definitions single-source in JS;
Swift never duplicates the `GRADIENTS` table. Custom hex palettes travel as
concrete stops.

## 4. Shader parity (faithful port of `perlin.js`)

The studio's render branches (see `generatePerlinImage`) are mirrored in MSL:

- **flow** (`colorMode === "flow"`): 3 `warpedFbm` samples per pixel — `n0`
  at `(x,y)`, `n1` at `(x+eps, y)`, `n2` at `(x, y+eps)` (`eps = flowEps`) —
  then `colorizeFlow(n1-n0, n2-n0)`: `hue = atan2(dy,dx)/(2π)+0.5+flowHueShift`,
  `v = clamp(flowFloor + mag·flowGain·(1-flowFloor))`, `sat = flowSat` → HSV.
- **rgb / nebula** (`colorMode === "rgb"`): single-channel uses one sample
  (`r=(rInvert?1-n:n)·rScale`, …); multi-channel (`rgbMultiChannel`) uses 3
  samples at noise-space offsets `(+53 x)`, `(+71 y)` → per-channel scale/invert.
- **layer2** (`layer2On`, only when not flow/multi): a second `warpedFbm` from a
  **second permutation** (`layer2Base`) at `layer2Scale*`, `layer2Octaves`,
  blended via `blendLayers` (multiply/add/screen/darken/lighten/difference) and
  mixed by `layer2Mix`.

Already ported: `gradient`, `posterize`, `hsv`, domain `warp`. The uniform
struct and `Preset` grow to carry these params; `colorMode` becomes an enum
{gradient, posterize, hsv, rgb, flow} plus a `rgbMultiChannel` flag. The
`--selftest` set is extended with `flow` and `nebula` (already-bundled presets)
to validate the new paths.

## 5. Loading the studio in WKWebView

- **Plan A:** `loadFileURL(indexURL, allowingReadAccessTo: studioDir)`. The
  studio is `file://`-safe (no ES modules; inline scripts; Blob worker). The
  Blob worker inherits the `file://` origin and should run.
- **Risk / fallback:** if WebKit blocks the Blob worker or sub-resources under
  `file://`, serve `Resources/studio/` from a tiny loopback HTTP server
  (`127.0.0.1:<port>`, `NWListener`) and load `http://127.0.0.1:<port>/`. Decide
  by testing on-device early (Risk #1).

## 6. Settings / persistence (v1)

- Persist the last-applied resolved preset → restore on launch.
- "Edit…" menu item opens the editor window.
- Launch-at-login via `SMAppService` (small, optional toggle).
- Existing power policy (AC/battery) and preset menu stay.

## 7. Out of scope (v1) / YAGNI

- `tile` (repeatx/y) and image `mask` modes in the shader.
- Named custom-preset library in the menu ("Save current as…") — natural next step.
- Per-display different presets.

## 8. Build sequence

1. **Shader parity** — extend `Preset`, `NoiseShader` (MSL), `Renderer` (2nd perm
   buffer, bigger uniforms), extend `--selftest` to cover flow + nebula. Verify
   visual parity via `--render`. *(Foundation — do first.)*
2. `scripts/copy-studio.js` + bundle `Resources/studio/`; `Package.swift` resource.
3. `EditorWindowController` + WKWebView load (validate the worker — Risk #1).
4. The bridge: studio JS hook (feature-gated) + `WallpaperBridge` Swift handler →
   live apply.
5. Persistence (`current.json`) + "Edit…" menu item + launch-at-login.
6. Adversarial review; fix; commit.

## 9. Risks / validate early

1. **WKWebView + Blob worker under `file://`** — the studio's animation worker
   must run. Test on-device first; loopback-server fallback ready.
2. **Live-apply performance** — debounce the bridge; Metal re-render is cheap.
3. **Visual parity** of flow / nebula / layer2 — covered by `--selftest` + `--render`.
4. **Bridge must stay inert on the web deployment** — feature-gated on the
   `webkit` message handler; no behavioural change to the studio in a browser.
