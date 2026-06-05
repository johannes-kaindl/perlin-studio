import AppKit

// Headless validation: compile the MSL, build the pipeline, render one
// offscreen frame. Used by CI / local smoke checks (`swift run … --selftest`).
if CommandLine.arguments.contains("--selftest") {
    let ok = Renderer.selfTest() && LivePhotoExporter.selfTest()
    exit(ok ? 0 : 1)
}

// `--render <preset> <out.png> [width] [height] [time]`: render a preset to a PNG and exit.
// Optional width/height (default 1200×750) allow square renders, e.g. for the app icon.
if let i = CommandLine.arguments.firstIndex(of: "--render"), i + 2 < CommandLine.arguments.count {
    let a = CommandLine.arguments
    let w = (i + 3 < a.count) ? (Int(a[i + 3]) ?? 1200) : 1200
    let h = (i + 4 < a.count) ? (Int(a[i + 4]) ?? 750) : 750
    let t = (i + 5 < a.count) ? (Double(a[i + 5]) ?? 10.0) : 10.0
    exit(RenderCLI.renderPresetToPNG(name: a[i + 1], path: a[i + 2], width: w, height: h, time: t) ? 0 : 1)
}

// `--export-livephoto <preset> <out-basename>`: write <basename>.heic + <basename>.mov and exit.
if let i = CommandLine.arguments.firstIndex(of: "--export-livephoto"), i + 2 < CommandLine.arguments.count {
    let base = CommandLine.arguments[i + 2]
    let store = PresetStore()
    guard let preset = store.presets.first(where: { $0.name == CommandLine.arguments[i + 1] }) ?? store.presets.first else {
        FileHandle.standardError.write(Data("export: no presets\n".utf8)); exit(1)
    }
    // Warn when the requested name didn't match any preset so the fallback is visible.
    if store.presets.first(where: { $0.name == CommandLine.arguments[i + 1] }) == nil {
        FileHandle.standardError.write(Data("export: preset \"\(CommandLine.arguments[i + 1])\" not found, using \"\(preset.label)\"\n".utf8))
    }
    let still = URL(fileURLWithPath: base + ".heic")
    let video = URL(fileURLWithPath: base + ".mov")
    let id = LivePhotoExporter.exportPair(preset: preset, options: LivePhotoExportOptions(), stillURL: still, videoURL: video)
    let ok = id != nil && LivePhotoExporter.verifyPair(stillURL: still, videoURL: video)
    FileHandle.standardError.write(Data("export: \(preset.label) -> \(base).{heic,mov} id=\(id ?? "nil") ok=\(ok)\n".utf8))
    exit(ok ? 0 : 1)
}

// Accessory policy → menu-bar only, no Dock icon, no main window. The
// top-level `controller` binding keeps the (weakly-referenced) app delegate
// alive for the process lifetime.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = AppController()
app.delegate = controller
app.run()
