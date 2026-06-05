import SwiftUI
import MetalKit
import QuartzCore

/// A SwiftUI live preview backed by an MTKView running the shared `Renderer`.
/// Unlike the macOS desktop window, a normal app view can use MTKView's own
/// render loop, so we let it drive frames (preferredFramesPerSecond) and advance
/// a monotonic noise clock in the delegate.
struct MetalPreviewView: UIViewRepresentable {
    @ObservedObject var model: EditorModel

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: context.coordinator.gpu?.device)
        view.colorPixelFormat = .bgra8Unorm
        view.framebufferOnly = true
        view.preferredFramesPerSecond = 30
        view.isPaused = false
        view.enableSetNeedsDisplay = false
        view.delegate = context.coordinator
        context.coordinator.rebuild(preset: model.preset)
        context.coordinator.applyMask(model)
        return view
    }

    func updateUIView(_ uiView: MTKView, context: Context) {
        // Re-apply current state every SwiftUI update (cheap; the renderer
        // diffs internally where it matters).
        context.coordinator.apply(preset: model.preset)
        context.coordinator.applyMask(model)
    }

    final class Coordinator: NSObject, MTKViewDelegate {
        let gpu = GPUContext(pixelFormat: .bgra8Unorm)
        private var renderer: Renderer?
        private var lastTimestamp: CFTimeInterval = 0
        private var noiseTime: Double = 0
        private var lastMaskKey: String = "∅"

        func rebuild(preset: Preset) {
            guard let gpu else { return }
            renderer = Renderer(gpu: gpu, preset: preset)
        }
        func apply(preset: Preset) {
            if renderer == nil { rebuild(preset: preset) } else { renderer?.update(preset: preset) }
        }
        func applyMask(_ model: EditorModel) {
            // Only call setMask when the mask config actually changed (rebuilding
            // the mask texture is not free).
            let key = "\(model.maskOn)|\(model.maskInvert)|\(model.maskFill)|\(model.maskBase64?.count ?? -1)"
            guard key != lastMaskKey else { return }
            lastMaskKey = key
            renderer?.setMask(base64Png: model.maskOn ? model.maskBase64 : nil,
                              invert: model.maskInvert, fill: model.maskFill)
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
            // Reset the clock on relayout/reappearance (rotation, iPad split,
            // returning from navigation) so noiseTime doesn't jump forward by the
            // off-screen gap. The resolution uniform is read per-frame from the
            // drawable, so nothing else needs to react to the size change.
            lastTimestamp = 0
        }
        func draw(in view: MTKView) {
            let now = CACurrentMediaTime()
            if lastTimestamp == 0 { lastTimestamp = now }
            noiseTime += now - lastTimestamp
            lastTimestamp = now
            renderer?.draw(in: view, time: noiseTime)
        }
    }
}
