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
    private var currentParamsJSON: String?                     // the look currently applied
    private var currentMask: (image: String, invert: Bool)?   // its active image mask
    private var maskFillMode = false                           // false = fit (contain), true = fill (cover)
    private var activeCustomId: String?                        // the applied custom preset, if any

    /// The Preset decoded from the currently-applied JSON, used by the Live
    /// Photo exporter. Falls back to PresetStore.fallback if the JSON is absent
    /// (Metal unavailable path) or cannot be decoded.
    private var currentPreset: Preset {
        guard let json = currentParamsJSON,
              let preset = try? JSONDecoder().decode(Preset.self, from: Data(json.utf8))
        else { return PresetStore.fallback }
        return preset
    }

    private lazy var livePhotoController = LivePhotoExportController(presetProvider: { [weak self] in
        self?.currentPreset ?? PresetStore.fallback
    })

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
        let manager = WallpaperWindowManager(preset: persisted ?? store.presets[0], gpu: gpu)
        self.manager = manager
        // Only trust the raw string when it actually decoded, so the "save"
        // snapshot always matches the rendered look.
        currentParamsJSON = (persisted != nil ? Persistence.loadRaw() : nil) ?? encodeJSON(store.presets[0])
        // The image mask is intentionally NOT restored across launches: the
        // editor starts fresh without it, so a restored mask would "ghost" on the
        // wallpaper with no way to see/edit it. Masks live per-session and inside
        // saved custom presets. Clean up any mask file written by older builds.
        Persistence.clearLegacyMask()

        editor.onParams = { [weak self] json in self?.applyEditorParams(json) }
        editor.onMask = { [weak self] json in self?.applyMask(json) }

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
        currentParamsJSON = json
        // Editing diverges from any built-in/custom selection. Rebuild only on the
        // transition (not on every 250ms poll) to clear the checkmark.
        let needsRebuild = activeIndex != -1 || activeCustomId != nil
        activeIndex = -1
        activeCustomId = nil
        if needsRebuild { rebuildMenu() }
    }

    /// Image mask from the editor: `{image,invert}` to set, `{clear:true}` to clear.
    private func applyMask(_ json: String) {
        guard let manager = manager,
              let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { return }
        if obj["clear"] as? Bool == true {
            manager.setMask(base64Png: nil, invert: false, fill: maskFillMode)
            let had = currentMask != nil
            currentMask = nil
            if had { rebuildMenu() }   // drop the "Mask: Fill screen" item
        } else if let image = obj["image"] as? String {
            let invert = obj["invert"] as? Bool ?? false
            manager.setMask(base64Png: image, invert: invert, fill: maskFillMode)
            let isNew = currentMask == nil
            currentMask = (image, invert)
            if isNew { rebuildMenu() }   // show the "Mask: Fill screen" item
        }
    }

    private func encodeJSON(_ preset: Preset) -> String? {
        guard let data = try? JSONEncoder().encode(preset) else { return nil }
        return String(data: data, encoding: .utf8)
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

        if currentMask != nil {
            let fillItem = NSMenuItem(title: "Mask: Fill screen", action: #selector(toggleMaskFill), keyEquivalent: "")
            fillItem.target = self
            fillItem.state = maskFillMode ? .on : .off
            fillItem.isEnabled = enabled
            fillItem.toolTip = "On: cover the screen (crop). Off: fit the whole image (margins show your wallpaper)."
            menu.addItem(fillItem)
        }
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

        // Custom presets (saved looks). Hold Option to reveal a "Remove" action.
        let customs = CustomPresetStore.list()
        if !customs.isEmpty {
            let customHeader = NSMenuItem(title: "Custom", action: nil, keyEquivalent: "")
            customHeader.isEnabled = false
            menu.addItem(customHeader)
            for cp in customs {
                let item = NSMenuItem(title: cp.name, action: #selector(selectCustom(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = cp.id
                item.state = (activeIndex == -1 && activeCustomId == cp.id) ? .on : .off
                item.isEnabled = enabled
                menu.addItem(item)

                let remove = NSMenuItem(title: "Remove “\(cp.name)”", action: #selector(removeCustom(_:)), keyEquivalent: "")
                remove.target = self
                remove.representedObject = cp.id
                remove.isAlternate = true
                remove.keyEquivalentModifierMask = .option
                remove.isEnabled = enabled
                menu.addItem(remove)
            }
        }
        let saveItem = NSMenuItem(title: "Save Current as…", action: #selector(saveCurrentAs), keyEquivalent: "")
        saveItem.target = self
        saveItem.isEnabled = enabled && (currentParamsJSON != nil)
        menu.addItem(saveItem)

        // Export the current look as an Apple Live Photo pair for use as an
        // iPhone wallpaper (delivered via Photos, or saved to a folder as fallback).
        let exportLP = NSMenuItem(title: "Export Live Photo…", action: #selector(exportLivePhoto), keyEquivalent: "")
        exportLP.target = self
        exportLP.isEnabled = enabled && (currentParamsJSON != nil)
        menu.addItem(exportLP)
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
        activeCustomId = nil
        let preset = store.presets[activeIndex]
        manager.apply(preset: preset)
        currentParamsJSON = encodeJSON(preset)   // a built-in leaves any active mask untouched
        rebuildMenu()
    }

    // MARK: Custom presets

    @objc private func selectCustom(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String,
              let cp = CustomPresetStore.list().first(where: { $0.id == id }) else { return }
        applyCustom(cp)
    }

    private func applyCustom(_ cp: CustomPreset) {
        guard let manager = manager,
              let preset = try? JSONDecoder().decode(Preset.self, from: Data(cp.paramsJSON.utf8)) else { return }
        maskFillMode = cp.maskFill
        manager.apply(preset: preset)
        manager.setMask(base64Png: cp.maskImage, invert: cp.maskInvert, fill: cp.maskFill)   // complete look
        Persistence.save(json: cp.paramsJSON)
        currentParamsJSON = cp.paramsJSON
        currentMask = cp.maskImage.map { ($0, cp.maskInvert) }
        activeIndex = -1
        activeCustomId = cp.id
        rebuildMenu()
    }

    @objc private func removeCustom(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        CustomPresetStore.delete(id: id)
        if activeCustomId == id { activeCustomId = nil }
        rebuildMenu()
    }

    @objc private func saveCurrentAs() {
        guard let json = currentParamsJSON else { return }
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Save current look"
        alert.informativeText = "Name this preset:"
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.stringValue = "My Look"
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        let id = CustomPresetStore.save(name: name, paramsJSON: json,
                                        maskImage: currentMask?.image, maskInvert: currentMask?.invert ?? false,
                                        maskFill: maskFillMode)
        activeIndex = -1
        activeCustomId = id            // check the just-saved preset
        rebuildMenu()
    }

    @objc private func toggleMaskFill() {
        guard let manager = manager, let mask = currentMask else { return }
        maskFillMode.toggle()
        manager.setMask(base64Png: mask.image, invert: mask.invert, fill: maskFillMode)
        activeCustomId = nil           // the look diverged from any saved preset
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

    @objc private func exportLivePhoto() { livePhotoController.present() }

    @objc private func quit() { NSApp.terminate(nil) }
}
