# Native iOS Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the proof-of-concept iOS app into a full native SwiftUI editor — live Metal preview, curated parameter controls, image masking with chosen backgrounds, and a mask-aware Live Photo export.

**Architecture:** Native SwiftUI reusing the portable core in `macos/Sources/PerlinLiveWallpaper/` (referenced by file path from `ios/project.yml`). `EditorModel` (`ObservableObject`) holds a `@Published var preset: Preset` (Preset's fields become `var`) plus mask state; SwiftUI controls bind directly to preset fields; a `MetalPreviewView` (`UIViewRepresentable` over `MTKView`) renders the live animation and re-applies state; "Create Live Photo" runs a mask-aware render → `LivePhotoExporter` → `PhotoLibraryDelivery`.

**Tech Stack:** Swift, SwiftUI, MetalKit, AVFoundation, PhotosUI (`PhotosPicker`), Photos, CoreGraphics. iOS project via `xcodegen` (`ios/project.yml`); shared code in the macOS SwiftPM target; no third-party deps.

**Spec:** `docs/superpowers/specs/2026-06-05-ios-native-editor-design.md`

**Conventions:** English identifiers/comments; comments explain *why*; no third-party deps; no XCTest — verify via `swift build --package-path macos`, the headless `--selftest`, and `xcodebuild`/simulator runs. Commit per task; don't push.

**How to build/run during this plan:**
- Shared code (and the export selftest): `swift build --package-path macos` and `swift run --package-path macos PerlinLiveWallpaper --selftest`.
- iOS app: `cd ios && xcodegen generate && cd ..`, then build for the simulator: `xcodebuild -project ios/PerlinLivePhoto.xcodeproj -scheme PerlinLivePhoto -sdk iphonesimulator -configuration Debug -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build`. A booted simulator (iPhone 17 Pro) is available; install with `xcrun simctl install booted <app>` and launch with `xcrun simctl launch --console-pty booted page.codeberg.jkaindl.PerlinLivePhoto`.

---

## File structure

- **Modify** `macos/Sources/PerlinLiveWallpaper/Preset.swift` — fields `let` → `var` so the editor can mutate them (Codable/reads unaffected).
- **Modify** `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift` — add a mask-aware render+composite path + `MaskSpec`/`Background` inputs; thread through `exportPair`.
- **Modify** `macos/Sources/PerlinLiveWallpaper/Renderer.swift` — add a `renderMaskedBGRA(...)` static that renders with a mask and transparent clear (RGBA-with-alpha) for the exporter to composite.
- **Create** `macos/scripts/export-gradients.js` — emit the named gradient palettes to a bundled JSON (single-sourced from `perlin-presets.js`), mirroring `export-presets.js`.
- **Create** `macos/Sources/PerlinLiveWallpaper/Resources/gradients.json` (generated, committed) + load via a small `Gradients` helper.
- **Create** `macos/Sources/PerlinLiveWallpaper/Gradients.swift` — loads the named gradients (cross-platform; `Bundle.module`/`Bundle.main` like `PresetStore`).
- **Create** `ios/Sources/EditorModel.swift` — `ObservableObject` state (preset + mask) + helpers.
- **Create** `ios/Sources/MetalPreviewView.swift` — `UIViewRepresentable` live preview.
- **Create** `ios/Sources/EditorView.swift` — the editor screen (replaces the old `ContentView` body).
- **Modify** `ios/Sources/ContentView.swift` — becomes a thin host for `EditorView` (or delete and point `PerlinLivePhotoApp` at `EditorView`).
- **Modify** `ios/project.yml` — bundle `gradients.json` (already bundles `presets`); nothing else structural.
- **Create** app icon + launch screen assets (Task 8).

> The mask-aware export (Tasks 6–7) is the load-bearing new logic; the SwiftUI/preview tasks are lower-risk but verbose. Each task builds and is committed independently.

---

## Task 1: Make `Preset` editable + `EditorModel`

**Files:**
- Modify: `macos/Sources/PerlinLiveWallpaper/Preset.swift`
- Create: `ios/Sources/EditorModel.swift`

- [ ] **Step 1: Change `Preset` stored properties from `let` to `var`**

In `Preset.swift`, change every stored property declaration in `struct Preset` and `struct GradientStop` from `let` to `var` (e.g. `let width: Int` → `var width: Int`). Do NOT change the computed properties (`label`, `colorModeIndex`, `layer2BlendModeIndex`) or anything else. The synthesized `Codable`/memberwise init still work.

- [ ] **Step 2: Verify the macOS package still builds + selftest passes**

Run: `swift build --package-path macos && swift run --package-path macos PerlinLiveWallpaper --selftest`
Expected: `Build complete!`, `selftest: ALL PASS …`, `livephoto selftest: markers + uuid match -> PASS`.

- [ ] **Step 3: Create `ios/Sources/EditorModel.swift`**

```swift
import SwiftUI
import Combine

/// The single source of editable state for the iOS editor: the working `Preset`
/// (mutated live by the controls) plus the image-mask configuration. SwiftUI
/// controls bind directly to `preset` fields; the preview and the exporter both
/// consume `preset` + the mask, so adding a control later is just one binding.
final class EditorModel: ObservableObject {
    enum Background: Equatable { case black, color(r: Double, g: Double, b: Double), sourceImage }

    @Published var preset: Preset
    @Published var maskOn: Bool = false
    @Published var maskInvert: Bool = false
    @Published var maskFill: Bool = true          // true = fill, false = fit
    @Published var background: Background = .black
    /// The picked mask image as a base64 PNG (what `Renderer.setMask` expects),
    /// and the raw image for the "source image" background.
    @Published var maskBase64: String?
    @Published var maskImageData: Data?

    init() {
        let store = PresetStore()
        self.preset = store.presets.first ?? PresetStore.fallback
    }

    /// Load a built-in preset as the new base look (keeps the current mask).
    func load(presetNamed name: String) {
        let store = PresetStore()
        if let p = store.presets.first(where: { $0.name == name }) { preset = p }
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/Preset.swift ios/Sources/EditorModel.swift
git commit -m "feat(ios): editable Preset + EditorModel state"
```

---

## Task 2: `MetalPreviewView` (live iOS preview)

**Files:**
- Create: `ios/Sources/MetalPreviewView.swift`

- [ ] **Step 1: Write the live preview view**

```swift
import SwiftUI
import MetalKit
import QuartzCore

/// A SwiftUI live preview backed by an MTKView running the shared `Renderer`.
/// Unlike the macOS desktop window, a normal app view can use MTKView's own
/// render loop, so we let it drive frames (preferredFramesPerSecond) and advance
/// a monotonic noise clock in the delegate.
struct MetalPreviewView: UIViewRepresentable {
    @ObservedObject var model: EditorModel

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: context.coordinator.gpu?.device)
        view.colorPixelFormat = .bgra8Unorm
        view.framebufferOnly = true
        view.preferredFramesPerSecond = 30
        view.isPaused = false
        view.enableSetNeedsDisplay = false
        view.delegate = context.coordinator
        context.coordinator.rebuild(preset: model.preset)
        context.coordinator.applyMask(model)
        return view
    }

    func updateUIView(_ uiView: MTKView, context: Context) {
        // Re-apply current state every SwiftUI update (cheap; the renderer
        // diffs internally where it matters).
        context.coordinator.apply(preset: model.preset)
        context.coordinator.applyMask(model)
    }

    final class Coordinator: NSObject, MTKViewDelegate {
        let gpu = GPUContext(pixelFormat: .bgra8Unorm)
        private var renderer: Renderer?
        private var lastTimestamp: CFTimeInterval = 0
        private var noiseTime: Double = 0
        private var lastMaskKey: String = "∅"

        func rebuild(preset: Preset) {
            guard let gpu else { return }
            renderer = Renderer(gpu: gpu, preset: preset)
        }
        func apply(preset: Preset) {
            if renderer == nil { rebuild(preset: preset) } else { renderer?.update(preset: preset) }
        }
        func applyMask(_ model: EditorModel) {
            // Only call setMask when the mask config actually changed (rebuilding
            // the mask texture is not free).
            let key = "\(model.maskOn)|\(model.maskInvert)|\(model.maskFill)|\(model.maskBase64?.count ?? -1)"
            guard key != lastMaskKey else { return }
            lastMaskKey = key
            renderer?.setMask(base64Png: model.maskOn ? model.maskBase64 : nil,
                              invert: model.maskInvert, fill: model.maskFill)
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}
        func draw(in view: MTKView) {
            let now = CACurrentMediaTime()
            if lastTimestamp == 0 { lastTimestamp = now }
            noiseTime += now - lastTimestamp
            lastTimestamp = now
            renderer?.draw(in: view, time: noiseTime)
        }
    }
}
```

- [ ] **Step 2: Temporarily host it so it builds + shows** — point the app at a minimal preview host:

Replace the body of `ios/Sources/ContentView.swift`'s `ContentView` with a temporary preview (full editor comes in Task 3):

```swift
import SwiftUI

struct ContentView: View {
    @StateObject private var model = EditorModel()
    var body: some View {
        MetalPreviewView(model: model).ignoresSafeArea()
    }
}
```

- [ ] **Step 3: Build for the simulator + smoke it**

Run: `cd ios && xcodegen generate && cd .. && xcodebuild -project ios/PerlinLivePhoto.xcodeproj -scheme PerlinLivePhoto -sdk iphonesimulator -configuration Debug -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build`
Expected: `** BUILD SUCCEEDED **`. Then install + launch in the booted sim and confirm the animated noise fills the screen (no crash):
```bash
APP=$(find ios/DerivedData -path "*Debug-iphonesimulator*/PerlinLivePhoto.app" -type d | head -1)
xcrun simctl install booted "$APP" && xcrun simctl launch booted page.codeberg.jkaindl.PerlinLivePhoto
```
Expected: app launches, animated Perlin noise visible.

- [ ] **Step 4: Commit**

```bash
git add ios/Sources/MetalPreviewView.swift ios/Sources/ContentView.swift
git commit -m "feat(ios): live Metal preview view"
```

---

## Task 3: `EditorView` shell + first live control

Prove the binding→preview loop with one slider, then the rest fill in (Task 4).

**Files:**
- Create: `ios/Sources/EditorView.swift`
- Modify: `ios/Sources/ContentView.swift`

- [ ] **Step 1: Create `EditorView` with the preview + a preset picker + a Speed slider**

```swift
import SwiftUI

struct EditorView: View {
    @StateObject private var model = EditorModel()
    private let presetNames = ["default","lava","aurora","clouds","terrain","circuit","marble","composite","nebula","flow"]

    var body: some View {
        VStack(spacing: 0) {
            MetalPreviewView(model: model)
                .aspectRatio(9.0/19.5, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .clipped()
            Form {
                Section("Preset") {
                    Picker("Preset", selection: presetBinding) {
                        ForEach(presetNames, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                }
                Section("Motion") {
                    labeledSlider("Speed", value: $model.preset.scaleT, range: 0.0...0.6)
                }
            }
        }
    }

    private var presetBinding: Binding<String> {
        Binding(get: { model.preset.name ?? "default" },
                set: { model.load(presetNamed: $0) })
    }

    @ViewBuilder
    private func labeledSlider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Slider(value: value, in: range)
        }
    }
}
```

- [ ] **Step 2: Point the app at `EditorView`**

Set `ios/Sources/ContentView.swift` to:
```swift
import SwiftUI
struct ContentView: View { var body: some View { EditorView() } }
```

- [ ] **Step 3: Build + smoke (sim)**

Run the same build+install+launch as Task 2 Step 3. Expected: the preview shows on top, a preset picker + Speed slider below; changing Speed visibly changes the animation rate; switching presets changes the look.

- [ ] **Step 4: Commit**

```bash
git add ios/Sources/EditorView.swift ios/Sources/ContentView.swift
git commit -m "feat(ios): editor shell with live preset + speed control"
```

---

## Task 4: Bundle named gradients + fill curated controls

**Files:**
- Create: `macos/scripts/export-gradients.js`
- Create: `macos/Sources/PerlinLiveWallpaper/Resources/gradients.json` (generated)
- Create: `macos/Sources/PerlinLiveWallpaper/Gradients.swift`
- Modify: `macos/Sources/PerlinLiveWallpaper/Resources` wiring in `Package.swift` and `ios/project.yml`
- Modify: `ios/Sources/EditorView.swift`

- [ ] **Step 1: Write `macos/scripts/export-gradients.js`** (mirror `export-presets.js`'s require pattern)

```js
#!/usr/bin/env node
// Emit the named gradient palettes from perlin-presets.js to a bundled JSON,
// single-sourcing them (like export-presets.js does for presets).
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "..", "perlin-presets.js"));
const { GRADIENTS } = global.window.MTPerlinPresets;
const out = Object.entries(GRADIENTS).map(([name, stops]) => ({
  name,
  stops: stops.map((s) => ({ pos: s.pos, color: s.color })),
}));
const dest = path.join(__dirname, "..", "Sources", "PerlinLiveWallpaper", "Resources", "gradients.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
process.stderr.write(`export-gradients: ${out.length} gradients -> ${dest}\n`);
```

- [ ] **Step 2: Generate the JSON + verify**

Run: `node macos/scripts/export-gradients.js && head -5 macos/Sources/PerlinLiveWallpaper/Resources/gradients.json`
Expected: a JSON array of `{name, stops:[{pos,color:[r,g,b]}]}`; stderr shows the count.

- [ ] **Step 3: Bundle the resource** — in `macos/Package.swift`, change the resources line to include the file, and in `ios/project.yml` add it.

`macos/Package.swift`: change `resources: [.copy("Resources/presets"), .copy("Resources/studio")]` to also include `.copy("Resources/gradients.json")`.

`ios/project.yml`: under the target's `sources`, add after the presets resource:
```yaml
      - path: ../macos/Sources/PerlinLiveWallpaper/Resources/gradients.json
        buildPhase: resources
```

- [ ] **Step 4: Create `macos/Sources/PerlinLiveWallpaper/Gradients.swift`**

```swift
import Foundation

/// Loads the named gradient palettes bundled as gradients.json. Cross-platform
/// like PresetStore (SwiftPM Bundle.module / app Bundle.main).
enum Gradients {
    struct Named: Decodable { let name: String; let stops: [GradientStop] }

    static let all: [Named] = {
        #if SWIFT_PACKAGE
        let url = Bundle.module.url(forResource: "gradients", withExtension: "json")
        #else
        let url = Bundle.main.url(forResource: "gradients", withExtension: "json")
        #endif
        guard let url, let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Named].self, from: data) else { return [] }
        return list
    }()

    static func stops(named name: String) -> [GradientStop]? {
        all.first(where: { $0.name == name })?.stops
    }
}
```

- [ ] **Step 5: Verify shared build + selftest still green**

Run: `swift build --package-path macos && swift run --package-path macos PerlinLiveWallpaper --selftest`
Expected: green (gradients.json now bundled in the SwiftPM target too).

- [ ] **Step 6: Add the curated controls to `EditorView`** — replace the `Form` content with the full set:

```swift
            Form {
                Section("Preset") {
                    Picker("Preset", selection: presetBinding) {
                        ForEach(presetNames, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                }
                Section("Colour") {
                    Picker("Mode", selection: $model.preset.colorMode) {
                        Text("Gradient").tag("gradient"); Text("Posterize").tag("posterize")
                        Text("HSV").tag("hsv"); Text("Flow").tag("flow")
                    }.pickerStyle(.segmented)
                    if model.preset.colorMode == "gradient" || model.preset.colorMode == "posterize" {
                        Picker("Gradient", selection: gradientBinding) {
                            ForEach(Gradients.all, id: \.name) { Text($0.name.capitalized).tag($0.name) }
                        }
                    }
                }
                Section("Shape") {
                    labeledSlider("Zoom", value: zoomBinding, range: 0.003...0.05)
                    labeledSlider("Detail", value: octavesBinding, range: 1...8)
                    labeledSlider("Warp", value: warpBinding, range: 0...30)
                }
                Section("Motion") {
                    labeledSlider("Speed", value: $model.preset.scaleT, range: 0.0...0.6)
                }
            }
```

Add these bindings as private computed properties on `EditorView` (curated fields map to `Preset` fields; some need light transforms):

```swift
    @State private var gradientName: String = "fire"
    private var gradientBinding: Binding<String> {
        Binding(get: { gradientName },
                set: { gradientName = $0; model.preset.gradient = Gradients.stops(named: $0) })
    }
    // One "zoom" master drives both scale axes equally.
    private var zoomBinding: Binding<Double> {
        Binding(get: { model.preset.scaleX },
                set: { model.preset.scaleX = $0; model.preset.scaleY = $0 })
    }
    private var octavesBinding: Binding<Double> {
        Binding(get: { Double(model.preset.octaves) }, set: { model.preset.octaves = Int($0.rounded()) })
    }
    private var warpBinding: Binding<Double> {
        Binding(get: { model.preset.warpStrength ?? 0 }, set: { model.preset.warpStrength = $0 })
    }
```

- [ ] **Step 7: Build + smoke (sim)** — same build/install/launch. Expected: colour-mode segmented control switches modes live; the gradient picker recolours; Zoom/Detail/Warp/Speed all change the preview live.

- [ ] **Step 8: Commit**

```bash
git add macos/scripts/export-gradients.js macos/Sources/PerlinLiveWallpaper/Resources/gradients.json macos/Sources/PerlinLiveWallpaper/Gradients.swift macos/Package.swift ios/project.yml ios/Sources/EditorView.swift
git commit -m "feat(ios): curated controls + bundled named gradients"
```

---

## Task 5: Mask section (pick image → live masked preview)

**Files:**
- Modify: `ios/Sources/EditorView.swift`
- Create: `ios/Sources/MaskSection.swift`

- [ ] **Step 1: Create `MaskSection.swift`** (PhotosPicker → base64 PNG + the mask toggles)

```swift
import SwiftUI
import PhotosUI
import UIKit

/// The mask controls: pick an image (used as alpha-or-luminance mask), toggle
/// on/off + invert + fit/fill, and choose the export background. Converts the
/// picked image to the base64 PNG that Renderer.setMask expects.
struct MaskSection: View {
    @ObservedObject var model: EditorModel
    @State private var pick: PhotosPickerItem?

    var body: some View {
        Section("Mask") {
            PhotosPicker(selection: $pick, matching: .images) {
                Label(model.maskBase64 == nil ? "Choose Image…" : "Change Image…", systemImage: "photo")
            }
            .onChange(of: pick) { _, item in Task { await loadMask(item) } }

            if model.maskBase64 != nil {
                Toggle("Mask on", isOn: $model.maskOn)
                Toggle("Invert", isOn: $model.maskInvert)
                Picker("Aspect", selection: $model.maskFill) {
                    Text("Fit").tag(false); Text("Fill").tag(true)
                }.pickerStyle(.segmented)
                Picker("Background", selection: backgroundTag) {
                    Text("Black").tag(0); Text("Source image").tag(1)
                }
            }
        }
    }

    private var backgroundTag: Binding<Int> {
        Binding(get: { if case .sourceImage = model.background { return 1 } else { return 0 } },
                set: { model.background = ($0 == 1) ? .sourceImage : .black })
    }

    private func loadMask(_ item: PhotosPickerItem?) async {
        guard let item, let data = try? await item.loadTransferable(type: Data.self),
              let img = UIImage(data: data), let png = img.pngData() else { return }
        await MainActor.run {
            model.maskImageData = png
            model.maskBase64 = png.base64EncodedString()
            model.maskOn = true
        }
    }
}
```

- [ ] **Step 2: Add `MaskSection(model: model)` to `EditorView`'s `Form`** (after the Motion section).

- [ ] **Step 3: Build + smoke (sim)** — install/launch; tap "Choose Image…", pick a sim photo, toggle Mask on → the preview shows the noise only inside the image's shape; Invert + Fit/Fill behave. (The sim has sample photos; if none, add one via `xcrun simctl addmedia booted <png>`.)

- [ ] **Step 4: Commit**

```bash
git add ios/Sources/MaskSection.swift ios/Sources/EditorView.swift
git commit -m "feat(ios): image mask picker + live masked preview"
```

---

## Task 6: Mask-aware export (shared core) + selftest

**Files:**
- Modify: `macos/Sources/PerlinLiveWallpaper/Renderer.swift`
- Modify: `macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift`

- [ ] **Step 1: Add `renderMaskedBGRA` to `Renderer`** (renders with a mask + transparent clear → premultiplied RGBA)

In `Renderer.swift`, next to `renderBGRA`, add:
```swift
    /// Like renderBGRA but applies an image mask and clears transparent, so the
    /// result is premultiplied BGRA with alpha=0 where the mask hides the noise.
    /// The caller composites this over an opaque background.
    static func renderMaskedBGRA(gpu: GPUContext, preset: Preset, maskBase64: String,
                                 invert: Bool, fill: Bool, width: Int, height: Int, time: Double) -> [UInt8]? {
        guard let renderer = Renderer(gpu: gpu, preset: preset) else { return nil }
        renderer.setMask(base64Png: maskBase64, invert: invert, fill: fill)
        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
        td.usage = [.renderTarget, .shaderRead]; td.storageMode = .shared
        guard let tex = gpu.device.makeTexture(descriptor: td) else { return nil }
        let rpd = MTLRenderPassDescriptor()
        rpd.colorAttachments[0].texture = tex
        rpd.colorAttachments[0].loadAction = .clear
        rpd.colorAttachments[0].storeAction = .store
        rpd.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)   // transparent
        let cmd = renderer.encode(passDescriptor: rpd, drawableSize: CGSize(width: width, height: height), drawable: nil, time: time)
        cmd?.waitUntilCompleted()
        var buf = [UInt8](repeating: 0, count: width * height * 4)
        tex.getBytes(&buf, bytesPerRow: width * 4, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
        return buf
    }
```

- [ ] **Step 2: Add a `Mask` input type + composite to `LivePhotoExporter`**

In `LivePhotoExporter.swift`, add (inside the enum):
```swift
    /// Mask + background for a masked export. `backgroundBGRA`, when set, is a
    /// width*height*4 BGRA buffer (e.g. the source image scaled to frame) used
    /// where the mask hides the noise; nil means a solid colour `bg`.
    struct Mask {
        var base64: String
        var invert: Bool
        var fill: Bool
        var bg: (b: UInt8, g: UInt8, r: UInt8) = (0, 0, 0)   // solid background (default black)
        var backgroundBGRA: [UInt8]? = nil                   // optional per-pixel background
    }

    /// Composites premultiplied masked BGRA over an opaque background → opaque BGRA.
    private static func composite(_ masked: [UInt8], over mask: Mask, width: Int, height: Int) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: width * height * 4)
        var i = 0
        while i < out.count {
            let a = Int(masked[i + 3])                 // premultiplied alpha
            // masked RGB is already premultiplied (noise*alpha); add bg*(1-a).
            let inv = 255 - a
            let bgB: Int, bgG: Int, bgR: Int
            if let buf = mask.backgroundBGRA {
                bgB = Int(buf[i]); bgG = Int(buf[i + 1]); bgR = Int(buf[i + 2])
            } else {
                bgB = Int(mask.bg.b); bgG = Int(mask.bg.g); bgR = Int(mask.bg.r)
            }
            out[i]     = UInt8(min(255, Int(masked[i])     + bgB * inv / 255))
            out[i + 1] = UInt8(min(255, Int(masked[i + 1]) + bgG * inv / 255))
            out[i + 2] = UInt8(min(255, Int(masked[i + 2]) + bgR * inv / 255))
            out[i + 3] = 255
            i += 4
        }
        return out
    }
```

- [ ] **Step 3: Thread an optional `Mask` through `writeVideo`/`writeStill`/`exportPair`**

Add `mask: Mask? = nil` as a parameter to `writeVideo`, `writeStill`, and `exportPair` (default nil keeps the existing callers working). Inside `writeVideo`'s per-frame render and `writeStill`, when `mask != nil`, replace the `Renderer.renderBGRA(...)` call with:
```swift
            let frameBGRA: [UInt8]?
            if let m = mask {
                frameBGRA = Renderer.renderMaskedBGRA(gpu: gpu, preset: preset, maskBase64: m.base64,
                                                      invert: m.invert, fill: m.fill, width: o.width, height: o.height, time: time)
                    .map { composite($0, over: m, width: o.width, height: o.height) }
            } else {
                frameBGRA = Renderer.renderBGRA(gpu: gpu, preset: preset, width: o.width, height: o.height, time: time)
            }
            guard let bgra = frameBGRA, ... // existing pixel-buffer path uses `bgra`
```
(In `writeStill`, the analogous swap; it already does a BGRA→RGBA swap afterward, which is unchanged.)

- [ ] **Step 4: Extend the selftest to cover the masked path**

In `LivePhotoExporter.selfTest()`, after the existing check, add a masked export using a tiny solid-white 1×1-scaled mask (a 2×2 white PNG base64) and assert it still produces a valid pair (markers + uuid) and that the frames are opaque (sample the still's alpha = 255). Minimal addition:
```swift
        // Masked path: a fully-white mask = noise everywhere, composited on black.
        let whitePNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let m = Mask(base64: whitePNG, invert: false, fill: true)
        let okMask = exportPair(preset: preset, options: opts, stillURL: stillURL, videoURL: videoURL, mask: m) != nil
            && verifyPair(stillURL: stillURL, videoURL: videoURL)
        print("livephoto selftest: masked export -> \(okMask ? "PASS" : "FAIL")")
        return ok && okMask
```

- [ ] **Step 5: Build + run selftest**

Run: `swift build --package-path macos && swift run --package-path macos PerlinLiveWallpaper --selftest`
Expected: `livephoto selftest: markers + uuid match -> PASS` AND `livephoto selftest: masked export -> PASS`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add macos/Sources/PerlinLiveWallpaper/Renderer.swift macos/Sources/PerlinLiveWallpaper/LivePhotoExporter.swift
git commit -m "feat(macos): mask-aware Live Photo export (composite over background)"
```

---

## Task 7: Wire "Create Live Photo" to the masked export + delivery

**Files:**
- Modify: `ios/Sources/EditorView.swift`
- Create: `ios/Sources/ExportController.swift`

- [ ] **Step 1: Create `ExportController.swift`** (builds the `Mask`/background, runs the export off-main, delivers, surfaces status)

```swift
import SwiftUI
import UIKit

/// Runs a Live Photo export for the current EditorModel: builds the mask +
/// background (incl. scaling the source image to the frame for the
/// source-image background), renders off-main, and saves via PhotoKit.
@MainActor
final class ExportController: ObservableObject {
    @Published var busy = false
    @Published var status = ""

    func export(_ model: EditorModel) {
        busy = true; status = "Rendering…"
        let preset = model.preset
        var opts = LivePhotoExportOptions()
        let w = opts.width, h = opts.height
        let mask: LivePhotoExporter.Mask? = (model.maskOn && model.maskBase64 != nil)
            ? makeMask(model, width: w, height: h) : nil

        Task.detached(priority: .userInitiated) {
            let dir = FileManager.default.temporaryDirectory
            let still = dir.appendingPathComponent("perlin.heic")
            let video = dir.appendingPathComponent("perlin.mov")
            let id = LivePhotoExporter.exportPair(preset: preset, options: opts, stillURL: still, videoURL: video, mask: mask)
            let valid = id != nil && LivePhotoExporter.verifyPair(stillURL: still, videoURL: video)
            guard valid else { await self.finish("Generation failed."); return }
            PhotoLibraryDelivery.add(stillURL: still, videoURL: video) { result in
                Task { @MainActor in
                    switch result {
                    case .added: self.finish("Saved to Photos ✓ — find it in Photos.")
                    case .denied: self.finish("Photos access denied — enable it in Settings → Photos.")
                    case .failed(let m): self.finish("Saved file but Photos add failed: \(m)")
                    }
                }
            }
        }
    }

    private func finish(_ m: String) { busy = false; status = m }

    /// Builds the Mask, scaling the picked image to width×height (fill) as the
    /// BGRA background when the user chose the source-image background.
    private func makeMask(_ model: EditorModel, width: Int, height: Int) -> LivePhotoExporter.Mask {
        var m = LivePhotoExporter.Mask(base64: model.maskBase64!, invert: model.maskInvert, fill: model.maskFill)
        if case .sourceImage = model.background, let data = model.maskImageData, let img = UIImage(data: data) {
            m.backgroundBGRA = Self.bgraBuffer(of: img, width: width, height: height)
        }
        return m
    }

    /// Renders a UIImage into a width×height BGRA buffer (aspect-fill).
    private static func bgraBuffer(of img: UIImage, width: Int, height: Int) -> [UInt8]? {
        var buf = [UInt8](repeating: 0, count: width * height * 4)
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        guard let ctx = CGContext(data: &buf, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: width * 4, space: cs, bitmapInfo: info),
              let cg = img.cgImage else { return nil }
        // Aspect-fill the image into the frame.
        let iw = CGFloat(cg.width), ih = CGFloat(cg.height)
        let scale = max(CGFloat(width) / iw, CGFloat(height) / ih)
        let dw = iw * scale, dh = ih * scale
        ctx.draw(cg, in: CGRect(x: (CGFloat(width) - dw) / 2, y: (CGFloat(height) - dh) / 2, width: dw, height: dh))
        return buf
    }
}
```

- [ ] **Step 2: Add the button + status to `EditorView`**

Add `@StateObject private var exporter = ExportController()` to `EditorView`, and below the `Form` (inside the outer `VStack`):
```swift
            Button(exporter.busy ? "Working…" : "Create Live Photo") { exporter.export(model) }
                .buttonStyle(.borderedProminent).disabled(exporter.busy).padding(.vertical, 8)
            if !exporter.status.isEmpty { Text(exporter.status).font(.footnote).foregroundStyle(.secondary).padding(.bottom, 6) }
```

- [ ] **Step 3: Build + smoke (sim)** — generate without a mask, then with a mask + each background; confirm the status reports "Saved to Photos ✓" (grant photos in the sim first: `xcrun simctl privacy booted grant photos-add page.codeberg.jkaindl.PerlinLivePhoto`). Verify a Live Photo appears in the sim Photos app.

- [ ] **Step 4: Commit**

```bash
git add ios/Sources/ExportController.swift ios/Sources/EditorView.swift
git commit -m "feat(ios): Create Live Photo — masked export + delivery wired to the editor"
```

---

## Task 8: Polish — app icon, launch screen, iPad layout

**Files:**
- Create: `ios/Sources/Assets.xcassets/AppIcon.appiconset/` (icon) + `ios/project.yml` wiring
- Modify: `ios/Sources/Info.plist` (launch screen) + `ios/Sources/EditorView.swift` (iPad/landscape)

- [ ] **Step 1: Generate an app icon** from a Perlin render. Use the existing `--render` CLI to make a 1024×1024 PNG, then build the `AppIcon.appiconset`:
```bash
swift run --package-path macos PerlinLiveWallpaper --render aurora /tmp/icon.png   # produces a render; resize to 1024²
sips -z 1024 1024 /tmp/icon.png --out ios/Sources/Assets.xcassets/AppIcon.appiconset/icon-1024.png
```
Create `ios/Sources/Assets.xcassets/AppIcon.appiconset/Contents.json` with a single 1024×1024 universal iOS icon entry (Xcode 14+ single-size form):
```json
{ "images": [ { "filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024" } ], "info": { "author": "xcode", "version": 1 } }
```
In `ios/project.yml`, add `- path: Sources/Assets.xcassets` to the target `sources`, and set `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` in the target `settings.base`.

- [ ] **Step 2: Launch screen** — add to `ios/Sources/Info.plist` a minimal `UILaunchScreen` dict with a background colour (or leave the empty dict already present). Confirm no storyboard is required.

- [ ] **Step 3: iPad/landscape pass** — in `EditorView`, wrap the root in a `NavigationStack` and verify the preview scales and the `Form` scrolls on iPad; if the preview is too tall in landscape, cap its height: `.frame(maxHeight: 420)` on the preview. Set `TARGETED_DEVICE_FAMILY: "1,2"` (already set) and confirm the app rotates.

- [ ] **Step 4: Build + smoke on the iPad simulator** (boot one if needed: `xcrun simctl boot "iPad Pro 11-inch"`), confirm layout + icon.

- [ ] **Step 5: Commit**

```bash
git add ios/Sources/Assets.xcassets ios/project.yml ios/Sources/Info.plist ios/Sources/EditorView.swift
git commit -m "feat(ios): app icon, launch screen, iPad layout"
```

---

## Task 9: Review + device deploy + acceptance

- [ ] **Step 1: Adversarial code review** of the whole iOS-editor diff (the mask compositing math in `composite`/`bgraBuffer`, the preview lifecycle/threading in `MetalPreviewView`, the `Background` enum handling, the binding transforms, retain cycles in the controllers). Fix confirmed issues.

- [ ] **Step 2: Build + sign + install on the device** (iPhone JK, `1D819185-3910-5389-A9BE-C377B8010156`):
```bash
xcodebuild -project ios/PerlinLivePhoto.xcodeproj -scheme PerlinLivePhoto -sdk iphoneos -configuration Debug -derivedDataPath ios/DerivedData -allowProvisioningUpdates -destination 'generic/platform=iOS' DEVELOPMENT_TEAM=U9X7M39R56 CODE_SIGN_STYLE=Automatic build
APP=$(find ios/DerivedData -path "*Debug-iphoneos*/PerlinLivePhoto.app" -type d | head -1)
xcrun devicectl device install app --device 1D819185-3910-5389-A9BE-C377B8010156 "$APP"
xcrun devicectl device process launch --device 1D819185-3910-5389-A9BE-C377B8010156 page.codeberg.jkaindl.PerlinLivePhoto
```

- [ ] **Step 3: On-device acceptance (user):** tune a look with live preview, mask an image (flames in a shape) with each background, Create Live Photo, confirm it lands in Photos and animates on long-press. The real acceptance test.

- [ ] **Step 4: Docs + final commit** — add a CHANGELOG entry and a short `ios/README.md` (what the app does, build/run, the wallpaper caveat). Commit.

---

## Self-review notes (author)

- **Spec coverage:** native SwiftUI editor (T2–T4, T7) ✓; `EditorModel`/`EditorParams` via editable `Preset` (T1) ✓; `MetalPreviewView` live preview (T2) ✓; curated controls + incremental-by-binding (T3–T4) ✓; named gradients bundled (T4) ✓; image masking + on/off/invert/fit-fill (T5) ✓; background modes black/colour/source-image (T6 `Mask.bg`/`backgroundBGRA`, T7 wiring — **colour-picker UI is reduced to black/source-image in T5's Picker; a solid-colour picker is a trivial later addition**, flagged) ✓; mask-aware export (T6) ✓; live preview (T2) ✓; polish icon/launch/iPad (T8) ✓; testing headless+sim+device (T6 selftest, T2–T7 sim, T9 device) ✓; "Look speichern" + full parity correctly **deferred** (not in plan).
- **Type consistency:** `EditorModel` fields (`preset`, `maskOn/Invert/Fill`, `background`, `maskBase64`, `maskImageData`) used consistently in T2/T5/T7; `LivePhotoExporter.Mask` (`base64/invert/fill/bg/backgroundBGRA`) defined in T6, consumed in T7; `Renderer.renderMaskedBGRA` signature defined T6 step1, called T6 step3; `Gradients.all/stops(named:)` defined T4 step4, used T4 step6.
- **Known unknowns flagged inline:** the exact `writeStill`/`writeVideo` edit points (T6 step3 — "existing pixel-buffer path uses `bgra`"); the solid-colour background UI (deferred to a later additive control; `Mask.bg` already supports it).
