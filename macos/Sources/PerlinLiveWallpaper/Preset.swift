import Foundation

/// One gradient colour stop, matching the studio's `{pos, color:[r,g,b]}`.
struct GradientStop: Codable {
    let pos: Double
    let color: [Int]   // [r, g, b] in 0...255
}

/// A resolved studio preset, decoded from the JSON produced by
/// `macos/scripts/export-presets.js`. Only the fields the v1 shader needs are
/// modelled; any extra keys in the JSON (layer2*, loop*, gradientName, …) are
/// ignored by the synthesized decoder.
struct Preset: Codable {
    let name: String
    let width: Int
    let height: Int
    let scaleX: Double
    let scaleY: Double
    let scaleT: Double
    let octaves: Int
    let persistence: Double
    let lacunarity: Double
    let base: Int
    let colorMode: String
    let gradient: [GradientStop]?
    let warpStrength: Double?
    let warpScale: Double?
    let posterizeSteps: Int?
    let hsvHueShift: Double?
    let hsvHueRange: Double?
    let hsvSat: Double?
    let hsvVal: Double?

    /// Title-cased display label for the menu.
    var label: String { name.prefix(1).uppercased() + name.dropFirst() }

    /// 0 = gradient, 1 = posterize, 2 = hsv. Unknown modes fall back to gradient.
    var colorModeIndex: Int32 {
        switch colorMode {
        case "posterize": return 1
        case "hsv":       return 2
        default:          return 0
        }
    }
}
