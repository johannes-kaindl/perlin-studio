import Foundation

/// Persists the last-applied look (the resolved-preset JSON from the editor) and
/// the active image mask under Application Support, and restores them on launch.
enum Persistence {
    private static func file(_ name: String) -> URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let appDir = dir.appendingPathComponent("PerlinLiveWallpaper", isDirectory: true)
        try? FileManager.default.createDirectory(at: appDir, withIntermediateDirectories: true)
        return appDir.appendingPathComponent(name)
    }

    // MARK: Preset (params)

    static func save(json: String) {
        guard let url = file("current.json") else { return }
        try? Data(json.utf8).write(to: url)
    }

    static func load() -> Preset? {
        guard let url = file("current.json"), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Preset.self, from: data)
    }

    /// The raw current-look JSON (for re-saving as a named custom preset).
    static func loadRaw() -> String? {
        guard let url = file("current.json"), let data = try? Data(contentsOf: url) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: Image mask

    static func saveMask(image: String?, invert: Bool, fill: Bool) {
        guard let url = file("mask.json") else { return }
        if let image = image {
            let dict: [String: Any] = ["image": image, "invert": invert, "fill": fill]
            if let data = try? JSONSerialization.data(withJSONObject: dict) { try? data.write(to: url) }
        } else {
            try? FileManager.default.removeItem(at: url)
        }
    }

    static func loadMask() -> (image: String, invert: Bool, fill: Bool)? {
        guard let url = file("mask.json"), let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let image = obj["image"] as? String else { return nil }
        return (image, obj["invert"] as? Bool ?? false, obj["fill"] as? Bool ?? false)
    }
}
