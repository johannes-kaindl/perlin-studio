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
