import AppKit

/// Presents a small window to configure and run a Live Photo export for the
/// app's currently-applied preset, then delivers the result. Off-main-thread
/// export keeps the UI responsive; all UI mutation hops back to main.
final class LivePhotoExportController: NSObject {
    private var window: NSWindow?
    private let presetProvider: () -> Preset

    /// `presetProvider` returns the look to export (the app's current preset).
    init(presetProvider: @escaping () -> Preset) { self.presetProvider = presetProvider }

    func present() {
        // If the window is already open, just bring it forward instead of
        // spawning a second one and orphaning any in-progress export.
        if let win = window, win.isVisible {
            NSApp.activate(ignoringOtherApps: true)
            win.makeKeyAndOrderFront(nil)
            return
        }
        let vc = LivePhotoExportViewController(preset: presetProvider())
        let win = NSWindow(contentViewController: vc)
        win.title = "Export Live Photo"
        win.styleMask = [.titled, .closable]
        win.isReleasedWhenClosed = false
        win.center()
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
        self.window = win
    }
}

private final class LivePhotoExportViewController: NSViewController {
    private let preset: Preset
    private let resolutionPopUp = NSPopUpButton()
    private let durationField = NSTextField(string: "3.0")
    private let fpsField = NSTextField(string: "30")
    private let status = NSTextField(labelWithString: "")
    private let exportButton = NSButton(title: "Export", target: nil, action: nil)

    init(preset: Preset) { self.preset = preset; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func loadView() {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)

        LivePhotoExportOptions.resolutionPresets.forEach { resolutionPopUp.addItem(withTitle: $0.label) }
        // NSStackView ignores `frame.size.width` on arranged subviews; use
        // Auto Layout constraints so the widths are actually honoured.
        durationField.widthAnchor.constraint(equalToConstant: 60).isActive = true
        fpsField.widthAnchor.constraint(equalToConstant: 60).isActive = true
        exportButton.target = self
        exportButton.action = #selector(runExport)
        exportButton.keyEquivalent = "\r"

        stack.addArrangedSubview(NSTextField(labelWithString: "Resolution"))
        stack.addArrangedSubview(resolutionPopUp)
        stack.addArrangedSubview(NSTextField(labelWithString: "Duration (s) / fps"))
        let row = NSStackView(views: [durationField, fpsField]); row.spacing = 8
        stack.addArrangedSubview(row)
        stack.addArrangedSubview(exportButton)
        stack.addArrangedSubview(status)
        stack.setFrameSize(NSSize(width: 320, height: 240))
        self.view = stack
    }

    private func currentOptions() -> LivePhotoExportOptions {
        var o = LivePhotoExportOptions()
        let p = LivePhotoExportOptions.resolutionPresets[max(0, resolutionPopUp.indexOfSelectedItem)]
        o.width = p.w; o.height = p.h
        o.duration = Double(durationField.stringValue) ?? 3.0
        o.fps = Int(fpsField.stringValue) ?? 30
        return o
    }

    @objc private func runExport() {
        exportButton.isEnabled = false
        status.stringValue = "Rendering…"
        let opts = currentOptions()
        let preset = self.preset
        let tmp = FileManager.default.temporaryDirectory
        let still = tmp.appendingPathComponent("perlin-livephoto.heic")
        let video = tmp.appendingPathComponent("perlin-livephoto.mov")

        DispatchQueue.global(qos: .userInitiated).async {
            let id = LivePhotoExporter.exportPair(preset: preset, options: opts, stillURL: still, videoURL: video)
            guard id != nil else { self.finish("Export failed.") ; return }
            PhotoLibraryDelivery.add(stillURL: still, videoURL: video) { result in
                switch result {
                case .added:
                    self.finish("Saved to Photos. On your iPhone: Settings → Wallpaper → Add New Wallpaper → Photos → \"Live Photo\" filter → pick it → Add → Set as Wallpaper Pair. Keep the Live-Photo play toggle ON.")
                case .denied:
                    self.exportToFolderFallback(still: still, video: video)
                case .failed(let msg):
                    self.finish("Saved files, but adding to Photos failed: \(msg)")
                }
            }
        }
    }

    private func exportToFolderFallback(still: URL, video: URL) {
        DispatchQueue.main.async {
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.prompt = "Export Here"
            panel.message = "Photos access denied — choose a folder to save the pair, then AirDrop it to your iPhone."
            guard panel.runModal() == .OK, let dir = panel.url else { self.finish("Cancelled."); return }
            do {
                let stillDst = dir.appendingPathComponent("perlin-livephoto.heic")
                let videoDst = dir.appendingPathComponent("perlin-livephoto.mov")
                // Remove any prior export so re-export to the same folder never
                // throws "file already exists".
                try? FileManager.default.removeItem(at: stillDst)
                try? FileManager.default.removeItem(at: videoDst)
                try FileManager.default.copyItem(at: still, to: stillDst)
                try FileManager.default.copyItem(at: video, to: videoDst)
                self.finish("Exported the pair to \(dir.lastPathComponent). AirDrop both files to your iPhone, then set the Live Photo as your wallpaper.")
            } catch { self.finish("Folder export failed: \(error.localizedDescription)") }
        }
    }

    private func finish(_ message: String) {
        DispatchQueue.main.async {
            self.status.stringValue = message
            self.exportButton.isEnabled = true
        }
    }
}
