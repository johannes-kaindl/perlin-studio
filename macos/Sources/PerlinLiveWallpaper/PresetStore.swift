import Foundation

/// Loads the bundled preset JSONs in a fixed order. Falls back to a single
/// built-in preset if the resources are missing, so the app never starts empty.
final class PresetStore {
    let presets: [Preset]

    // Fixed display order; also guarantees presence (a missing file is skipped).
    private static let order = ["default", "lava", "aurora", "clouds", "terrain", "circuit", "marble", "composite"]

    init() {
        let decoder = JSONDecoder()
        var loaded: [Preset] = []
        for name in PresetStore.order {
            guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "presets"),
                  let data = try? Data(contentsOf: url) else { continue }
            do {
                loaded.append(try decoder.decode(Preset.self, from: data))
            } catch {
                FileHandle.standardError.write(Data("preset decode failed for \(name): \(error)\n".utf8))
            }
        }
        presets = loaded.isEmpty ? [PresetStore.fallback] : loaded
    }

    static let fallback = Preset(
        name: "default", width: 256, height: 256,
        scaleX: 0.011, scaleY: 0.011, scaleT: 0.15,
        octaves: 5, persistence: 0.62, lacunarity: 2.1, base: 0,
        colorMode: "gradient",
        gradient: [
            GradientStop(pos: 0.0, color: [68, 1, 84]),
            GradientStop(pos: 0.5, color: [33, 145, 140]),
            GradientStop(pos: 1.0, color: [253, 231, 37]),
        ],
        warpStrength: 0, warpScale: 1, posterizeSteps: nil,
        hsvHueShift: nil, hsvHueRange: nil, hsvSat: nil, hsvVal: nil
    )
}
