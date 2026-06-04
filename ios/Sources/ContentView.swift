import SwiftUI

struct ContentView: View {
    @State private var status = "Pick a preset and generate a Live Photo."
    @State private var busy = false
    @State private var presetName = "aurora"
    private let presets = ["default","lava","aurora","clouds","terrain","circuit","marble","composite","nebula","flow"]

    var body: some View {
        VStack(spacing: 20) {
            Text("Perlin Live Photo").font(.title2).bold()
            Picker("Preset", selection: $presetName) {
                ForEach(presets, id: \.self) { Text($0.capitalized).tag($0) }
            }.pickerStyle(.menu).disabled(busy)
            Button(busy ? "Working…" : "Generate Live Photo") { generate() }
                .disabled(busy).buttonStyle(.borderedProminent)
            Text(status).font(.footnote).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true).padding(.horizontal)
        }
        .padding()
        .onAppear {
            // Headless verification hook: auto-run once if launched with the env flag.
            if ProcessInfo.processInfo.environment["PERLIN_AUTORUN"] == "1" { generate() }
        }
    }

    private func generate() {
        busy = true
        status = "Rendering…"
        let name = presetName
        DispatchQueue.global(qos: .userInitiated).async {
            let store = PresetStore()
            let preset = store.presets.first(where: { $0.name == name }) ?? store.presets.first ?? PresetStore.fallback
            let opts = LivePhotoExportOptions()
            let dir = FileManager.default.temporaryDirectory
            let still = dir.appendingPathComponent("perlin-livephoto.heic")
            let video = dir.appendingPathComponent("perlin-livephoto.mov")
            let id = LivePhotoExporter.exportPair(preset: preset, options: opts, stillURL: still, videoURL: video)
            let valid = id != nil && LivePhotoExporter.verifyPair(stillURL: still, videoURL: video)
            print("PERLIN_EXPORT id=\(id ?? "nil") valid=\(valid)")
            guard valid else {
                DispatchQueue.main.async { status = "Generation failed."; busy = false }
                return
            }
            PhotoLibraryDelivery.add(stillURL: still, videoURL: video) { result in
                DispatchQueue.main.async {
                    busy = false
                    switch result {
                    case .added:
                        status = "Saved to Photos ✓\nSet it: Settings → Wallpaper → Add New Wallpaper → Photos → \"Live Photo\" filter → pick it → Set as Wallpaper Pair (keep the play toggle ON)."
                        print("PERLIN_SAVE result=added")
                    case .denied:
                        status = "Photos access denied. Enable it in Settings → Privacy → Photos, then retry."
                        print("PERLIN_SAVE result=denied")
                    case .failed(let m):
                        status = "Saved a file but adding to Photos failed: \(m)"
                        print("PERLIN_SAVE result=failed \(m)")
                    }
                }
            }
        }
    }
}
