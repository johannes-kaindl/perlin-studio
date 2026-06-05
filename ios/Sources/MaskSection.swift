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
