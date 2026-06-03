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
        window.isOpaque = true
        window.backgroundColor = .black
        window.hasShadow = false
        window.isReleasedWhenClosed = false
        window.orderFrontRegardless()

        NotificationCenter.default.addObserver(
            self, selector: #selector(occlusionChanged),
            name: NSWindow.didChangeOcclusionStateNotification, object: window)
        // Seed occlusion from the live state: a window born already covered may
        // never receive a "change" notification, so don't wait for one.
        occlusionChanged()
    }

    @objc private func occlusionChanged() {
        let visible = window.occlusionState.contains(.visible)
        noiseView.setPaused(reason: "occluded", !visible)
    }

    func apply(preset: Preset) { noiseView.apply(preset: preset) }
    func setPaused(reason: String, _ active: Bool) { noiseView.setPaused(reason: reason, active) }

    func close() {
        NotificationCenter.default.removeObserver(self)
        noiseView.setPaused(reason: "closing", true)   // quiesce before teardown
        window.orderOut(nil)
    }
}
