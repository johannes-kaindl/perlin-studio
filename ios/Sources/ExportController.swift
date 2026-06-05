import SwiftUI
import UIKit

/// Runs a Live Photo export for the current EditorModel: builds the mask +
/// background (incl. scaling the source image to the frame for the
/// source-image background), renders off-main, and saves via PhotoKit.
@MainActor
final class ExportController: ObservableObject {
    @Published var busy = false
    @Published var status = ""

    func export(_ model: EditorModel) {
        busy = true; status = "Rendering…"
        let preset = model.preset
        let opts = LivePhotoExportOptions()
        let w = opts.width, h = opts.height
        let mask: LivePhotoExporter.Mask? = (model.maskOn && model.maskBase64 != nil)
            ? makeMask(model, width: w, height: h) : nil

        Task.detached(priority: .userInitiated) {
            let dir = FileManager.default.temporaryDirectory
            let still = dir.appendingPathComponent("perlin.heic")
            let video = dir.appendingPathComponent("perlin.mov")
            let id = LivePhotoExporter.exportPair(preset: preset, options: opts, stillURL: still, videoURL: video, mask: mask)
            let valid = id != nil && LivePhotoExporter.verifyPair(stillURL: still, videoURL: video)
            guard valid else { await self.finish("Generation failed."); return }
            PhotoLibraryDelivery.add(stillURL: still, videoURL: video) { result in
                Task { @MainActor in
                    switch result {
                    case .added: self.finish("Saved to Photos ✓ — find it in Photos.")
                    case .denied: self.finish("Photos access denied — enable it in Settings → Photos.")
                    case .failed(let m): self.finish("Saved file but Photos add failed: \(m)")
                    }
                }
            }
        }
    }

    private func finish(_ m: String) { busy = false; status = m }

    /// Builds the Mask, scaling the picked image to width×height (fill) as the
    /// BGRA background when the user chose the source-image background.
    private func makeMask(_ model: EditorModel, width: Int, height: Int) -> LivePhotoExporter.Mask {
        var m = LivePhotoExporter.Mask(base64: model.maskBase64!, invert: model.maskInvert, fill: model.maskFill)
        if case .sourceImage = model.background, let data = model.maskImageData, let img = UIImage(data: data) {
            m.backgroundBGRA = Self.bgraBuffer(of: img, width: width, height: height)
        }
        return m
    }

    /// Renders a UIImage into a width×height BGRA buffer (aspect-fill).
    private static func bgraBuffer(of img: UIImage, width: Int, height: Int) -> [UInt8]? {
        var buf = [UInt8](repeating: 0, count: width * height * 4)
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        guard let ctx = CGContext(data: &buf, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: width * 4, space: cs, bitmapInfo: info),
              let cg = img.cgImage else { return nil }
        // Aspect-fill the image into the frame.
        let iw = CGFloat(cg.width), ih = CGFloat(cg.height)
        let scale = max(CGFloat(width) / iw, CGFloat(height) / ih)
        let dw = iw * scale, dh = ih * scale
        ctx.draw(cg, in: CGRect(x: (CGFloat(width) - dw) / 2, y: (CGFloat(height) - dh) / 2, width: dw, height: dh))
        return buf
    }
}
