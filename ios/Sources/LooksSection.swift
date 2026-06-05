import SwiftUI

/// Save the current look (params + mask) under a name, and load/delete saved
/// looks. Reuses the portable CustomPresetStore (Application Support JSON).
struct LooksSection: View {
    @ObservedObject var model: EditorModel
    @State private var name = ""
    @State private var looks: [CustomPreset] = CustomPresetStore.list()

    var body: some View {
        Section("Looks") {
            HStack {
                TextField("Name", text: $name)
                Button("Save") { save() }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            ForEach(looks, id: \.id) { look in
                Button(look.name) { load(look) }
            }
            .onDelete { idx in
                idx.map { looks[$0] }.forEach { CustomPresetStore.delete(id: $0.id) }
                refresh()
            }
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(model.preset),
              let json = String(data: data, encoding: .utf8) else { return }
        CustomPresetStore.save(name: name.trimmingCharacters(in: .whitespaces), paramsJSON: json,
                               maskImage: model.maskOn ? model.maskBase64 : nil,
                               maskInvert: model.maskInvert, maskFill: model.maskFill)
        name = ""; refresh()
    }
    private func load(_ look: CustomPreset) {
        if let p = try? JSONDecoder().decode(Preset.self, from: Data(look.paramsJSON.utf8)) { model.preset = p }
        if let img = look.maskImage {
            model.maskBase64 = img
            model.maskImageData = Data(base64Encoded: img)
            model.maskInvert = look.maskInvert; model.maskFill = look.maskFill; model.maskOn = true
        } else {
            model.maskOn = false
        }
    }
    private func refresh() { looks = CustomPresetStore.list() }
}
