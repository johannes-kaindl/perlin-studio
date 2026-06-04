import Foundation

/// User-tunable parameters for a Live Photo export. Defaults match the spec
/// (§6): iPhone-portrait, ~3 s, 30 fps, still at the clip midpoint.
struct LivePhotoExportOptions {
    var width: Int = 1290          // iPhone portrait default (e.g. 15/16 Pro)
    var height: Int = 2796
    var duration: Double = 3.0     // seconds
    var fps: Int = 30
    var stillFraction: Double = 0.5  // still frame position in [0,1)

    /// Total rendered frames (>= 1).
    var frameCount: Int { max(1, Int((duration * Double(fps)).rounded())) }
    /// Index of the still frame, clamped into the rendered range.
    var stillFrameIndex: Int { min(frameCount - 1, max(0, Int((Double(frameCount) * stillFraction).rounded(.down)))) }

    /// Built-in target presets offered in the sheet. The Watch crops to a
    /// square, so a square option is offered for the Photos-watch-face route.
    static let resolutionPresets: [(label: String, w: Int, h: Int)] = [
        ("iPhone portrait", 1290, 2796),
        ("iPad portrait", 2048, 2732),
        ("Square (Watch)", 1088, 1088),
    ]
}
