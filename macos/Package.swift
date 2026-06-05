// swift-tools-version: 6.0
import PackageDescription

// PerlinLiveWallpaper — a menu-bar app that renders the studio's Perlin noise
// live as a macOS desktop wallpaper (a desktop-level window, not a system
// wallpaper API — see README). Pure AppKit + Metal, no third-party deps.
//
// Swift 5 language mode is deliberate: this is a single-process AppKit app and
// Swift 6 strict concurrency adds no safety here, only main-actor friction.
let package = Package(
    name: "PerlinLiveWallpaper",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "PerlinLiveWallpaper",
            resources: [.copy("Resources/presets"), .copy("Resources/studio"), .copy("Resources/gradients.json")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
