# Design — Perlin Live Photo export (macOS app)

**Date:** 2026-06-04
**Status:** Approved (design), implementation pending
**Scope:** Add a native **Live Photo exporter** to the existing macOS companion
app (`macos/`) so a chosen Perlin preset becomes an animated iPhone/iPad
lock-screen wallpaper. This is the MVP of the deferred "iOS/iPadOS" phase from
the [macOS live-wallpaper spec](2026-06-03-macos-live-wallpaper-design.md). A
standalone native iOS app is explicitly a **later phase** (see §9).

---

## 1. Background & feasibility (adversarially verified)

A multi-agent research pass (verified against WebKit/Apple sources) established
the hard constraints, current as of iOS/iPadOS/macOS/watchOS 26 (mid-2026):

- **No public API sets an iOS wallpaper.** A third-party app can only export a
  Live Photo to the photo library; the user sets it as wallpaper **manually**
  (Settings → Wallpaper → Add → Photos → "Live Photo" filter → … → play toggle
  ON). This is unavoidable and is reflected in the UX.
- **A Live Photo is a pair** bound by a shared UUID: a HEIC/JPEG **still** and a
  QuickTime **`.mov`**. The `.mov` needs the UUID as top-level QuickTime metadata
  `com.apple.quicktime.content.identifier`, and a **separate timed-metadata
  track** keyed `com.apple.quicktime.still-image-time` whose sample timestamp
  marks the still frame. The same UUID goes in the still's Apple maker-note
  (`kCGImagePropertyMakerAppleDictionary`, key `17`).
- **ffmpeg alone cannot author the `still-image-time` timed-metadata track** — it
  needs `AVAssetWriter` + `AVAssetWriterInputMetadataAdaptor`. So a native
  Apple-platform muxing step is **mandatory**; a pure-web/Shortcut pipeline
  cannot produce a valid pair. (This is why the chosen architecture is native.)
- **Codec:** H.264-in-`.mov` is the safest, most-compatible paired-video codec
  (HEVC is also accepted by Photos, but H.264 is the conservative choice for a
  generated file). Audio is optional; a silent clip is a valid Live Photo.
- **Duration:** Apple captures ~3 s; the format imposes no hard limit, but the
  on-device experience assumes a short clip, so target ~3 s.

Reference implementation pattern: the proven `LimitPoint/LivePhoto` AVFoundation
code (content-identifier on both files + a single midpoint `still-image-time`
sample written via a metadata adaptor).

### Why this lives in the macOS app (not web, not a new iOS app yet)

The macOS app's render core is **already platform-portable** and offscreen-
capable: `Renderer.renderBGRA(gpu:preset:width:height:time:)` renders one frame
at a given time with no AppKit dependency (it backs `RenderCLI`/`--render` and
`--selftest`). So the Mac can render the clip + still natively at full quality —
cleaner than recording the web canvas (which produces fragmented MP4 via
`MediaRecorder`). Decision recorded with the user: **personal use first**
(dev-signing to own devices; sharing is a later option), so reusing the existing
notarized app with **no new iOS target and no iOS provisioning** is the
fastest path to a working animated iPhone wallpaper.

> **Relationship to the recorder fix (`chooseRecorderMime` → MP4/H.264).** That
> fix (same session) makes the *web* studio record H.264 on Safari/iOS and is
> independently valuable, but it is **not on this feature's critical path**: the
> Mac renders the Live Photo clip natively. The web recording remains the route
> if a future phase generates from the browser.

---

## 2. Goals / non-goals

**Goal (MVP):** From the macOS app's currently-applied look, produce a valid
Live Photo pair (HEIC still + paired H.264 `.mov` with the two QuickTime
markers) and deliver it to the user's iPhone, with clear in-app instructions to
set it as the lock-screen wallpaper.

**Non-goals (v1):**
- Setting the wallpaper programmatically (no API exists — manual).
- A standalone iOS/iPadOS app (later phase, §9).
- Image **mask** in the export (Live Photos are RGB, not transparent — ignored).
- 4D **seamless loop** (a Live Photo plays ~3 s once on interaction, not a
  continuous loop — advancing-time clip is sufficient).
- HEVC codec, audio track, in-export gradient/preset editing.

---

## 3. Architecture & reuse

Lives in the existing `macos/` SwiftPM target. **Reused unchanged:**
`Renderer.renderBGRA(…time:)` (offscreen frames), `Preset` / `PresetStore` /
`CustomPresetStore`, `GPUContext`, `NoiseShader`, ImageIO (`CGImageDestination`).

**New units (each one file, one responsibility):**

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `LivePhotoExporter.swift` | The one substantial new unit. Given a `Preset` + `LivePhotoExportOptions`, renders frames offscreen, muxes the `.mov` (H.264 + the two QuickTime metadata markers) via `AVAssetWriter`, writes the HEIC still with the matching maker-note UUID, and returns the pair (file URLs). | AVFoundation, CoreMedia, CoreVideo, ImageIO, Renderer |
| `LivePhotoExportOptions.swift` | Value type: resolution/aspect, duration, fps, still-frame position, delivery mode. | Foundation |
| `LivePhotoExportController.swift` (or extend `AppController`) | Menu item "Export Live Photo…", the options/progress sheet, kicks off the exporter off the main thread, surfaces success/instructions or errors. | AppKit |

---

## 4. The export pipeline (`LivePhotoExporter`)

1. **Render.** `frameCount = round(duration * fps)`. For `i` in `0..<frameCount`,
   `renderBGRA(width, height, time: Double(i)/fps)` → BGRA bytes → swap to RGBA →
   wrap in a `CVPixelBuffer` (pooled). Time advances like the live wallpaper
   (`tz = elapsedSeconds * scaleT`); non-looping.
2. **MOV.** `AVAssetWriter` (`AVFileType.mov`) with:
   - an `AVAssetWriterInput`(H.264) fed via `AVAssetWriterInputPixelBufferAdaptor`;
   - **top-level** `metadata` item `com.apple.quicktime.content.identifier`
     (`mdta` keyspace, UTF-8) = a fresh `UUID().uuidString`;
   - a **second** `AVAssetWriterInput(mediaType: .metadata)` +
     `AVAssetWriterInputMetadataAdaptor`, appending **one** `AVTimedMetadataGroup`
     keyed `com.apple.quicktime.still-image-time` (int8, `kCMMetadataFormatType_Boxed`)
     at the still frame's time range (~midpoint, one-frame duration).
3. **Still.** `renderBGRA` at the still time → `CGImage` → **HEIC** via
   `CGImageDestination` (UTType `public.heic`) with
   `kCGImagePropertyMakerAppleDictionary` `[17: <same UUID>]`.
4. **Deliver.**
   - **Default — "Add to Photos":** `PHPhotoLibrary` `PHAssetCreationRequest`
     adding `.photo` (HEIC) + `.pairedVideo` (`.mov`). With **iCloud Photos on**,
     it syncs to the iPhone automatically — the user just opens Photos there.
   - **Fallback — "Export pair to folder…":** write `name.heic` + `name.mov` to a
     chosen folder (no permission needed) for AirDrop / manual import.

---

## 5. UX flow

`AppController` menu → **"Export Live Photo…"** → options sheet (resolution,
duration, fps, still frame, delivery) → progress → success message with concise
**in-app instructions**:

> On your iPhone: **Settings → Wallpaper → Add New Wallpaper → Photos →** tap the
> **"Live Photo"** filter → pick it → **Add → "Set as Wallpaper Pair"**. Make sure
> the **Live-Photo play toggle is ON** so it animates on wake.

Errors (no Metal device, encode failure, Photos permission denied) surface in the
sheet; on Photos-permission denial the UI suggests the folder-export fallback.

---

## 6. Defaults / decisions (all adjustable in the sheet)

| Item | Default v1 | Notes |
|------|------------|-------|
| Resolution / aspect | iPhone portrait **1290×2796** | + "iPad portrait", "Square (Watch)", "Custom W×H" |
| Duration | **3.0 s** | Apple's nominal Live Photo length |
| fps | **30** | |
| Still frame | **midpoint (0.5)** | LimitPoint default |
| Codec | **H.264** | universally compatible; HEVC deferred |
| Mask | **ignored** | Live Photo is RGB |
| Loop | **advancing-time, non-looping** | Live Photo plays once on interaction |
| Delivery | **Add to Photos** (iCloud sync) | fallback: export pair to folder |

---

## 7. Error handling & testing

- **Headless CLI + selftest** (mirrors the existing `--render` / `--selftest`
  pattern): add `--export-livephoto <preset> <out-basename>` that writes a pair
  without launching the UI. A selftest asserts the produced `.mov` carries **both
  markers** — a top-level `content.identifier` *and* exactly one
  `still-image-time` metadata sample — and that the HEIC carries the **same UUID**
  in its Apple maker-note. Validate by re-reading with `AVAsset` /
  `CGImageSource` (no device needed); wire into the CI-style selftest.
- **On-device (user):** export a pair → confirm it shows as a single **LIVE**
  item in Photos on the iPhone → set it as the wallpaper → confirm it animates on
  wake. This manual step is the real acceptance test (no automation can replace
  it).
- **Permissions:** "Add to Photos" needs `NSPhotoLibraryAddUsageDescription`
  (and, if the app is ever sandboxed, the photos-library entitlement). The
  folder-export fallback needs **no** permission and is the safe path if the
  Photos prompt misbehaves in the notarized, non-sandboxed build.

---

## 8. Bonus: Apple Watch face (no extra code)

The same exported Live Photo can double as an **animated Apple Watch face** via
Apple's built-in **Photos** face — a free side-effect, since iCloud Photos already
puts it in reach of the watch. Verified facts and honest caveats:

- **No third-party custom watch faces exist** (watchOS 26 still has no
  face-authoring API; apps get only WidgetKit complications and can pre-configure
  Apple's own faces). So we cannot render a custom animated face — only feed a
  Live Photo into the **Photos** face.
- **Animation is gesture-gated, not a loop:** the Live Photo animates on
  **touch-and-hold** (firmly confirmed), and on **wrist-raise only when
  Always-On Display is OFF** (Series 5+ defaults AOD on; this wrist-raise detail
  is community-reported, not in Apple's formal support page — treat with mild
  caution).
- Must be a **genuine Live Photo** synced to the watch (Watch app → Photos →
  Synced Album, or Photos → Share → "Create Watch Face"); the **Portrait** and
  **Kaleidoscope** faces take photos but do **not** play Live-Photo motion; an
  app-bundled `.watchface` reliably carries **stills only**.
- Spec impact: documentation/instructions only, plus the optional **"Square
  (Watch)"** resolution preset in §6 (the watch crops the photo). No code beyond
  that option.

---

## 9. Roadmap — Phase 2 (separate spec): native iOS/iPadOS app

When sharing to others or generating entirely on-device is wanted: a native
iOS/iPadOS target reusing the portable core (`NoiseShader`, `Renderer`,
`GPUContext`, `Preset…`), a SwiftUI UI to pick/preview a preset, the same
`AVAssetWriter` muxing on-device, saving straight to the iPhone's library, and
the same manual wallpaper instructions. Requires an iOS target, Photos
permission flow, and iOS provisioning/signing — its own spec → plan → build.

---

## 10. Build sequence (for the plan)

1. `LivePhotoExportOptions` (value type + sensible defaults).
2. `LivePhotoExporter`: offscreen frames → `CVPixelBuffer` → H.264 `.mov` (no
   metadata yet); verify it plays.
3. Add the two QuickTime markers (content-identifier + still-image-time track);
   verify both are present by re-reading the `.mov`.
4. HEIC still with the matching maker-note UUID; verify pairing.
5. `--export-livephoto` CLI + selftest assertions (markers + UUID match).
6. Delivery: "Add to Photos" (PhotoKit) + folder-export fallback.
7. UI: menu item + options/progress sheet + instructions; wire off-main-thread.
8. On-device smoke (user): set as iPhone wallpaper; confirm animation. Bonus:
   try the Photos watch face.
9. Adversarial code review pass; fix; commit. Update `CHANGELOG.md` and
   `macos/README.md`.
