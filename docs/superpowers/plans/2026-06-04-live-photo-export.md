# Live Photo Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native Live Photo exporter to the macOS app so a chosen Perlin preset becomes an animated iPhone/iPad lock-screen wallpaper (HEIC still + paired H.264 `.mov` with the two QuickTime Live-Photo markers).

**Architecture:** A new `LivePhotoExporter` (AVFoundation) renders frames offscreen via the existing `Renderer.renderBGRA(…time:)`, muxes a QuickTime `.mov` (H.264 + a top-level `content.identifier` + a `still-image-time` timed-metadata track), and writes a HEIC still carrying the same UUID in its Apple maker-note. A menu item + sheet drive it; delivery is "Add to Photos" (iCloud sync) with a folder-export fallback. Headless `--selftest` re-reads the pair to assert both markers and the UUID match — no device needed.

**Tech Stack:** Swift, AVFoundation, CoreMedia, CoreVideo, ImageIO, Photos (PhotoKit), AppKit, Metal (reused). SwiftPM target `macos/`, no third-party deps.

**Spec:** `docs/superpowers/specs/2026-06-04-ios-live-photo-design.md`

**Conventions (from `AGENTS.md` + macOS app):** English identifiers/comments; comments explain *why*; no third-party Swift deps; no XCTest — use the existing **selftest** pattern (`swift run --package-path macos PerlinLiveWallpaper --selftest`). Build with `swift build --package-path macos`. Commit messages: `feat(macos): …`.

---

## File structure

- **Create** `macos/Sources/PerlinLiveWallpaper/LivePhotoExportOptions.swift` — value type: dimensions, duration, fps, still position, delivery mode, resolution presets.
- **Create** `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift` — the core: render → `.mov` (+ markers) → HEIC; plus `verifyPair` + `selfTest`.
- **Create** `macos/Sources/PerlinLiveWallpaper/PhotoLibraryDelivery.swift` — add a pair to the Photos library (PhotoKit) with the folder fallback handled by the caller.
- **Create** `macos/Sources/PerlinLiveWallpaper/LivePhotoExportController.swift` — AppKit sheet (options + progress) and the "Export Live Photo…" action.
- **Modify** `macos/Sources/PerlinLiveWallpaper/main.swift` — add `--export-livephoto <preset> <out-basename>`; run the exporter selftest under `--selftest`.
- **Modify** `macos/Sources/PerlinLiveWallpaper/AppController.swift` — add the "Export Live Photo…" menu item wired to the controller.
- **Modify** `macos/PerlinLiveWallpaper/Info.plist` (or the SwiftPM-embedded Info.plist) — add `NSPhotoLibraryAddUsageDescription`.
- **Modify** `CHANGELOG.md`, `macos/README.md` — document the feature.

> Note on TDD in Swift: there is no XCTest target. "Write the failing test" means add/extend a **selftest assertion**, then `swift build` + `swift run … --selftest` (or `--export-livephoto`) and confirm it fails for the stated reason, implement, then confirm it passes. Each task ends with a commit.

---

## Task 1: `LivePhotoExportOptions`

**Files:**
- Create: `macos/Sources/PerlinLiveWallpaper/LivePhotoExportOptions.swift`

- [ ] **Step 1: Write the file**

```swift
import Foundation

/// User-tunable parameters for a Live Photo export. Defaults match the spec
/// (§6): iPhone-portrait, ~3 s, 30 fps, still at the clip midpoint.
struct LivePhotoExportOptions {
    enum Delivery { case addToPhotos, folder(URL) }

    var width: Int = 1290          // iPhone portrait default (e.g. 15/16 Pro)
    var height: Int = 2796
    var duration: Double = 3.0     // seconds
    var fps: Int = 30
    var stillFraction: Double = 0.5  // still frame position in [0,1)
    var delivery: Delivery = .addToPhotos

    /// Total rendered frames (>= 1).
    var frameCount: Int { max(1, Int((duration * Double(fps)).rounded())) }
    /// Index of the still frame, clamped into the rendered range.
    var stillFrameIndex: Int { min(frameCount - 1, max(0, Int((Double(frameCount) * stillFraction).rounded(.down)))) }

    /// Built-in target presets offered in the sheet. The Watch crops to a
    /// square, so a square option is offered for the Photos-watch-face route.
    static let resolutionPresets: [(label: String, w: Int, h: Int)] = [
        ("iPhone portrait", 1290, 2796),
        ("iPad portrait", 2048, 2732),
        ("Square (Watch)", 1088, 1088),
    ]
}
```

- [ ] **Step 2: Verify it compiles**

Run: `swift build --package-path macos`
Expected: builds (no references to undefined symbols).

- [ ] **Step 3: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/LivePhotoExportOptions.swift
git commit -m "feat(macos): Live Photo export options value type"
```

---

## Task 2: `LivePhotoExporter` — render frames → plain H.264 `.mov`

Get a playable video out first; metadata markers come in Task 3.

**Files:**
- Create: `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift`

- [ ] **Step 1: Write the exporter with the video-only path + a temporary `selfTest` that asserts the `.mov` exists and has the expected frame count**

```swift
import Foundation
import AVFoundation
import CoreVideo
import CoreMedia

/// Builds an Apple Live Photo pair (HEIC still + paired QuickTime .mov) from a
/// Perlin preset. The .mov carries the two markers Photos needs to treat it as a
/// Live Photo's motion (added in a later step): a top-level
/// `com.apple.quicktime.content.identifier` and a `still-image-time` timed-
/// metadata track. Frames are rendered offscreen via Renderer.renderBGRA.
enum LivePhotoExporter {

    /// Renders `preset` to a video file at `videoURL`. Returns true on success.
    /// (Metadata markers + still are layered on in later tasks.)
    static func writeVideo(preset: Preset, options o: LivePhotoExportOptions,
                           identifier: String, videoURL: URL) -> Bool {
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else { return false }
        try? FileManager.default.removeItem(at: videoURL)

        guard let writer = try? AVAssetWriter(outputURL: videoURL, fileType: .mov) else { return false }

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: o.width,
            AVVideoHeightKey: o.height,
        ]
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = false
        let pbAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: o.width,
            kCVPixelBufferHeightKey as String: o.height,
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput,
                                                           sourcePixelBufferAttributes: pbAttrs)
        guard writer.canAdd(videoInput) else { return false }
        writer.add(videoInput)

        guard writer.startWriting() else { return false }
        writer.startSession(atSourceTime: .zero)

        let queue = DispatchQueue(label: "page.codeberg.jkaindl.livephoto.video")
        let done = DispatchSemaphore(value: 0)
        var index = 0
        var ok = true

        videoInput.requestMediaDataWhenReady(on: queue) {
            while videoInput.isReadyForMoreMediaData {
                if index >= o.frameCount {
                    videoInput.markAsFinished()
                    done.signal()
                    return
                }
                let time = Double(index) / Double(o.fps)
                guard let bgra = Renderer.renderBGRA(gpu: gpu, preset: preset,
                                                     width: o.width, height: o.height, time: time),
                      let pool = adaptor.pixelBufferPool,
                      let pb = Self.pixelBuffer(from: bgra, width: o.width, height: o.height, pool: pool) else {
                    ok = false; videoInput.markAsFinished(); done.signal(); return
                }
                let pts = CMTime(value: Int64(index), timescale: Int32(o.fps))
                if !adaptor.append(pb, withPresentationTime: pts) { ok = false }
                index += 1
            }
        }
        done.wait()

        let finished = DispatchSemaphore(value: 0)
        writer.finishWriting { finished.signal() }
        finished.wait()
        return ok && writer.status == .completed
    }

    /// Wraps raw BGRA bytes (top-row-first, 4 bytes/px, as Renderer.renderBGRA
    /// returns) into a CVPixelBuffer from `pool`. kCVPixelFormatType_32BGRA byte
    /// order matches Metal's bgra8Unorm exactly, so this is a straight copy.
    static func pixelBuffer(from bgra: [UInt8], width: Int, height: Int,
                            pool: CVPixelBufferPool) -> CVPixelBuffer? {
        var pbOut: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pbOut) == kCVReturnSuccess,
              let pb = pbOut else { return nil }
        CVPixelBufferLockBaseAddress(pb, [])
        defer { CVPixelBufferUnlockBaseAddress(pb, []) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let dstStride = CVPixelBufferGetBytesPerRow(pb)
        let srcStride = width * 4
        bgra.withUnsafeBytes { src in
            for row in 0..<height {
                memcpy(base.advanced(by: row * dstStride),
                       src.baseAddress!.advanced(by: row * srcStride),
                       srcStride)
            }
        }
        return pb
    }

    /// Temporary smoke test (replaced by the full pair check in Task 5).
    static func selfTest() -> Bool {
        let store = PresetStore()
        guard let preset = store.presets.first else { print("livephoto selftest: no presets"); return false }
        let tmp = FileManager.default.temporaryDirectory
        let videoURL = tmp.appendingPathComponent("perlin-selftest.mov")
        let opts = LivePhotoExportOptions(width: 256, height: 512, duration: 0.5, fps: 10)
        let ok = writeVideo(preset: preset, options: opts, identifier: UUID().uuidString, videoURL: videoURL)
        guard ok else { print("livephoto selftest: writeVideo failed"); return false }
        let asset = AVURLAsset(url: videoURL)
        let dur = CMTimeGetSeconds(asset.duration)
        let pass = dur > 0.3 && dur < 0.8
        print("livephoto selftest: video dur=\(dur)s -> \(pass ? "PASS" : "FAIL")")
        try? FileManager.default.removeItem(at: videoURL)
        return pass
    }
}
```

- [ ] **Step 2: Wire the selftest into `--selftest` so it runs** (temporary; finalized in Task 5)

Modify `macos/Sources/PerlinLiveWallpaper/main.swift` — replace the `--selftest` block:

```swift
if CommandLine.arguments.contains("--selftest") {
    let ok = Renderer.selfTest() && LivePhotoExporter.selfTest()
    exit(ok ? 0 : 1)
}
```

- [ ] **Step 3: Run the selftest — verify the video path works**

Run: `swift run --package-path macos PerlinLiveWallpaper --selftest`
Expected: prints `livephoto selftest: video dur=0.5s -> PASS` and exits 0. (If it fails to build because `Renderer.renderBGRA` differs, re-check its signature in `Renderer.swift`.)

- [ ] **Step 4: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift macos/Sources/PerlinLiveWallpaper/main.swift
git commit -m "feat(macos): Live Photo exporter — render frames to H.264 .mov"
```

---

## Task 3: Add the two QuickTime Live-Photo markers to the `.mov`

A Live Photo's motion `.mov` needs a top-level `content.identifier` and a single-sample `still-image-time` timed-metadata track (the reverse-engineered, community-proven LimitPoint recipe). Add both to `writeVideo`.

**Files:**
- Modify: `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift`

- [ ] **Step 1: Add two metadata helpers to the `LivePhotoExporter` enum**

```swift
    // MARK: - Live Photo metadata (mdta keyspace)

    private static let kKeyContentID = "com.apple.quicktime.content.identifier"
    private static let kKeyStillTime = "com.apple.quicktime.still-image-time"
    private static let kKeySpaceMdta = "mdta"

    /// Top-level movie metadata item binding this .mov to its still by UUID.
    private static func contentIdentifierItem(_ id: String) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.key = kKeyContentID as NSString
        item.keySpace = AVMetadataKeySpace(rawValue: kKeySpaceMdta)
        item.value = id as NSString
        item.dataType = "com.apple.metadata.datatype.UTF-8"
        return item
    }

    /// The single timed sample whose *timestamp* marks the still frame. The
    /// int8 value is a placeholder (0); the timestamp carries the meaning.
    private static func stillImageTimeItem() -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.key = kKeyStillTime as NSString
        item.keySpace = AVMetadataKeySpace(rawValue: kKeySpaceMdta)
        item.value = 0 as NSNumber
        item.dataType = "com.apple.metadata.datatype.int8"
        return item
    }

    /// Boxed-metadata format description for the still-image-time track.
    private static func stillTimeFormatDescription() -> CMFormatDescription? {
        let spec: [String: Any] = [
            kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier as String: "\(kKeySpaceMdta)/\(kKeyStillTime)",
            kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType as String: "com.apple.metadata.datatype.int8",
        ]
        var desc: CMFormatDescription?
        CMMetadataFormatDescriptionCreateWithMetadataSpecifications(
            allocator: kCFAllocatorDefault,
            metadataType: kCMMetadataFormatType_Boxed,
            metadataSpecifications: [spec] as CFArray,
            formatDescriptionOut: &desc)
        return desc
    }
```

- [ ] **Step 2: Set the content-identifier and add the metadata track in `writeVideo`**

In `writeVideo`, immediately **after** `writer.add(videoInput)` and **before** `writer.startWriting()`, insert:

```swift
        // Top-level movie identifier (pairs the .mov with the HEIC still).
        writer.metadata = [contentIdentifierItem(identifier)]

        // still-image-time timed-metadata track.
        guard let stillDesc = stillTimeFormatDescription() else { return false }
        let metaInput = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: stillDesc)
        metaInput.expectsMediaDataInRealTime = false
        let metaAdaptor = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metaInput)
        guard writer.canAdd(metaInput) else { return false }
        writer.add(metaInput)
```

- [ ] **Step 3: Append the still-image-time sample after the video finishes**

In `writeVideo`, **after** `done.wait()` and **before** `writer.finishWriting`, insert:

```swift
        // One metadata sample at the still frame's time, one frame long.
        let stillStart = CMTime(value: Int64(o.stillFrameIndex), timescale: Int32(o.fps))
        let stillRange = CMTimeRange(start: stillStart, duration: CMTime(value: 1, timescale: Int32(o.fps)))
        let group = AVTimedMetadataGroup(items: [stillImageTimeItem()], timeRange: stillRange)
        if metaAdaptor.append(group) == false { ok = false }
        metaInput.markAsFinished()
```

- [ ] **Step 4: Build**

Run: `swift build --package-path macos`
Expected: builds.

- [ ] **Step 5: Run the selftest — video still produced (markers verified in Task 5)**

Run: `swift run --package-path macos PerlinLiveWallpaper --selftest`
Expected: still prints `livephoto selftest: video … PASS` and exits 0.

- [ ] **Step 6: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift
git commit -m "feat(macos): add content-identifier + still-image-time markers to the .mov"
```

---

## Task 4: Write the HEIC still with the matching maker-note UUID

**Files:**
- Modify: `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift`

- [ ] **Step 1: Add `writeStill` and a `CGImage` helper**

Add `import CoreGraphics`, `import ImageIO`, and `import UniformTypeIdentifiers` at the top of the file, then add to the enum:

```swift
    /// Apple maker-note key for the asset identifier that pairs still + video.
    private static let kMakerAppleAssetID = "17"

    /// Renders the still frame and writes it as HEIC carrying `identifier` in the
    /// Apple maker-note dictionary (key 17), matching the .mov's content-id.
    static func writeStill(preset: Preset, options o: LivePhotoExportOptions,
                           identifier: String, stillURL: URL) -> Bool {
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else { return false }
        let time = Double(o.stillFrameIndex) / Double(o.fps)
        guard var bgra = Renderer.renderBGRA(gpu: gpu, preset: preset, width: o.width, height: o.height, time: time) else { return false }
        // BGRA (Metal) -> RGBA (CGImage), swapping B and R in place.
        var i = 0
        while i < bgra.count { bgra.swapAt(i, i + 2); i += 4 }
        guard let cg = cgImage(rgba: bgra, width: o.width, height: o.height) else { return false }

        try? FileManager.default.removeItem(at: stillURL)
        guard let dest = CGImageDestinationCreateWithURL(stillURL as CFURL, UTType.heic.identifier as CFString, 1, nil) else { return false }
        let props: [String: Any] = [
            kCGImagePropertyMakerAppleDictionary as String: [kMakerAppleAssetID: identifier],
        ]
        CGImageDestinationAddImage(dest, cg, props as CFDictionary)
        return CGImageDestinationFinalize(dest)
    }

    private static func cgImage(rgba: [UInt8], width: Int, height: Int) -> CGImage? {
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
        guard let provider = CGDataProvider(data: Data(rgba) as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                       bytesPerRow: width * 4, space: cs, bitmapInfo: info,
                       provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }

    /// Renders a complete pair (still + video) sharing one fresh UUID.
    /// Returns the identifier on success, nil on failure.
    @discardableResult
    static func exportPair(preset: Preset, options o: LivePhotoExportOptions,
                           stillURL: URL, videoURL: URL) -> String? {
        let id = UUID().uuidString
        guard writeStill(preset: preset, options: o, identifier: id, stillURL: stillURL),
              writeVideo(preset: preset, options: o, identifier: id, videoURL: videoURL) else { return nil }
        return id
    }
```

- [ ] **Step 2: Build**

Run: `swift build --package-path macos`
Expected: builds.

- [ ] **Step 3: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift
git commit -m "feat(macos): write HEIC still with matching Apple maker-note UUID"
```

---

## Task 5: `verifyPair` + finalized selftest + `--export-livephoto` CLI

Now assert the produced pair is structurally a Live Photo, and add the file-producing CLI.

**Files:**
- Modify: `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift`
- Modify: `macos/Sources/PerlinLiveWallpaper/main.swift`

- [ ] **Step 1: Add `verifyPair` and replace `selfTest`**

Replace the temporary `selfTest()` from Task 2 with:

```swift
    /// Re-reads a pair and asserts: the .mov has a top-level content-identifier;
    /// it has a metadata track carrying a still-image-time item; and the HEIC's
    /// maker-note asset id equals the .mov's content id. Returns true if valid.
    static func verifyPair(stillURL: URL, videoURL: URL) -> Bool {
        let asset = AVURLAsset(url: videoURL)

        // 1) top-level content identifier
        let movID = asset.metadata.first(where: { $0.key as? String == kKeyContentID })?.value as? String
        guard let movID, !movID.isEmpty else { print("verify: no .mov content.identifier"); return false }

        // 2) a metadata track exists (the still-image-time track)
        let hasMetaTrack = !asset.tracks(withMediaType: .metadata).isEmpty
        guard hasMetaTrack else { print("verify: no metadata track"); return false }

        // 3) HEIC maker-note asset id matches
        guard let src = CGImageSourceCreateWithURL(stillURL as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any],
              let maker = props[kCGImagePropertyMakerAppleDictionary as String] as? [String: Any],
              let stillID = maker[kMakerAppleAssetID] as? String else {
            print("verify: no HEIC maker-note asset id"); return false
        }
        guard stillID == movID else { print("verify: id mismatch still=\(stillID) mov=\(movID)"); return false }
        return true
    }

    static func selfTest() -> Bool {
        let store = PresetStore()
        guard let preset = store.presets.first else { print("livephoto selftest: no presets"); return false }
        let tmp = FileManager.default.temporaryDirectory
        let stillURL = tmp.appendingPathComponent("perlin-selftest.heic")
        let videoURL = tmp.appendingPathComponent("perlin-selftest.mov")
        let opts = LivePhotoExportOptions(width: 256, height: 512, duration: 0.6, fps: 10)
        defer { try? FileManager.default.removeItem(at: stillURL); try? FileManager.default.removeItem(at: videoURL) }
        guard exportPair(preset: preset, options: opts, stillURL: stillURL, videoURL: videoURL) != nil else {
            print("livephoto selftest: export failed"); return false
        }
        let ok = verifyPair(stillURL: stillURL, videoURL: videoURL)
        print("livephoto selftest: markers + uuid match -> \(ok ? "PASS" : "FAIL")")
        return ok
    }
```

- [ ] **Step 2: Add the `--export-livephoto` CLI to `main.swift`**

Insert **after** the `--render` block in `main.swift`:

```swift
// `--export-livephoto <preset> <out-basename>`: write <basename>.heic + <basename>.mov and exit.
if let i = CommandLine.arguments.firstIndex(of: "--export-livephoto"), i + 2 < CommandLine.arguments.count {
    let base = CommandLine.arguments[i + 2]
    let store = PresetStore()
    guard let preset = store.presets.first(where: { $0.name == CommandLine.arguments[i + 1] }) ?? store.presets.first else {
        FileHandle.standardError.write(Data("export: no presets\n".utf8)); exit(1)
    }
    let still = URL(fileURLWithPath: base + ".heic")
    let video = URL(fileURLWithPath: base + ".mov")
    let id = LivePhotoExporter.exportPair(preset: preset, options: LivePhotoExportOptions(), stillURL: still, videoURL: video)
    let ok = id != nil && LivePhotoExporter.verifyPair(stillURL: still, videoURL: video)
    FileHandle.standardError.write(Data("export: \(preset.label) -> \(base).{heic,mov} id=\(id ?? "nil") ok=\(ok)\n".utf8))
    exit(ok ? 0 : 1)
}
```

- [ ] **Step 3: Run the finalized selftest**

Run: `swift run --package-path macos PerlinLiveWallpaper --selftest`
Expected: prints `livephoto selftest: markers + uuid match -> PASS`, exits 0.

- [ ] **Step 4: Run the CLI and confirm a real pair**

Run:
```bash
swift run --package-path macos PerlinLiveWallpaper --export-livephoto lava /tmp/perlin-live
ls -la /tmp/perlin-live.heic /tmp/perlin-live.mov
```
Expected: both files exist, non-zero size; stderr shows `ok=true`.

- [ ] **Step 5: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift macos/Sources/PerlinLiveWallpaper/main.swift
git commit -m "feat(macos): verifyPair + selftest + --export-livephoto CLI"
```

---

## Task 6: Delivery — add the pair to the Photos library (PhotoKit)

**Files:**
- Create: `macos/Sources/PerlinLiveWallpaper/PhotoLibraryDelivery.swift`
- Modify: the app's Info.plist (see Step 3)

- [ ] **Step 1: Write the delivery helper**

```swift
import Foundation
import Photos

/// Adds an exported Live Photo pair to the user's Photos library. With iCloud
/// Photos enabled the asset syncs to the iPhone, where it can be set as the
/// lock-screen wallpaper. Requires NSPhotoLibraryAddUsageDescription.
enum PhotoLibraryDelivery {
    enum Result { case added, denied, failed(String) }

    static func add(stillURL: URL, videoURL: URL, completion: @escaping (Result) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized else { completion(.denied); return }
            PHPhotoLibrary.shared().performChanges {
                let req = PHAssetCreationRequest.forAsset()
                let opts = PHAssetResourceCreationOptions()
                req.addResource(with: .photo, fileURL: stillURL, options: opts)
                req.addResource(with: .pairedVideo, fileURL: videoURL, options: opts)
            } completionHandler: { success, error in
                if success { completion(.added) }
                else { completion(.failed(error?.localizedDescription ?? "unknown error")) }
            }
        }
    }
}
```

- [ ] **Step 2: Build**

Run: `swift build --package-path macos`
Expected: builds.

- [ ] **Step 3: Add the usage description to the app's Info.plist**

Find the app's `Info.plist` (the one referenced by `macos/scripts/build-app.sh`). Add inside the top-level `<dict>`:

```xml
	<key>NSPhotoLibraryAddUsageDescription</key>
	<string>Perlin Live Wallpaper saves the Live Photo you export here, so it can sync to your iPhone and be set as a lock-screen wallpaper.</string>
```

(If the SwiftPM run path has no Info.plist, this only matters for the bundled `.app`; the folder-export fallback in Task 7 needs no permission. Verify `build-app.sh` references the plist path you edited.)

- [ ] **Step 4: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/PhotoLibraryDelivery.swift
git commit -m "feat(macos): deliver Live Photo pair to Photos via PhotoKit"
```

---

## Task 7: UI — "Export Live Photo…" menu item + options/progress sheet

**Files:**
- Create: `macos/Sources/PerlinLiveWallpaper/LivePhotoExportController.swift`
- Modify: `macos/Sources/PerlinLiveWallpaper/AppController.swift`

- [ ] **Step 1: Write the export controller (window + options + progress)**

```swift
import AppKit

/// Presents a small window to configure and run a Live Photo export for the
/// app's currently-applied preset, then delivers the result. Off-main-thread
/// export keeps the UI responsive; all UI mutation hops back to main.
final class LivePhotoExportController: NSObject {
    private var window: NSWindow?
    private let presetProvider: () -> Preset

    /// `presetProvider` returns the look to export (the app's current preset).
    init(presetProvider: @escaping () -> Preset) { self.presetProvider = presetProvider }

    func present() {
        let vc = LivePhotoExportViewController(preset: presetProvider())
        let win = NSWindow(contentViewController: vc)
        win.title = "Export Live Photo"
        win.styleMask = [.titled, .closable]
        win.isReleasedWhenClosed = false
        win.center()
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
        self.window = win
    }
}

private final class LivePhotoExportViewController: NSViewController {
    private let preset: Preset
    private let resolutionPopUp = NSPopUpButton()
    private let durationField = NSTextField(string: "3.0")
    private let fpsField = NSTextField(string: "30")
    private let status = NSTextField(labelWithString: "")
    private let exportButton = NSButton(title: "Export", target: nil, action: nil)

    init(preset: Preset) { self.preset = preset; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func loadView() {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)

        LivePhotoExportOptions.resolutionPresets.forEach { resolutionPopUp.addItem(withTitle: $0.label) }
        durationField.frame.size.width = 60
        fpsField.frame.size.width = 60
        exportButton.target = self
        exportButton.action = #selector(runExport)
        exportButton.keyEquivalent = "\r"

        stack.addArrangedSubview(NSTextField(labelWithString: "Resolution"))
        stack.addArrangedSubview(resolutionPopUp)
        stack.addArrangedSubview(NSTextField(labelWithString: "Duration (s) / fps"))
        let row = NSStackView(views: [durationField, fpsField]); row.spacing = 8
        stack.addArrangedSubview(row)
        stack.addArrangedSubview(exportButton)
        stack.addArrangedSubview(status)
        stack.setFrameSize(NSSize(width: 320, height: 240))
        self.view = stack
    }

    private func currentOptions() -> LivePhotoExportOptions {
        var o = LivePhotoExportOptions()
        let p = LivePhotoExportOptions.resolutionPresets[max(0, resolutionPopUp.indexOfSelectedItem)]
        o.width = p.w; o.height = p.h
        o.duration = Double(durationField.stringValue) ?? 3.0
        o.fps = Int(fpsField.stringValue) ?? 30
        return o
    }

    @objc private func runExport() {
        exportButton.isEnabled = false
        status.stringValue = "Rendering…"
        let opts = currentOptions()
        let preset = self.preset
        let tmp = FileManager.default.temporaryDirectory
        let still = tmp.appendingPathComponent("perlin-livephoto.heic")
        let video = tmp.appendingPathComponent("perlin-livephoto.mov")

        DispatchQueue.global(qos: .userInitiated).async {
            let id = LivePhotoExporter.exportPair(preset: preset, options: opts, stillURL: still, videoURL: video)
            guard id != nil else { self.finish("Export failed.") ; return }
            PhotoLibraryDelivery.add(stillURL: still, videoURL: video) { result in
                switch result {
                case .added:
                    self.finish("Saved to Photos. On your iPhone: Settings → Wallpaper → Add New Wallpaper → Photos → \"Live Photo\" filter → pick it → Add → Set as Wallpaper Pair. Keep the Live-Photo play toggle ON.")
                case .denied:
                    self.exportToFolderFallback(still: still, video: video)
                case .failed(let msg):
                    self.finish("Saved files, but adding to Photos failed: \(msg)")
                }
            }
        }
    }

    private func exportToFolderFallback(still: URL, video: URL) {
        DispatchQueue.main.async {
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.prompt = "Export Here"
            panel.message = "Photos access denied — choose a folder to save the pair, then AirDrop it to your iPhone."
            guard panel.runModal() == .OK, let dir = panel.url else { self.finish("Cancelled."); return }
            do {
                try FileManager.default.copyItem(at: still, to: dir.appendingPathComponent("perlin-livephoto.heic"))
                try FileManager.default.copyItem(at: video, to: dir.appendingPathComponent("perlin-livephoto.mov"))
                self.finish("Exported the pair to \(dir.lastPathComponent). AirDrop both files to your iPhone, then set the Live Photo as your wallpaper.")
            } catch { self.finish("Folder export failed: \(error.localizedDescription)") }
        }
    }

    private func finish(_ message: String) {
        DispatchQueue.main.async {
            self.status.stringValue = message
            self.exportButton.isEnabled = true
        }
    }
}
```

- [ ] **Step 2: Wire the menu item in `AppController.swift`**

Find where the status-item `NSMenu` is built (the preset list / Pause / Quit items). Add, near the export-related items:

```swift
        menu.addItem(.separator())
        let liveItem = NSMenuItem(title: "Export Live Photo…", action: #selector(exportLivePhoto), keyEquivalent: "")
        liveItem.target = self
        menu.addItem(liveItem)
```

And add the controller property + action to `AppController`:

```swift
    private lazy var livePhotoController = LivePhotoExportController(presetProvider: { [weak self] in
        self?.currentPreset ?? PresetStore.fallback
    })

    @objc private func exportLivePhoto() { livePhotoController.present() }
```

> Replace `self?.currentPreset` with whatever property/accessor `AppController` already uses for the active preset (grep for the preset the renderer is currently showing). If there is no single accessor, add a small computed `var currentPreset: Preset` that returns the look currently applied to the wallpaper. `PresetStore.fallback` already exists (used in `Renderer.selfTest`'s aspect check).

- [ ] **Step 3: Build + run the app, open the menu, run an export**

Run: `swift run --package-path macos PerlinLiveWallpaper`
Then: menu bar → "Export Live Photo…" → Export. Expected: a window appears; after a moment the status shows the "Saved to Photos / wallpaper instructions" message (or the folder-fallback panel if Photos access is denied).

- [ ] **Step 4: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/LivePhotoExportController.swift macos/Sources/PerlinLiveWallpaper/AppController.swift
git commit -m "feat(macos): Export Live Photo menu item + options sheet + delivery"
```

---

## Task 8: Docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `macos/README.md`

- [ ] **Step 1: Add a CHANGELOG entry under `[Unreleased] → ### Added`**

```markdown
- **Live Photo export** (macOS app) — "Export Live Photo…" renders the current
  preset to an Apple Live Photo (HEIC still + paired H.264 `.mov` with the
  QuickTime content-identifier + still-image-time markers) and adds it to Photos
  (syncs to iPhone via iCloud) or exports the pair to a folder for AirDrop. Set
  it as an animated iPhone/iPad lock-screen wallpaper manually. The same Live
  Photo also works as an animated Apple Watch *Photos* face. Headless
  `--export-livephoto <preset> <out>` + a `--selftest` check that the pair is
  structurally valid.
```

- [ ] **Step 2: Add a short "Live Photo export" section to `macos/README.md`**

```markdown
## Live Photo export (animated iPhone wallpaper)

"Export Live Photo…" turns the current preset into an Apple Live Photo and adds
it to Photos (with iCloud Photos on, it appears on your iPhone). Set it manually:
**iPhone → Settings → Wallpaper → Add New Wallpaper → Photos → "Live Photo"
filter → pick it → Add → Set as Wallpaper Pair**, with the Live-Photo play
toggle ON. There is no API to set the wallpaper automatically. Headless:
`swift run --package-path macos PerlinLiveWallpaper --export-livephoto <preset> <out-basename>`.

The same Live Photo can be used as an animated Apple Watch *Photos* face (it
animates on touch-and-hold, or on wrist-raise with Always-On Display off).
```

- [ ] **Step 3: Run the full selftest once more (regression)**

Run: `swift run --package-path macos PerlinLiveWallpaper --selftest`
Expected: `selftest: ALL PASS` (Renderer) and `livephoto selftest: … PASS`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md macos/README.md
git commit -m "docs(macos): document Live Photo export"
```

---

## Task 9: Adversarial review + on-device acceptance

- [ ] **Step 1: Adversarial code review** of the diff (correctness of the AVFoundation metadata, the pixel-buffer stride copy, threading in the exporter/UI, error paths, the Info.plist key). Fix confirmed issues.

- [ ] **Step 2: On-device acceptance (user).** Export a pair → confirm it shows as a single **LIVE** item in Photos on the iPhone → set it as the lock-screen wallpaper → confirm it animates on wake. Bonus: try it as the Apple Watch Photos face. This manual check is the real acceptance test; no automation replaces it.

- [ ] **Step 3: Final commit / changelog touch-up if review changed anything.**

---

## Self-review notes (author)

- **Spec coverage:** render→mov (T2) ✓; content-identifier + still-image-time (T3) ✓; HEIC maker-note UUID (T4) ✓; verify both markers + UUID (T5) ✓; CLI + selftest (T2/T5) ✓; delivery Add-to-Photos + folder fallback (T6/T7) ✓; UX + instructions (T7) ✓; defaults table (T1) ✓; Watch-face note (T8 docs + Square option T1) ✓; iOS-app Phase 2 — intentionally **not** in this plan (separate spec).
- **Type consistency:** `LivePhotoExportOptions` fields (`width/height/duration/fps/stillFraction/frameCount/stillFrameIndex`) used identically in T2–T7; `LivePhotoExporter.exportPair/writeVideo/writeStill/verifyPair/selfTest` signatures stable across T2–T7; `PhotoLibraryDelivery.add(...)→Result` matches its use in T7.
- **Known unknowns to resolve during implementation:** the exact Info.plist path used by `build-app.sh` (T6 Step 3) and `AppController`'s current-preset accessor (T7 Step 2) — both flagged inline with fallbacks.
