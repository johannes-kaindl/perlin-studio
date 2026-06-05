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
