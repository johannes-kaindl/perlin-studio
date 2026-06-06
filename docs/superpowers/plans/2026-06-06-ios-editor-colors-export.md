# iOS Editor — Hex Colours, Palette, PNG/Video Export, Export Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the remaining reachable web-studio features to the native iOS editor: hex colour input + paste-a-palette in the gradient editor, configurable export settings (resolution/duration/fps), and PNG (still) + plain-video export alongside Live Photo.

**Architecture:** Additive. A small `Hex` helper ports the web's parsing; `GradientEditor` gains a hex field per stop + a paste box; `EditorModel` holds an editable `LivePhotoExportOptions`; `LivePhotoExporter` gains a still-PNG path (reusing the masked-render + composite); `PhotoLibraryDelivery` gains image/video saves; `ExportController` + `EditorView` expose PNG / Video / Live Photo.

**Tech Stack:** SwiftUI, AVFoundation, Photos, ImageIO, the shared core in `macos/Sources/PerlinLiveWallpaper/`. No new deps.

**Conventions:** English, why-comments, no deps, commit `feat(ios): …`. Build iOS sim: `cd ios && xcodegen generate && cd .. && xcodebuild -project ios/PerlinLivePhoto.xcodeproj -scheme PerlinLivePhoto -sdk iphonesimulator -configuration Debug -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build`. Shared `swift build --package-path macos && swift run --package-path macos PerlinLiveWallpaper --selftest`. New `ios/Sources/*.swift` auto-included; new shared `macos/` files must be listed in `ios/project.yml`. Don't push.

---

## File structure

- **Create** `ios/Sources/Hex.swift` — `parse`/`string`/`parseList` (port of the web's hex helpers).
- **Modify** `ios/Sources/GradientEditor.swift` — hex `TextField` per stop + a "Paste palette" box.
- **Modify** `ios/Sources/EditorModel.swift` — add `@Published var export = LivePhotoExportOptions()`.
- **Modify** `ios/Sources/ControlsView.swift` — an "Export" section (resolution/duration/fps).
- **Modify** `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift` — `exportStillImage(...)` (masked still → PNG).
- **Modify** `macos/Sources/PerlinLiveWallpaper/PhotoLibraryDelivery.swift` — `addImage` / `addVideo`.
- **Modify** `ios/Sources/ExportController.swift` — `exportPNG` / `exportVideo` (+ use `model.export`).
- **Modify** `ios/Sources/EditorView.swift` — Live Photo / Video / Image buttons.
- **Modify** `CHANGELOG.md` (Task 4).

---

## Task 1: Hex colours + paste palette

**Files:** Create `ios/Sources/Hex.swift`; modify `ios/Sources/GradientEditor.swift`.

- [ ] **Step 1: Create `ios/Sources/Hex.swift`** (faithful port of `perlin-studio.js` `parseHex`/`parseHexList`/`rgbToHex`):
```swift
import Foundation

/// Hex colour parsing, ported from the web studio. Colours are [r,g,b] 0...255.
enum Hex {
    /// "#rrggbb" / "rrggbb" / "#rgb" / "rgb" → [r,g,b], or nil if invalid.
    static func parse(_ str: String) -> [Int]? {
        var s = str.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3, s.allSatisfy(\.isHexDigit) { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, s.allSatisfy(\.isHexDigit),
              let r = Int(s.prefix(2), radix: 16),
              let g = Int(s.dropFirst(2).prefix(2), radix: 16),
              let b = Int(s.dropFirst(4), radix: 16) else { return nil }
        return [r, g, b]
    }
    /// [r,g,b] → "#rrggbb".
    static func string(_ rgb: [Int]) -> String {
        let c = rgb.count >= 3 ? rgb : [0, 0, 0]
        return String(format: "#%02x%02x%02x", c[0], c[1], c[2])
    }
    /// Scan free text for hex tokens (palette paste); ignores non-hex.
    static func parseList(_ str: String) -> [[Int]] {
        var out: [[Int]] = []
        let pattern = "#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return out }
        let ns = str as NSString
        for m in re.matches(in: str, range: NSRange(location: 0, length: ns.length)) {
            if let rgb = parse(ns.substring(with: m.range(at: 1))) { out.append(rgb) }
        }
        return out
    }
}
```

- [ ] **Step 2: Add the hex field + paste box to `ios/Sources/GradientEditor.swift`.** Add a hex `TextField` to each stop row (after the position slider), and a "Paste palette" `TextField` + Apply button below the stops. Replace the `var body` and add helpers:
```swift
    @State private var paletteText = ""

    var body: some View {
        let stops = model.preset.gradient ?? []
        ForEach(stops.indices, id: \.self) { i in
            HStack {
                ColorPicker("", selection: colorBinding(i), supportsOpacity: false).labelsHidden()
                TextField("#rrggbb", text: hexBinding(i))
                    .font(.system(.caption, design: .monospaced))
                    .autocorrectionDisabled().textInputAutocapitalization(.never)
                    .frame(width: 90)
                Slider(value: posBinding(i), in: 0...1)
                if stops.count > 2 {
                    Button(role: .destructive) { remove(i) } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.borderless)
                }
            }
        }
        Button { add() } label: { Label("Add stop", systemImage: "plus") }
        HStack {
            TextField("Paste palette (hex list)", text: $paletteText)
                .font(.system(.caption, design: .monospaced)).autocorrectionDisabled().textInputAutocapitalization(.never)
            Button("Apply") { applyPalette() }.disabled(Hex.parseList(paletteText).count < 2)
        }
    }

    /// Two-way hex text ⇄ the stop's colour. Invalid text is ignored until valid.
    private func hexBinding(_ i: Int) -> Binding<String> {
        Binding(get: { Hex.string(model.preset.gradient?[i].color ?? [255,255,255]) },
                set: { if let rgb = Hex.parse($0) { model.preset.gradient?[i].color = rgb } })
    }
    /// Pasted hex list → evenly-spread gradient (≥2, capped at 16).
    private func applyPalette() {
        let colors = Array(Hex.parseList(paletteText).prefix(16))
        guard colors.count >= 2 else { return }
        let n = colors.count
        model.preset.gradient = colors.enumerated().map { idx, c in
            GradientStop(pos: Double(idx) / Double(n - 1), color: c)
        }
        paletteText = ""
    }
```
Keep the existing `colorBinding`/`posBinding`/`add`/`remove`/`rgb255` helpers unchanged.

- [ ] **Step 3: Build + smoke (sim).** `cd ios && xcodegen generate && cd ..` build → SUCCEEDED; install + launch; no crash. (Colour mode → Gradient → "Custom" shows the editor with hex fields + paste box.)

- [ ] **Step 4: Commit**
```
git add ios/Sources/Hex.swift ios/Sources/GradientEditor.swift
git commit -m "feat(ios): hex colour input + paste-palette in the gradient editor"
```

---

## Task 2: Export settings (resolution / duration / fps)

**Files:** Modify `ios/Sources/EditorModel.swift`, `ios/Sources/ControlsView.swift`.

- [ ] **Step 1: Add an editable export options to `EditorModel`.** In `EditorModel`, add:
```swift
    @Published var export = LivePhotoExportOptions()
```

- [ ] **Step 2: Add an "Export" section to `ControlsView`** (place it just before `MaskSection(model: model)` or after `LooksSection` — your choice; before MaskSection reads well). Insert into the `Form`:
```swift
            Section("Export") {
                Picker("Resolution", selection: resolutionBinding) {
                    ForEach(LivePhotoExportOptions.resolutionPresets.indices, id: \.self) { i in
                        Text(LivePhotoExportOptions.resolutionPresets[i].label).tag(i)
                    }
                }
                slider("Duration (\(String(format: "%.1f", model.export.duration)) s)", $model.export.duration, 1...6)
                Picker("FPS", selection: $model.export.fps) {
                    Text("24").tag(24); Text("30").tag(30); Text("60").tag(60)
                }.pickerStyle(.segmented)
            }
```
Add the binding (next to the other private bindings in `ControlsView`):
```swift
    /// Maps the resolution-preset index ⇄ the export width/height.
    private var resolutionBinding: Binding<Int> {
        Binding(get: {
            LivePhotoExportOptions.resolutionPresets.firstIndex(where: {
                $0.w == model.export.width && $0.h == model.export.height
            }) ?? 0
        }, set: { i in
            let p = LivePhotoExportOptions.resolutionPresets[i]
            model.export.width = p.w; model.export.height = p.h
        })
    }
```

- [ ] **Step 3: Build + smoke (sim).** Build → SUCCEEDED; install + launch; no crash; the Export section shows resolution/duration/fps.

- [ ] **Step 4: Commit**
```
git add ios/Sources/EditorModel.swift ios/Sources/ControlsView.swift
git commit -m "feat(ios): export settings (resolution, duration, fps)"
```

---

## Task 3: PNG + plain-video export

**Files:** Modify `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift`, `macos/Sources/PerlinLiveWallpaper/PhotoLibraryDelivery.swift`, `ios/Sources/ExportController.swift`, `ios/Sources/EditorView.swift`.

- [ ] **Step 1: Add a still-PNG export to `LivePhotoExporter`** (renders the still frame, composites the mask, writes PNG). Add inside the enum:
```swift
    /// Renders the still frame (mask-composited if a mask is given) and writes it
    /// as a PNG. Reuses the same render + composite as the Live Photo still.
    static func exportStillImage(preset: Preset, options o: LivePhotoExportOptions, mask: Mask?, pngURL: URL) -> Bool {
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else { return false }
        let time = Double(o.stillFrameIndex) / Double(o.fps)
        let bgra: [UInt8]?
        if let m = mask {
            bgra = renderMaskedBGRA(gpu: gpu, preset: preset, maskBase64: m.base64, invert: m.invert,
                                    fill: m.fill, width: o.width, height: o.height, time: time)
                .map { composite($0, over: m, width: o.width, height: o.height) }
        } else {
            bgra = Renderer.renderBGRA(gpu: gpu, preset: preset, width: o.width, height: o.height, time: time)
        }
        guard var rgba = bgra else { return false }
        var i = 0
        while i < rgba.count { rgba.swapAt(i, i + 2); i += 4 }   // BGRA → RGBA
        try? FileManager.default.removeItem(at: pngURL)
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
        guard let provider = CGDataProvider(data: Data(rgba) as CFData),
              let cg = CGImage(width: o.width, height: o.height, bitsPerComponent: 8, bitsPerPixel: 32,
                               bytesPerRow: o.width * 4, space: cs, bitmapInfo: info,
                               provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let dest = CGImageDestinationCreateWithURL(pngURL as CFURL, UTType.png.identifier as CFString, 1, nil) else { return false }
        CGImageDestinationAddImage(dest, cg, nil)
        return CGImageDestinationFinalize(dest)
    }
```
(`writeVideo(preset:options:identifier:videoURL:mask:)` already exists for the video; the plain-video export reuses it — the Live-Photo markers are harmless in a video saved as `.video`.)

- [ ] **Step 2: Add image/video saves to `PhotoLibraryDelivery`.** Add:
```swift
    static func addImage(url: URL, completion: @escaping (Result) -> Void) { addResource(.photo, url, completion) }
    static func addVideo(url: URL, completion: @escaping (Result) -> Void) { addResource(.video, url, completion) }

    private static func addResource(_ type: PHAssetResourceType, _ url: URL, _ completion: @escaping (Result) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized else { completion(.denied); return }
            PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: type, fileURL: url, options: PHAssetResourceCreationOptions())
            } completionHandler: { ok, err in completion(ok ? .added : .failed(err?.localizedDescription ?? "unknown error")) }
        }
    }
```

- [ ] **Step 3: Add `exportPNG` / `exportVideo` to `ExportController`** and use `model.export`. In `ExportController.export(_:)` change `let opts = LivePhotoExportOptions()` to `let opts = model.export`. Add two methods mirroring `export(_:)`:
```swift
    func exportImage(_ model: EditorModel) {
        busy = true; status = "Rendering image…"
        let preset = model.preset, opts = model.export
        let mask = currentMask(model, width: opts.width, height: opts.height)
        Task.detached(priority: .userInitiated) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("perlin.png")
            guard LivePhotoExporter.exportStillImage(preset: preset, options: opts, mask: mask, pngURL: url) else {
                await self.finish("Image render failed."); return
            }
            PhotoLibraryDelivery.addImage(url: url) { r in Task { @MainActor in self.report(r, "Image saved to Photos ✓") } }
        }
    }
    func exportVideo(_ model: EditorModel) {
        busy = true; status = "Rendering video…"
        let preset = model.preset, opts = model.export
        let mask = currentMask(model, width: opts.width, height: opts.height)
        Task.detached(priority: .userInitiated) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("perlin-video.mov")
            guard LivePhotoExporter.writeVideo(preset: preset, options: opts, identifier: UUID().uuidString, videoURL: url, mask: mask) else {
                await self.finish("Video render failed."); return
            }
            PhotoLibraryDelivery.addVideo(url: url) { r in Task { @MainActor in self.report(r, "Video saved to Photos ✓") } }
        }
    }
    private func report(_ r: PhotoLibraryDelivery.Result, _ ok: String) {
        switch r {
        case .added: finish(ok)
        case .denied: finish("Photos access denied — enable it in Settings → Photos.")
        case .failed(let m): finish("Saved file but Photos add failed: \(m)")
        }
    }
```
Refactor the existing mask-building into a shared `private func currentMask(_ model: EditorModel, width: Int, height: Int) -> LivePhotoExporter.Mask?` (extract the `(model.maskOn && model.maskBase64 != nil) ? makeMask(...) : nil` logic so all three exports reuse it). Keep `export(_:)` (Live Photo) working, now using `model.export` + `currentMask`.

- [ ] **Step 4: Three export buttons in `EditorView`.** Replace the single "Create Live Photo" button with:
```swift
            HStack {
                Button("Live Photo") { exporter.export(model) }.buttonStyle(.borderedProminent)
                Button("Video") { exporter.exportVideo(model) }.buttonStyle(.bordered)
                Button("Image") { exporter.exportImage(model) }.buttonStyle(.bordered)
            }.disabled(exporter.busy).padding(.vertical, 8)
```
Keep the status `Text` below it.

- [ ] **Step 5: Verify shared + iOS build.** `swift build --package-path macos && swift run --package-path macos PerlinLiveWallpaper --selftest` (expect ALL PASS + markers + masked export PASS — the exporter additions mustn't break it). Then build the iOS sim → SUCCEEDED; launch; no crash; three export buttons show.

- [ ] **Step 6: Commit**
```
git add macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift macos/Sources/PerlinLiveWallpaper/PhotoLibraryDelivery.swift ios/Sources/ExportController.swift ios/Sources/EditorView.swift
git commit -m "feat(ios): PNG (still) + plain-video export, using the export settings"
```

---

## Task 4: Review + device deploy + docs

- [ ] **Step 1: Adversarial review** of the diff: the `Hex` parse/list (3/6-digit, the regex), the paste-palette even-spread + cap, the hex⇄colour two-way binding, `exportStillImage` (BGRA→RGBA, premultiplied, mask composite), the `addResource` image/video saves, `ExportController`'s `currentMask` extraction + the three export paths (value-type capture across `Task.detached`), the export-settings bindings. Fix confirmed issues.
- [ ] **Step 2: Build + sign + install on iPhone JK** (`1D819185-3910-5389-A9BE-C377B8010156`, team `U9X7M39R56`) — same commands as prior plans.
- [ ] **Step 3: On-device acceptance (user):** hex fields edit colours; paste a palette → gradient; Image saves a PNG to Photos; Video saves a clip; export settings change resolution/length; Live Photo still works.
- [ ] **Step 4: CHANGELOG** — extend the iOS entry (hex/palette colours, PNG + video export, export settings). Commit.

---

## Self-review notes (author)

- **Spec coverage:** hex colours + paste palette (T1) ✓; PNG export (T3) ✓; video export (T3, reusing `writeVideo`) ✓; export settings (T2) ✓. Tile/loop correctly excluded.
- **Type consistency:** `Hex.parse/string/parseList` defined T1, used T1; `LivePhotoExportOptions` (existing, has width/height/duration/fps) bound in T2 + consumed by `ExportController` T3; `LivePhotoExporter.exportStillImage(preset:options:mask:pngURL:)` + the existing `writeVideo(...mask:)` used in T3; `PhotoLibraryDelivery.addImage/addVideo/addResource` defined T3 step2, used T3 step3; `ExportController.currentMask` extracted T3 step3 and used by all three exports.
- **Flag:** PNG/Video render the still-frame / advancing-time clip at the export resolution (not the live preview's exact current frame) — a clean snapshot, acceptable; matching the live frame exactly would need plumbing the preview's clock out, deferred.
