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
                Section("Colour") {
                    Picker("Mode", selection: $model.preset.colorMode) {
                        Text("Gradient").tag("gradient"); Text("Posterize").tag("posterize")
                        Text("HSV").tag("hsv"); Text("Flow").tag("flow"); Text("RGB").tag("rgb")
                    }.pickerStyle(.menu)
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
                MaskSection(model: model)
            }
        }
    }

    private var presetBinding: Binding<String> {
        Binding(get: { model.preset.name ?? "default" },
                set: { model.load(presetNamed: $0) })
    }

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

    @ViewBuilder
    private func labeledSlider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Slider(value: value, in: range)
        }
    }
}
