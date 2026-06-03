import MetalKit
import QuartzCore

/// An `MTKView` that renders the live noise. We do **not** use MTKView's own
/// animation loop: its internal display link does not fire continuously for a
/// desktop-level, non-activating window (it draws one frame, then freezes —
/// the window's occlusion/visibility heuristic stops it). Instead the view runs
/// in on-demand mode (`isPaused = true`, manual `draw()`) and a run-loop timer
/// in `.common` mode drives frames, which fires reliably regardless of window
/// level or occlusion.
///
/// Pausing (battery-low-power / manual / teardown) simply stops the timer.
final class MetalNoiseView: MTKView, MTKViewDelegate {
    private var renderer: Renderer?
    private var lastTimestamp: CFTimeInterval = 0
    private var noiseTime: Double = 0
    private var pauseReasons: Set<String> = []
    private var frameTimer: Timer?
    private var frameRate: Double = 30.0

    init(gpu: GPUContext, preset: Preset) {
        super.init(frame: .zero, device: gpu.device)
        colorPixelFormat = .bgra8Unorm
        framebufferOnly = true
        isPaused = true               // we drive draws ourselves
        enableSetNeedsDisplay = false
        delegate = self
        renderer = Renderer(gpu: gpu, preset: preset)
        if renderer == nil {
            FileHandle.standardError.write(Data("Renderer init failed — view will stay blank\n".utf8))
        }
        updateRunning()
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("not used") }

    func apply(preset: Preset) { renderer?.update(preset: preset) }

    /// Change the target frame rate (e.g. 30 on AC, 10 on battery). Restarts the
    /// timer if it's currently running.
    func setFrameRate(_ fps: Double) {
        guard fps != frameRate, fps > 0 else { return }
        frameRate = fps
        if frameTimer != nil {
            frameTimer?.invalidate()
            frameTimer = nil
            updateRunning()
        }
    }

    /// Toggle one pause reason; frames run only when no reason is active.
    func setPaused(reason: String, _ active: Bool) {
        let wasRunning = pauseReasons.isEmpty
        if active { pauseReasons.insert(reason) } else { pauseReasons.remove(reason) }
        let isRunning = pauseReasons.isEmpty
        guard wasRunning != isRunning else { return }
        updateRunning()
        FileHandle.standardError.write(Data(
            "render: \(isRunning ? "RUNNING" : "PAUSED") reasons=\(pauseReasons.sorted())\n".utf8))
    }

    private func updateRunning() {
        let shouldRun = pauseReasons.isEmpty && renderer != nil
        if shouldRun {
            guard frameTimer == nil else { return }
            lastTimestamp = 0   // resume without a time jump
            let timer = Timer(timeInterval: 1.0 / frameRate, repeats: true) { [weak self] _ in
                self?.draw()    // MTKView.draw() forces a synchronous frame via the delegate
            }
            RunLoop.main.add(timer, forMode: .common)
            frameTimer = timer
        } else {
            frameTimer?.invalidate()
            frameTimer = nil
        }
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        let now = CACurrentMediaTime()
        if lastTimestamp == 0 { lastTimestamp = now }
        noiseTime += now - lastTimestamp
        lastTimestamp = now
        renderer?.draw(in: view, time: noiseTime)
    }

    deinit { frameTimer?.invalidate() }
}
