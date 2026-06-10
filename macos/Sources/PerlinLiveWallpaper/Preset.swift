import Foundation

/// One gradient colour stop, matching the studio's `{pos, color:[r,g,b]}`.
/// Equatable so UIs can recognise whether the active stops are still a named
/// gradient or already a custom edit.
struct GradientStop: Codable, Equatable {
    var pos: Double
    var color: [Int]   // [r, g, b] in 0...255
}

/// A resolved studio preset, decoded from the JSON produced by
/// `macos/scripts/export-presets.js`. Only the fields the v1 shader needs are
/// modelled; any extra keys in the JSON (layer2*, loop*, gradientName, …) are
/// ignored by the synthesized decoder.
struct Preset: Codable {
    var name: String?          // bundled presets carry one; live editor params don't
    var width: Int
    var height: Int
    var scaleX: Double
    var scaleY: Double
    var scaleT: Double
    var octaves: Int
    var persistence: Double
    var lacunarity: Double
    var base: Int
    var colorMode: String
    var gradient: [GradientStop]?
    var warpStrength: Double?
    var warpScale: Double?
    var posterizeSteps: Int?
    var hsvHueShift: Double?
    var hsvHueRange: Double?
    var hsvSat: Double?
    var hsvVal: Double?

    // rgb / nebula (per-channel)
    var rgbMultiChannel: Bool?
    var rScale: Double?
    var gScale: Double?
    var bScale: Double?
    var rInvert: Bool?
    var gInvert: Bool?
    var bInvert: Bool?

    // flow field
    var flowHueShift: Double?
    var flowSat: Double?
    var flowGain: Double?
    var flowFloor: Double?
    var flowEps: Double?

    // layer 2
    var layer2On: Bool?
    var layer2ScaleX: Double?
    var layer2ScaleY: Double?
    var layer2Octaves: Int?
    var layer2Base: Int?
    var layer2BlendMode: String?
    var layer2Mix: Double?

    /// Title-cased display label for the menu.
    var label: String {
        guard let name = name, !name.isEmpty else { return "Custom" }
        return name.prefix(1).uppercased() + name.dropFirst()
    }

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
