import Foundation

/// Persists the last-applied look (the raw resolved-preset JSON from the editor)
/// under Application Support, and restores it on launch.
enum Persistence {
    private static var fileURL: URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let appDir = dir.appendingPathComponent("PerlinLiveWallpaper", isDirectory: true)
        try? FileManager.default.createDirectory(at: appDir, withIntermediateDirectories: true)
        return appDir.appendingPathComponent("current.json")
    }

    static func save(json: String) {
        guard let url = fileURL else { return }
        try? Data(json.utf8).write(to: url)
    }

    static func load() -> Preset? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Preset.self, from: data)
    }
}
