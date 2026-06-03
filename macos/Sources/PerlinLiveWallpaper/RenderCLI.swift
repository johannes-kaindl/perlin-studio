import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

/// Headless `--render <preset> <out.png>` support: renders one preset to a PNG.
/// Handy for visual-parity checks against the studio and for generating native
/// stills, without launching the menu-bar UI.
enum RenderCLI {
    static func renderPresetToPNG(name: String, path: String, width: Int = 1200, height: Int = 750, time: Double = 10.0) -> Bool {
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else {
            FileHandle.standardError.write(Data("render: no Metal device\n".utf8)); return false
        }
        let store = PresetStore()
        guard let preset = store.presets.first(where: { $0.name == name }) ?? store.presets.first else {
            FileHandle.standardError.write(Data("render: no presets\n".utf8)); return false
        }
        guard var bgra = Renderer.renderBGRA(gpu: gpu, preset: preset, width: width, height: height, time: time) else {
            FileHandle.standardError.write(Data("render: encode failed\n".utf8)); return false
        }
        // BGRA (Metal) -> RGBA (CGImage) by swapping the B and R bytes in place.
        var i = 0
        while i < bgra.count { bgra.swapAt(i, i + 2); i += 4 }
        let ok = writePNG(rgba: bgra, width: width, height: height, to: path)
        FileHandle.standardError.write(Data("render: \(preset.label) [\(preset.colorMode)] \(width)x\(height) -> \(path) ok=\(ok)\n".utf8))
        return ok
    }

    private static func writePNG(rgba: [UInt8], width: Int, height: Int, to path: String) -> Bool {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
        guard let provider = CGDataProvider(data: Data(rgba) as CFData),
              let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                               bytesPerRow: width * 4, space: colorSpace, bitmapInfo: bitmapInfo,
                               provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else {
            return false
        }
        let url = URL(fileURLWithPath: path) as CFURL
        guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else { return false }
        CGImageDestinationAddImage(dest, cg, nil)
        return CGImageDestinationFinalize(dest)
    }
}
