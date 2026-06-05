# iOS Editor — Full Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expand the native iOS editor from curated essentials to **full control**: every parameter the renderer supports, a custom gradient editor, and saving/loading named looks.

**Architecture:** Additive to the existing editor — controls bind to `model.preset` fields (now `var`), the live preview + exporter already consume the whole `Preset`. The growing control set moves out of `EditorView` into a focused `ControlsView`; the gradient editor and looks library are their own SwiftUI files; the looks store reuses the portable `CustomPresetStore`.

**Tech Stack:** SwiftUI, the shared core in `macos/Sources/PerlinLiveWallpaper/`. iOS project via xcodegen. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-05-ios-native-editor-design.md` (§9 deferred items — now built).

**Conventions:** English, why-comments, no deps, commit `feat(ios): …`. Build iOS sim: `cd ios && xcodegen generate && cd .. && xcodebuild -project ios/PerlinLivePhoto.xcodeproj -scheme PerlinLivePhoto -sdk iphonesimulator -configuration Debug -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build`. New files in `ios/Sources/` are auto-included (folder reference); shared `macos/` files must be listed in `ios/project.yml`. Don't push.

**Not reachable (renderer limitation, out of scope):** tileable noise, 4D loop mode — the native renderer never implemented them.

---

## File structure

- **Create** `ios/Sources/ControlsView.swift` — the full control Form (all parameter sections + binding helpers). `EditorView` embeds it.
- **Create** `ios/Sources/GradientEditor.swift` — edit `preset.gradient` stops (add/remove/colour/position).
- **Create** `ios/Sources/LooksSection.swift` — save the current look + list/load/delete saved looks (reuses `CustomPresetStore`).
- **Modify** `ios/Sources/EditorView.swift` — replace the inline `Form` with `ControlsView(model: model)` (keep preview + button).
- **Modify** `ios/project.yml` — add `macos/Sources/PerlinLiveWallpaper/CustomPresetStore.swift` to the target sources.
- **Modify** `CHANGELOG.md` (Task 4).

---

## Task 1: `ControlsView` — full parameter parity

Move the existing sections into a focused `ControlsView` and add every renderer parameter. Bindings use keyPath helpers to stay DRY. Optional fields fall back to a sensible default.

**Files:** Create `ios/Sources/ControlsView.swift`; modify `ios/Sources/EditorView.swift`.

- [ ] **Step 1: Create `ios/Sources/ControlsView.swift`:**

```swift
import SwiftUI

/// The editor's full control panel. Every row binds to a `Preset` field on the
/// shared model; colour-mode-specific sections appear for the active mode.
struct ControlsView: View {
    @ObservedObject var model: EditorModel
    private let presetNames = ["default","lava","aurora","clouds","terrain","circuit","marble","composite","nebula","flow"]
    @State private var gradientName = "fire"

    var body: some View {
        Form {
            Section("Preset") {
                Picker("Preset", selection: presetBinding) {
                    ForEach(presetNames, id: \.self) { Text($0.capitalized).tag($0) }
                }
            }
            Section("Colour") {
                Picker("Mode", selection: $model.preset.colorMode) {
                    Text("Gradient").tag("gradient"); Text("Posterize").tag("posterize")
                    Text("HSV").tag("hsv"); Text("Flow").tag("flow"); Text("RGB").tag("rgb")
                }.pickerStyle(.menu)
                if model.preset.colorMode == "gradient" || model.preset.colorMode == "posterize" {
                    Picker("Gradient", selection: gradientBinding) {
                        ForEach(Gradients.all, id: \.name) { Text($0.name.capitalized).tag($0.name) }
                        Text("Custom").tag("custom")
                    }
                    if gradientName == "custom" { GradientEditor(model: model) }
                }
                if model.preset.colorMode == "posterize" {
                    slider("Steps", intB(\.posterizeSteps, 5), 2...16)
                }
                if model.preset.colorMode == "hsv" {
                    slider("Hue shift", dbl(\.hsvHueShift, 0), 0...1)
                    slider("Hue range", dbl(\.hsvHueRange, 0.5), 0...1)
                    slider("Saturation", dbl(\.hsvSat, 0.8), 0...1)
                    slider("Value", dbl(\.hsvVal, 1), 0...1)
                }
                if model.preset.colorMode == "flow" {
                    slider("Hue shift", dbl(\.flowHueShift, 0), 0...1)
                    slider("Saturation", dbl(\.flowSat, 0.8), 0...1)
                    slider("Gain", dbl(\.flowGain, 1), 0...4)
                    slider("Floor", dbl(\.flowFloor, 0), 0...1)
                    slider("Eps", dbl(\.flowEps, 0.001), 0.0005...0.01)
                }
                if model.preset.colorMode == "rgb" {
                    Toggle("Per-channel", isOn: boolB(\.rgbMultiChannel, false))
                    slider("R scale", dbl(\.rScale, 0.011), 0.003...0.05)
                    slider("G scale", dbl(\.gScale, 0.011), 0.003...0.05)
                    slider("B scale", dbl(\.bScale, 0.011), 0.003...0.05)
                    Toggle("Invert R", isOn: boolB(\.rInvert, false))
                    Toggle("Invert G", isOn: boolB(\.gInvert, false))
                    Toggle("Invert B", isOn: boolB(\.bInvert, false))
                }
            }
            Section("Shape") {
                slider("Zoom", zoomBinding, 0.003...0.05)
                slider("Detail (octaves)", intB(\.octaves, 5).double, 1...8)
                slider("Persistence", $model.preset.persistence, 0.1...0.9)
                slider("Lacunarity", $model.preset.lacunarity, 1.5...3.0)
                Stepper("Seed: \(model.preset.base)", value: $model.preset.base, in: 0...255)
            }
            Section("Warp") {
                slider("Strength", dbl(\.warpStrength, 0), 0...30)
                slider("Scale", dbl(\.warpScale, 1), 0.2...3)
            }
            Section("Layer 2") {
                Toggle("On", isOn: boolB(\.layer2On, false))
                if model.preset.layer2On == true {
                    slider("Scale X", dbl(\.layer2ScaleX, 0.02), 0.003...0.08)
                    slider("Scale Y", dbl(\.layer2ScaleY, 0.02), 0.003...0.08)
                    slider("Octaves", intB(\.layer2Octaves, 3).double, 1...8)
                    slider("Mix", dbl(\.layer2Mix, 0.5), 0...1)
                    Picker("Blend", selection: blendBinding) {
                        ForEach(["multiply","add","screen","darken","lighten","difference"], id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    Stepper("L2 seed: \(model.preset.layer2Base ?? 0)", value: intB(\.layer2Base, 0), in: 0...255)
                }
            }
            Section("Motion") { slider("Speed", $model.preset.scaleT, 0.0...0.6) }
            MaskSection(model: model)
            LooksSection(model: model)
        }
    }

    // MARK: bindings
    private var presetBinding: Binding<String> {
        Binding(get: { model.preset.name ?? "default" }, set: { model.load(presetNamed: $0) })
    }
    private var gradientBinding: Binding<String> {
        Binding(get: { gradientName },
                set: { gradientName = $0; if $0 != "custom" { model.preset.gradient = Gradients.stops(named: $0) } })
    }
    private var zoomBinding: Binding<Double> {
        Binding(get: { model.preset.scaleX }, set: { model.preset.scaleX = $0; model.preset.scaleY = $0 })
    }
    private var blendBinding: Binding<String> {
        Binding(get: { model.preset.layer2BlendMode ?? "multiply" }, set: { model.preset.layer2BlendMode = $0 })
    }
    /// Optional-Double field → non-optional Binding with a default.
    private func dbl(_ kp: WritableKeyPath<Preset, Double?>, _ def: Double) -> Binding<Double> {
        Binding(get: { model.preset[keyPath: kp] ?? def }, set: { model.preset[keyPath: kp] = $0 })
    }
    /// Optional-Int field → Int Binding with a default.
    private func intB(_ kp: WritableKeyPath<Preset, Int?>, _ def: Int) -> Binding<Int> {
        Binding(get: { model.preset[keyPath: kp] ?? def }, set: { model.preset[keyPath: kp] = $0 })
    }
    /// Optional-Bool field → Bool Binding with a default.
    private func boolB(_ kp: WritableKeyPath<Preset, Bool?>, _ def: Bool) -> Binding<Bool> {
        Binding(get: { model.preset[keyPath: kp] ?? def }, set: { model.preset[keyPath: kp] = $0 })
    }
    @ViewBuilder
    private func slider(_ title: String, _ value: Binding<Double>, _ range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Slider(value: value, in: range)
        }
    }
}

private extension Binding where Value == Int {
    /// View an Int binding as a Double for sliders that step to whole numbers.
    var double: Binding<Double> { Binding(get: { Double(wrappedValue) }, set: { wrappedValue = Int($0.rounded()) }) }
}
```

- [ ] **Step 2: Slim `EditorView` to embed `ControlsView`.** Replace the inline `Form { … }` (everything between the preview and the export button) with `ControlsView(model: model)`. Remove the now-unused `presetNames`, `gradientBinding`/`zoomBinding`/`octavesBinding`/`warpBinding`/`gradientName` helpers and `labeledSlider` from `EditorView` (they moved to `ControlsView`). Keep the `MetalPreviewView`, the `NavigationStack`, the export `Button`, and the `ExportController`. (`MaskSection` is now rendered by `ControlsView`, so remove it from `EditorView` if it was there.)

- [ ] **Step 3: Build + smoke (sim).** Build → BUILD SUCCEEDED; install + launch in a booted sim; confirm no crash and the form shows all sections (Preset, Colour with mode-specific rows, Shape, Warp, Layer 2, Motion, Mask, Looks — Looks/GradientEditor come from Tasks 2-3 which you create as empty stubs first if needed; see note). 

> NOTE: `ControlsView` references `GradientEditor` (Task 2) and `LooksSection` (Task 3). To build Task 1 alone, first create minimal stubs: `struct GradientEditor: View { @ObservedObject var model: EditorModel; var body: some View { EmptyView() } }` and `struct LooksSection: View { @ObservedObject var model: EditorModel; var body: some View { EmptyView() } }` in their files — Tasks 2-3 replace the bodies. Commit the stubs with Task 1 so it builds.

- [ ] **Step 4: Commit**

```bash
git add ios/Sources/ControlsView.swift ios/Sources/GradientEditor.swift ios/Sources/LooksSection.swift ios/Sources/EditorView.swift
git commit -m "feat(ios): full parameter parity — all renderer controls in ControlsView"
```

---

## Task 2: Custom gradient editor

**Files:** Modify `ios/Sources/GradientEditor.swift` (replace the stub).

- [ ] **Step 1: Implement the gradient editor:**

```swift
import SwiftUI

/// Edits the working preset's gradient stops: a row per stop with a colour well
/// and a position slider, plus add/remove. Writing any stop updates
/// `model.preset.gradient`, which the live preview + export consume.
struct GradientEditor: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        let stops = model.preset.gradient ?? []
        ForEach(stops.indices, id: \.self) { i in
            HStack {
                ColorPicker("", selection: colorBinding(i), supportsOpacity: false).labelsHidden()
                Slider(value: posBinding(i), in: 0...1)
                if stops.count > 2 {
                    Button(role: .destructive) { remove(i) } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.borderless)
                }
            }
        }
        Button { add() } label: { Label("Add stop", systemImage: "plus") }
    }

    private func colorBinding(_ i: Int) -> Binding<Color> {
        Binding(get: {
            let c = model.preset.gradient?[i].color ?? [255,255,255]
            return Color(red: Double(c[0])/255, green: Double(c[1])/255, blue: Double(c[2])/255)
        }, set: { newColor in
            let rgb = Self.rgb255(newColor)
            model.preset.gradient?[i].color = rgb
        })
    }
    private func posBinding(_ i: Int) -> Binding<Double> {
        Binding(get: { model.preset.gradient?[i].pos ?? 0 },
                set: { model.preset.gradient?[i].pos = $0 })
    }
    private func add() {
        var g = model.preset.gradient ?? []
        g.append(GradientStop(pos: 1.0, color: [255,255,255]))
        model.preset.gradient = g.sorted { $0.pos < $1.pos }
    }
    private func remove(_ i: Int) {
        guard var g = model.preset.gradient, g.indices.contains(i) else { return }
        g.remove(at: i); model.preset.gradient = g
    }
    /// SwiftUI Color → [r,g,b] in 0...255 via its resolved sRGB components.
    private static func rgb255(_ color: Color) -> [Int] {
        let ui = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return [Int((r*255).rounded()), Int((g*255).rounded()), Int((b*255).rounded())]
    }
}
```

- [ ] **Step 2: Build + smoke (sim).** Switch colour mode to Gradient, pick "Custom" in the gradient picker → the stop rows appear; the preview recolours when you change a colour/position. (Headless: confirm BUILD SUCCEEDED + no crash.)

- [ ] **Step 3: Commit**

```bash
git add ios/Sources/GradientEditor.swift
git commit -m "feat(ios): custom gradient editor (colour stops)"
```

---

## Task 3: Save / load named looks

**Files:** Modify `ios/Sources/LooksSection.swift` (replace the stub); modify `ios/project.yml`.

- [ ] **Step 1: Add the shared `CustomPresetStore` to the iOS target.** In `ios/project.yml`, under the target `sources`, add (next to the other shared `macos/.../*.swift` entries):
```yaml
      - path: ../macos/Sources/PerlinLiveWallpaper/CustomPresetStore.swift
```
(`CustomPresetStore` is Foundation-only and stores looks as JSON under Application Support — works on iOS as-is.)

- [ ] **Step 2: Implement `LooksSection`:**

```swift
import SwiftUI

/// Save the current look (params + mask) under a name, and load/delete saved
/// looks. Reuses the portable CustomPresetStore (Application Support JSON).
struct LooksSection: View {
    @ObservedObject var model: EditorModel
    @State private var name = ""
    @State private var looks: [CustomPreset] = CustomPresetStore.list()

    var body: some View {
        Section("Looks") {
            HStack {
                TextField("Name", text: $name)
                Button("Save") { save() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            ForEach(looks, id: \.id) { look in
                Button(look.name) { load(look) }
            }
            .onDelete { idx in idx.map { looks[$0] }.forEach { CustomPresetStore.delete(id: $0.id) }; refresh() }
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(model.preset),
              let json = String(data: data, encoding: .utf8) else { return }
        CustomPresetStore.save(name: name.trimmingCharacters(in: .whitespaces), paramsJSON: json,
                               maskImage: model.maskOn ? model.maskBase64 : nil,
                               maskInvert: model.maskInvert, maskFill: model.maskFill)
        name = ""; refresh()
    }
    private func load(_ look: CustomPreset) {
        if let p = try? JSONDecoder().decode(Preset.self, from: Data(look.paramsJSON.utf8)) { model.preset = p }
        if let img = look.maskImage {
            model.maskBase64 = img; model.maskImageData = Data(base64Encoded: img)
            model.maskInvert = look.maskInvert; model.maskFill = look.maskFill; model.maskOn = true
        } else {
            model.maskOn = false
        }
    }
    private func refresh() { looks = CustomPresetStore.list() }
}
```

- [ ] **Step 3: Build + smoke (sim).** Save a look (name + Save), confirm it appears in the list; tap it to load; swipe to delete. (Headless: BUILD SUCCEEDED + no crash; optionally drive a save via a throwaway, not committed.)

- [ ] **Step 4: Commit**

```bash
git add ios/Sources/LooksSection.swift ios/project.yml
git commit -m "feat(ios): save/load named looks (reuses CustomPresetStore)"
```

---

## Task 4: Review + device deploy + docs

- [ ] **Step 1: Adversarial review** of the full-parity diff: the keyPath binding helpers (optional defaults correct? ranges sane?), the gradient editor (stop add/remove/sort, Color↔[Int] round-trip, the `gradient?[i]` optional-subscript writes), the looks save/load (Preset Codable round-trip, mask restore), `ControlsView` size/responsibility, and that `EditorView` still builds with the moved sections. Fix confirmed issues.
- [ ] **Step 2: Build + sign + install on iPhone JK** (`1D819185-3910-5389-A9BE-C377B8010156`, team `U9X7M39R56`) — same commands as the prior plan's Task 9.
- [ ] **Step 3: On-device acceptance (user):** every parameter changes the preview; the gradient editor recolours; saving/loading looks works; export still produces a Live Photo. The real acceptance test.
- [ ] **Step 4: CHANGELOG** — extend the iOS app entry to mention full parameter control, the gradient editor, and saved looks. Commit.

---

## Self-review notes (author)

- **Spec coverage (§9 deferred):** full parameter parity (T1) ✓; custom gradient editor (T2) ✓; "Look speichern" (T3) ✓. Tile/loop correctly excluded (renderer can't).
- **Type consistency:** `ControlsView` keyPath helpers (`dbl`/`intB`/`boolB`) over `WritableKeyPath<Preset, …?>` rely on `Preset` fields being `var` (done in the prior plan T1); `GradientStop(pos:color:)` memberwise init used in T2 (it's a struct with `var pos/color`); `CustomPresetStore.save/list/delete` signatures used verbatim in T3; `Preset` is `Codable` (encode in T3 save, decode in T3 load).
- **Known flag:** `ControlsView` is large (~120 lines) but single-responsibility (the control panel); the gradient editor + mask + looks are separate files. The mode-specific defaults in the keyPath helpers should match the studio's defaults closely; exact values can be tuned on-device.
