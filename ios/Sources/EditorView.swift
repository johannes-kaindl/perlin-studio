import SwiftUI

struct EditorView: View {
    @StateObject private var model = EditorModel()
    @StateObject private var exporter = ExportController()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                MetalPreviewView(model: model)
                    .aspectRatio(9.0/19.5, contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: 380)
                    .clipped()
                ControlsView(model: model)
                HStack {
                    Button("Live Photo") { exporter.export(model) }.buttonStyle(.borderedProminent)
                    Button("Video") { exporter.exportVideo(model) }.buttonStyle(.bordered)
                    Button("Image") { exporter.exportImage(model) }.buttonStyle(.bordered)
                }.disabled(exporter.busy).padding(.vertical, 8)
                if !exporter.status.isEmpty {
                    Text(exporter.status).font(.footnote).foregroundStyle(.secondary).padding(.bottom, 6)
                }
            }
            .navigationTitle("Perlin Live Photo")
            .navigationBarTitleDisplayMode(.inline)
        } // NavigationStack
    }
}
