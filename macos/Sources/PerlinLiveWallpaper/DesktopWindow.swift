import AppKit

/// A single borderless window pinned at desktop level (above the desktop
/// picture, below the icons), hosting one `MetalNoiseView`. This is the one
/// "workaround" in the app — a desktop-level window, not a system wallpaper API
/// (no such third-party API exists; see README) — but it uses only public
/// AppKit. Pauses its renderer when the window is fully occluded.
final class DesktopWindow {
    private let window: NSWindow
    private let noiseView: MetalNoiseView

    init(screen: NSScreen, preset: Preset, gpu: GPUContext) {
        noiseView = MetalNoiseView(gpu: gpu, preset: preset)
        window = NSWindow(contentRect: screen.frame, styleMask: .borderless,
                          backing: .buffered, defer: false, screen: screen)
        window.contentView = noiseView
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        window.ignoresMouseEvents = true
        window.isOpaque = true           // flipped to non-opaque only when a mask is set
        window.backgroundColor = .black
        window.hasShadow = false
        window.isReleasedWhenClosed = false
        window.orderFrontRegardless()
        // NB: occlusion-based pause was tried and removed — NSWindow.occlusionState
        // is unreliable for a desktop-level window (observed oscillating
        // visible/not-visible). Frames are driven by MetalNoiseView's own timer.
    }

    func apply(preset: Preset) { noiseView.apply(preset: preset) }
    func setPaused(reason: String, _ active: Bool) { noiseView.setPaused(reason: reason, active) }
    func setFrameRate(_ fps: Double) { noiseView.setFrameRate(fps) }
    func setMask(base64Png: String?, invert: Bool, fill: Bool) {
        let on = base64Png != nil
        window.isOpaque = !on
        window.backgroundColor = on ? .clear : .black
        noiseView.setMask(base64Png: base64Png, invert: invert, fill: fill)
    }

    func close() {
        noiseView.setPaused(reason: "closing", true)   // quiesce before teardown
        window.orderOut(nil)
    }
}
