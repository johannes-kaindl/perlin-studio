import SwiftUI

/// The editor's full control panel. Every row binds to a `Preset` field on the
/// shared model; colour-mode-specific sections appear for the active mode.
struct ControlsView: View {
    @ObservedObject var model: EditorModel
    private let presetNames = ["default","lava","aurora","clouds","terrain","circuit","marble","composite","nebula","flow"]
    @State private var gradientName = "fire"

    var body: some View {
        Form {
            presetSection
            colourSection
            shapeSection
            warpSection
            layer2Section
            Section("Motion") { slider("Speed", $model.preset.scaleT, 0.0...0.6) }
            exportSection
            MaskSection(model: model)
            LooksSection(model: model)
        }
    }

    // MARK: – Section helpers (split to avoid Swift type-checker timeout on a single large body)

    private var presetSection: some View {
        Section("Preset") {
            Picker("Preset", selection: presetBinding) {
                ForEach(presetNames, id: \.self) { Text($0.capitalized).tag($0) }
            }
        }
    }

    private var colourSection: some View {
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
                slider("Steps", intB(\.posterizeSteps, 5).double, 2...16)
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
                slider("Gain", dbl(\.flowGain, 4), 0.1...20)
                slider("Floor", dbl(\.flowFloor, 0.05), 0...0.6)
                slider("Eps", dbl(\.flowEps, 0.6), 0.1...3)
            }
            if model.preset.colorMode == "rgb" {
                Toggle("Per-channel", isOn: boolB(\.rgbMultiChannel, false))
                slider("R scale", dbl(\.rScale, 0), 0...2)
                slider("G scale", dbl(\.gScale, 1), 0...2)
                slider("B scale", dbl(\.bScale, 0), 0...2)
                Toggle("Invert R", isOn: boolB(\.rInvert, false))
                Toggle("Invert G", isOn: boolB(\.gInvert, false))
                Toggle("Invert B", isOn: boolB(\.bInvert, false))
            }
        }
    }

    private var shapeSection: some View {
        Section("Shape") {
            slider("Zoom", zoomBinding, 0.003...0.05)
            slider("Detail (octaves)", octavesBinding, 1...8)
            slider("Persistence", $model.preset.persistence, 0.1...0.9)
            slider("Lacunarity", $model.preset.lacunarity, 1.5...3.0)
            Stepper("Seed: \(model.preset.base)", value: $model.preset.base, in: 0...255)
        }
    }

    private var warpSection: some View {
        Section("Warp") {
            slider("Strength", dbl(\.warpStrength, 0), 0...3)
            slider("Scale", dbl(\.warpScale, 1), 0.2...3)
        }
    }

    private var layer2Section: some View {
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
    }

    private var exportSection: some View {
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
    }

    // MARK: – Bindings

    private var presetBinding: Binding<String> {
        Binding(get: { model.preset.name ?? "default" }, set: { model.load(presetNamed: $0) })
    }
    private var gradientBinding: Binding<String> {
        Binding(get: { gradientName },
                set: { gradientName = $0; if $0 != "custom" { model.preset.gradient = Gradients.stops(named: $0) } })
    }
    // One "zoom" master drives both scale axes equally.
    private var zoomBinding: Binding<Double> {
        Binding(get: { model.preset.scaleX }, set: { model.preset.scaleX = $0; model.preset.scaleY = $0 })
    }
    private var octavesBinding: Binding<Double> {
        Binding(get: { Double(model.preset.octaves) }, set: { model.preset.octaves = Int($0.rounded()) })
    }
    private var blendBinding: Binding<String> {
        Binding(get: { model.preset.layer2BlendMode ?? "multiply" }, set: { model.preset.layer2BlendMode = $0 })
    }
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

    // MARK: – KeyPath binding helpers for optional fields

    private func dbl(_ kp: WritableKeyPath<Preset, Double?>, _ def: Double) -> Binding<Double> {
        Binding(get: { model.preset[keyPath: kp] ?? def }, set: { model.preset[keyPath: kp] = $0 })
    }
    private func intB(_ kp: WritableKeyPath<Preset, Int?>, _ def: Int) -> Binding<Int> {
        Binding(get: { model.preset[keyPath: kp] ?? def }, set: { model.preset[keyPath: kp] = $0 })
    }
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
    var double: Binding<Double> {
        Binding<Double>(get: { Double(wrappedValue) }, set: { (v: Double) in wrappedValue = Int(v.rounded()) })
    }
}
