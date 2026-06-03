import AppKit

// Headless validation: compile the MSL, build the pipeline, render one
// offscreen frame. Used by CI / local smoke checks (`swift run … --selftest`).
if CommandLine.arguments.contains("--selftest") {
    exit(Renderer.selfTest() ? 0 : 1)
}

// `--render <preset> <out.png>`: render one preset to a PNG and exit.
if let i = CommandLine.arguments.firstIndex(of: "--render"), i + 2 < CommandLine.arguments.count {
    exit(RenderCLI.renderPresetToPNG(name: CommandLine.arguments[i + 1], path: CommandLine.arguments[i + 2]) ? 0 : 1)
}

// Accessory policy → menu-bar only, no Dock icon, no main window. The
// top-level `controller` binding keeps the (weakly-referenced) app delegate
// alive for the process lifetime.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = AppController()
app.delegate = controller
app.run()
