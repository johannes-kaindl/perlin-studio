import MetalKit
import QuartzCore

/// An `MTKView` that renders the live noise. Owns its `Renderer`, advances a
/// monotonic noise clock, caps the frame rate, and pauses on a set of named
/// reasons (occlusion / battery / manual) so several conditions can hold it
/// paused independently.
final class MetalNoiseView: MTKView, MTKViewDelegate {
    private var renderer: Renderer?
    private var lastTimestamp: CFTimeInterval = 0
    private var noiseTime: Double = 0
    private var pauseReasons: Set<String> = []

    private static let fpsCap = 30

    init(gpu: GPUContext, preset: Preset) {
        super.init(frame: .zero, device: gpu.device)
        colorPixelFormat = .bgra8Unorm
        framebufferOnly = true
        preferredFramesPerSecond = MetalNoiseView.fpsCap
        enableSetNeedsDisplay = false
        isPaused = false
        renderer = Renderer(gpu: gpu, preset: preset)
        if renderer == nil {
            // Nothing to draw — don't spin the display link doing no-op frames.
            FileHandle.standardError.write(Data("Renderer init failed — pausing view\n".utf8))
            setPaused(reason: "no-renderer", true)
        }
        delegate = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("not used") }

    func apply(preset: Preset) { renderer?.update(preset: preset) }

    /// Toggle one pause reason; the view runs only when no reason is active.
    func setPaused(reason: String, _ active: Bool) {
        if active { pauseReasons.insert(reason) } else { pauseReasons.remove(reason) }
        let shouldPause = !pauseReasons.isEmpty
        guard shouldPause != isPaused else { return }
        isPaused = shouldPause
        if !shouldPause { lastTimestamp = 0 }  // resume without a time jump
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        let now = CACurrentMediaTime()
        if lastTimestamp == 0 { lastTimestamp = now }
        noiseTime += now - lastTimestamp
        lastTimestamp = now
        renderer?.draw(in: view, time: noiseTime)
    }
}
