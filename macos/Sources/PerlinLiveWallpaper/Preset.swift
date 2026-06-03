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

    // rgb / nebula (per-channel)
    let rgbMultiChannel: Bool?
    let rScale: Double?
    let gScale: Double?
    let bScale: Double?
    let rInvert: Bool?
    let gInvert: Bool?
    let bInvert: Bool?

    // flow field
    let flowHueShift: Double?
    let flowSat: Double?
    let flowGain: Double?
    let flowFloor: Double?
    let flowEps: Double?

    // layer 2
    let layer2On: Bool?
    let layer2ScaleX: Double?
    let layer2ScaleY: Double?
    let layer2Octaves: Int?
    let layer2Base: Int?
    let layer2BlendMode: String?
    let layer2Mix: Double?

    /// Title-cased display label for the menu.
    var label: String { name.prefix(1).uppercased() + name.dropFirst() }

    /// 0 gradient, 1 posterize, 2 hsv, 3 rgb, 4 flow. Unknown → gradient.
    var colorModeIndex: Int32 {
        switch colorMode {
        case "posterize": return 1
        case "hsv":       return 2
        case "rgb":       return 3
        case "flow":      return 4
        default:          return 0
        }
    }

    /// multiply 0, add 1, screen 2, darken 3, lighten 4, difference 5.
    var layer2BlendModeIndex: Int32 {
        switch layer2BlendMode {
        case "add":        return 1
        case "screen":     return 2
        case "darken":     return 3
        case "lighten":    return 4
        case "difference": return 5
        default:           return 0   // multiply
        }
    }
}
