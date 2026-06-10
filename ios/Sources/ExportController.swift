import SwiftUI
import UIKit

/// Runs Live Photo / video / PNG exports for the current EditorModel: builds the
/// mask + background (incl. scaling the source image to the frame for the
/// source-image background), renders off-main, and saves via PhotoKit.
@MainActor
final class ExportController: ObservableObject {
    @Published var busy = false
    @Published var status = ""

    func export(_ model: EditorModel) {
        busy = true; status = "Rendering…"
        let preset = model.preset
        let opts = model.export
        let mask = currentMask(model, width: opts.width, height: opts.height)

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

    func exportImage(_ model: EditorModel) {
        busy = true; status = "Rendering image…"
        let preset = model.preset, opts = model.export
        let mask = currentMask(model, width: opts.width, height: opts.height)
        Task.detached(priority: .userInitiated) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("perlin.png")
            guard LivePhotoExporter.exportStillImage(preset: preset, options: opts, mask: mask, pngURL: url) else {
                await self.finish("Image render failed."); return
            }
            PhotoLibraryDelivery.addImage(url: url) { r in Task { @MainActor in self.report(r, "Image saved to Photos ✓") } }
        }
    }

    func exportVideo(_ model: EditorModel) {
        busy = true; status = "Rendering video…"
        let preset = model.preset, opts = model.export
        let mask = currentMask(model, width: opts.width, height: opts.height)
        Task.detached(priority: .userInitiated) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("perlin-video.mov")
            guard LivePhotoExporter.writeVideo(preset: preset, options: opts, identifier: UUID().uuidString, videoURL: url, mask: mask) else {
                await self.finish("Video render failed."); return
            }
            PhotoLibraryDelivery.addVideo(url: url) { r in Task { @MainActor in self.report(r, "Video saved to Photos ✓") } }
        }
    }

    private func report(_ r: PhotoLibraryDelivery.Result, _ ok: String) {
        switch r {
        case .added: finish(ok)
        case .denied: finish("Photos access denied — enable it in Settings → Photos.")
        case .failed(let m): finish("Saved file but Photos add failed: \(m)")
        }
    }

    private func finish(_ m: String) { busy = false; status = m }

    /// The export Mask for the current model, or nil when masking is off.
    private func currentMask(_ model: EditorModel, width: Int, height: Int) -> LivePhotoExporter.Mask? {
        (model.maskOn && model.maskBase64 != nil) ? makeMask(model, width: width, height: height) : nil
    }

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
        guard let cg = img.normalizedUp().cgImage else { return nil }
        var buf = [UInt8](repeating: 0, count: width * height * 4)
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        // The whole draw runs inside withUnsafeMutableBytes: an `&buf` pointer
        // is only guaranteed valid for the CGContext *initializer* call itself,
        // and the optimizer may even pass a temporary copy — the later draw
        // would then silently hit dead memory.
        let drawn = buf.withUnsafeMutableBytes { raw -> Bool in
            guard let ctx = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: width * 4, space: cs, bitmapInfo: info) else { return false }
            // CGContext is bottom-left origin; flip so row 0 = top, matching the
            // top-first noise frame the composite blends against.
            ctx.translateBy(x: 0, y: CGFloat(height)); ctx.scaleBy(x: 1, y: -1)
            // Aspect-fill the image into the frame.
            let iw = CGFloat(cg.width), ih = CGFloat(cg.height)
            let scale = max(CGFloat(width) / iw, CGFloat(height) / ih)
            let dw = iw * scale, dh = ih * scale
            ctx.draw(cg, in: CGRect(x: (CGFloat(width) - dw) / 2, y: (CGFloat(height) - dh) / 2, width: dw, height: dh))
            return true
        }
        return drawn ? buf : nil
    }
}
