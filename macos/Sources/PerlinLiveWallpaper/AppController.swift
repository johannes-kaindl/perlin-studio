import AppKit

/// Menu-bar controller: owns the preset store, the window manager and the power
/// monitor, and exposes them through an `NSStatusItem` menu.
final class AppController: NSObject, NSApplicationDelegate {
    private var store: PresetStore!
    private var manager: WallpaperWindowManager?
    private var power: PowerMonitor!
    private var statusItem: NSStatusItem!
    private var activeIndex = 0
    private var pauseOnBattery = true

    func applicationDidFinishLaunching(_ notification: Notification) {
        store = PresetStore()

        // One shared device + compiled pipeline for the whole app.
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else {
            FileHandle.standardError.write(Data("No Metal device — wallpaper disabled\n".utf8))
            setupStatusItem()   // still give the user a way to quit
            return
        }
        let manager = WallpaperWindowManager(preset: store.presets[activeIndex], gpu: gpu)
        self.manager = manager

        power = PowerMonitor()
        power.onChange = { [weak self] saving in
            guard let self = self, self.pauseOnBattery else { return }
            self.manager?.setPaused(reason: "battery", saving)
        }
        power.start()
        if pauseOnBattery && power.savingPower {
            manager.setPaused(reason: "battery", true)
        }

        setupStatusItem()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "circle.hexagongrid.fill",
            accessibilityDescription: "Perlin Live Wallpaper")
        rebuildMenu()
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        let enabled = manager != nil

        let header = NSMenuItem(title: "Perlin Live Wallpaper", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
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

        let battery = NSMenuItem(title: "Pause on battery", action: #selector(toggleBattery), keyEquivalent: "")
        battery.target = self
        battery.state = pauseOnBattery ? .on : .off
        battery.isEnabled = enabled
        menu.addItem(battery)
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

    @objc private func toggleBattery() {
        guard let manager = manager else { return }
        pauseOnBattery.toggle()
        manager.setPaused(reason: "battery", pauseOnBattery && power.savingPower)
        rebuildMenu()
    }

    @objc private func quit() { NSApp.terminate(nil) }
}
