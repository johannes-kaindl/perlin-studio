import Foundation

/// Loads the named gradient palettes bundled as gradients.json. Cross-platform
/// like PresetStore (SwiftPM Bundle.module / app Bundle.main).
enum Gradients {
    struct Named: Decodable { let name: String; let stops: [GradientStop] }

    static let all: [Named] = {
        #if SWIFT_PACKAGE
        let url = Bundle.module.url(forResource: "gradients", withExtension: "json")
        #else
        let url = Bundle.main.url(forResource: "gradients", withExtension: "json")
        #endif
        guard let url, let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Named].self, from: data) else { return [] }
        return list
    }()

    static func stops(named name: String) -> [GradientStop]? {
        all.first(where: { $0.name == name })?.stops
    }
}
