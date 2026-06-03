import Foundation

/// A user-saved look: the resolved params plus an optional image mask.
/// `id` is the stable on-disk filename — the display `name` is for the menu only,
/// so two looks may share a name and punctuation never collides on disk.
struct CustomPreset {
    let id: String                // "<uuid>.json"
    let name: String
    let paramsJSON: String        // raw resolved-params JSON (decodes into Preset)
    let maskImage: String?        // PNG data URL, or nil
    let maskInvert: Bool
}

/// Named custom presets stored as UUID-named JSON files under Application Support.
/// Each file: { name, params: {…}, mask: {image, invert} | null }.
enum CustomPresetStore {
    private static var dir: URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let d = base.appendingPathComponent("PerlinLiveWallpaper/presets", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static func list() -> [CustomPreset] {
        guard let dir = dir,
              let urls = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return [] }
        var out: [CustomPreset] = []
        for url in urls where url.pathExtension == "json" {
            guard let data = try? Data(contentsOf: url),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let params = obj["params"],
                  let paramsData = try? JSONSerialization.data(withJSONObject: params),
                  let paramsJSON = String(data: paramsData, encoding: .utf8) else { continue }
            let name = (obj["name"] as? String) ?? url.deletingPathExtension().lastPathComponent
            let mask = obj["mask"] as? [String: Any]
            out.append(CustomPreset(id: url.lastPathComponent, name: name, paramsJSON: paramsJSON,
                                    maskImage: mask?["image"] as? String, maskInvert: (mask?["invert"] as? Bool) ?? false))
        }
        return out.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Save, overwriting any existing preset with the same display name (else a new
    /// UUID file). Returns the file id of the saved preset.
    @discardableResult
    static func save(name: String, paramsJSON: String, maskImage: String?, maskInvert: Bool) -> String? {
        guard let dir = dir,
              let paramsObj = try? JSONSerialization.jsonObject(with: Data(paramsJSON.utf8)) else { return nil }
        let id = list().first(where: { $0.name == name })?.id ?? (UUID().uuidString + ".json")
        var dict: [String: Any] = ["name": name, "params": paramsObj]
        if let img = maskImage { dict["mask"] = ["image": img, "invert": maskInvert] }
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
        try? data.write(to: dir.appendingPathComponent(id))
        return id
    }

    static func delete(id: String) {
        guard let dir = dir, id.hasSuffix(".json"), !id.contains("/") else { return }
        try? FileManager.default.removeItem(at: dir.appendingPathComponent(id))
    }
}
