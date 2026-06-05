import UIKit

extension UIImage {
    /// A copy with the EXIF orientation baked into the pixels (`.up`), so that
    /// `.cgImage` / `pngData()` are upright. Library photos carry an orientation
    /// flag that `.cgImage` ignores — which otherwise rotates the derived mask /
    /// background buffer 90°. Renders at scale 1 so points == pixels.
    func normalizedUp() -> UIImage {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: size)) }
    }
}
