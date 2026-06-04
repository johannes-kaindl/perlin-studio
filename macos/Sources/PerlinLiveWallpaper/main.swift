import AppKit

// Headless validation: compile the MSL, build the pipeline, render one
// offscreen frame. Used by CI / local smoke checks (`swift run … --selftest`).
if CommandLine.arguments.contains("--selftest") {
    let ok = Renderer.selfTest() && LivePhotoExporter.selfTest()
    exit(ok ? 0 : 1)
}

// `--render <preset> <out.png>`: render one preset to a PNG and exit.
if let i = CommandLine.arguments.firstIndex(of: "--render"), i + 2 < CommandLine.arguments.count {
    exit(RenderCLI.renderPresetToPNG(name: CommandLine.arguments[i + 1], path: CommandLine.arguments[i + 2]) ? 0 : 1)
}

// `--export-livephoto <preset> <out-basename>`: write <basename>.heic + <basename>.mov and exit.
if let i = CommandLine.arguments.firstIndex(of: "--export-livephoto"), i + 2 < CommandLine.arguments.count {
    let base = CommandLine.arguments[i + 2]
    let store = PresetStore()
    guard let preset = store.presets.first(where: { $0.name == CommandLine.arguments[i + 1] }) ?? store.presets.first else {
        FileHandle.standardError.write(Data("export: no presets\n".utf8)); exit(1)
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
