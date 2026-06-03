import AppKit

/// Keeps one `DesktopWindow` per screen and rebuilds them when the display
/// arrangement changes. Fans the active preset and pause reasons out to every
/// window. Pause reasons set here (battery / manual) are global; occlusion is
/// handled per-window.
final class WallpaperWindowManager {
    private let gpu: GPUContext
    private var windows: [DesktopWindow] = []
    private var preset: Preset
    private var globalPauseReasons: Set<String> = []
    private var frameRate: Double = 30
    private var maskPng: String?
    private var maskInvert = false
    private var pendingRebuild: DispatchWorkItem?

    init(preset: Preset, gpu: GPUContext) {
        self.preset = preset
        self.gpu = gpu
        rebuild()
        NotificationCenter.default.addObserver(
            self, selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        pendingRebuild?.cancel()
    }

    // didChangeScreenParameters fires in bursts (sleep/wake, resolution, hot-plug).
    // Coalesce them into a single rebuild so we don't thrash windows.
    @objc private func screensChanged() {
        pendingRebuild?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.rebuild() }
        pendingRebuild = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    private func rebuild() {
        pendingRebuild = nil
        windows.forEach { $0.close() }
        windows = NSScreen.screens.map { screen in
            let w = DesktopWindow(screen: screen, preset: preset, gpu: gpu)
            w.setFrameRate(frameRate)
            if maskPng != nil { w.setMask(base64Png: maskPng, invert: maskInvert) }
            for reason in globalPauseReasons { w.setPaused(reason: reason, true) }
            return w
        }
    }

    func apply(preset: Preset) {
        self.preset = preset
        windows.forEach { $0.apply(preset: preset) }
    }

    func setPaused(reason: String, _ active: Bool) {
        if active { globalPauseReasons.insert(reason) } else { globalPauseReasons.remove(reason) }
        windows.forEach { $0.setPaused(reason: reason, active) }
    }

    func setFrameRate(_ fps: Double) {
        frameRate = fps
        windows.forEach { $0.setFrameRate(fps) }
    }

    func setMask(base64Png: String?, invert: Bool) {
        maskPng = base64Png
        maskInvert = invert
        windows.forEach { $0.setMask(base64Png: base64Png, invert: invert) }
    }

    var isManuallyPaused: Bool { globalPauseReasons.contains("manual") }
}
