import AppKit

/// Menu-bar controller: owns the preset store, the window manager and the power
/// monitor, and exposes them through an `NSStatusItem` menu.
///
/// Power policy (tied to the power *source*, not Low Power Mode):
///   - On AC  → animate at full rate (30 fps).
///   - On battery → paused by default; or, if "Animate on battery" is on, run at
///     a reduced 10 fps.
final class AppController: NSObject, NSApplicationDelegate {
    private var store: PresetStore!
    private var manager: WallpaperWindowManager?
    private var power: PowerMonitor!
    private var statusItem: NSStatusItem!
    private let editor = EditorWindowController()
    private var activeIndex = 0           // -1 = a custom (editor) look is active
    private var animateOnBattery = false

    private static let acFrameRate = 30.0
    private static let batteryFrameRate = 10.0

    func applicationDidFinishLaunching(_ notification: Notification) {
        store = PresetStore()

        // One shared device + compiled pipeline for the whole app.
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else {
            FileHandle.standardError.write(Data("No Metal device — wallpaper disabled\n".utf8))
            setupStatusItem()   // still give the user a way to quit
            return
        }
        // Restore the last-applied custom look, if any; else the first preset.
        let persisted = Persistence.load()
        if persisted != nil { activeIndex = -1 }
        manager = WallpaperWindowManager(preset: persisted ?? store.presets[0], gpu: gpu)

        editor.onParams = { [weak self] json in self?.applyEditorParams(json) }

        power = PowerMonitor()
        power.onChange = { [weak self] onBattery in self?.applyPowerPolicy(onBattery: onBattery) }
        power.start()

        setupStatusItem()
        applyPowerPolicy(onBattery: power.onBattery)
    }

    /// Live params from the embedded editor: apply to the wallpaper + persist.
    private func applyEditorParams(_ json: String) {
        guard let manager = manager,
              let preset = try? JSONDecoder().decode(Preset.self, from: Data(json.utf8)) else { return }
        manager.apply(preset: preset)
        Persistence.save(json: json)
        if activeIndex != -1 { activeIndex = -1; rebuildMenu() }   // clear built-in selection once
    }

    /// Apply the AC/battery policy to the (power) pause reason and the frame rate.
    private func applyPowerPolicy(onBattery: Bool) {
        guard let manager = manager else { return }
        if onBattery && !animateOnBattery {
            manager.setPaused(reason: "power", true)
        } else {
            manager.setFrameRate(onBattery ? AppController.batteryFrameRate : AppController.acFrameRate)
            manager.setPaused(reason: "power", false)
        }
        rebuildMenu()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "circle.hexagongrid.fill",
            accessibilityDescription: "Perlin Live Wallpaper")
        rebuildMenu()
    }

    private func rebuildMenu() {
        guard statusItem != nil else { return }
        let menu = NSMenu()
        let enabled = manager != nil

        let header = NSMenuItem(title: "Perlin Live Wallpaper", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        let edit = NSMenuItem(title: "Open Editor…", action: #selector(openEditor), keyEquivalent: "e")
        edit.target = self
        edit.isEnabled = enabled
        menu.addItem(edit)
        menu.addItem(.separator())

        if !enabled {
            let unavailable = NSMenuItem(title: "Metal unavailable", action: nil, keyEquivalent: "")
            unavailable.isEnabled = false
            menu.addItem(unavailable)
        }

        for (i, preset) in store.presets.enumerated() {
            let item = NSMenuItem(title: preset.label, action: #selector(selectPreset(_:)), keyEquivalent: "")
            item.target = self
            item.tag = i
            item.state = (i == activeIndex) ? .on : .off
            item.isEnabled = enabled
            menu.addItem(item)
        }
        menu.addItem(.separator())

        let pause = NSMenuItem(
            title: (manager?.isManuallyPaused ?? false) ? "Resume" : "Pause",
            action: #selector(togglePause), keyEquivalent: "")
        pause.target = self
        pause.isEnabled = enabled
        menu.addItem(pause)

        let onBattery = NSMenuItem(title: "Animate on battery (10 fps)", action: #selector(toggleAnimateOnBattery), keyEquivalent: "")
        onBattery.target = self
        onBattery.state = animateOnBattery ? .on : .off
        onBattery.isEnabled = enabled
        menu.addItem(onBattery)
        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        statusItem.menu = menu
    }

    @objc private func selectPreset(_ sender: NSMenuItem) {
        guard let manager = manager else { return }
        activeIndex = sender.tag
        manager.apply(preset: store.presets[activeIndex])
        rebuildMenu()
    }

    @objc private func togglePause() {
        guard let manager = manager else { return }
        manager.setPaused(reason: "manual", !manager.isManuallyPaused)
        rebuildMenu()
    }

    @objc private func toggleAnimateOnBattery() {
        animateOnBattery.toggle()
        applyPowerPolicy(onBattery: power?.onBattery ?? false)
    }

    @objc private func openEditor() { editor.show() }

    @objc private func quit() { NSApp.terminate(nil) }
}
