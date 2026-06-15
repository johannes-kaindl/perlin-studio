# macOS app — distribution & Gatekeeper

The native companion app, **Perlin Live Wallpaper** (`macos/`), renders the
studio's noise live as an animated desktop background on the GPU via Metal. It
ships as a signed, notarized `.app` bundle. This guide covers building,
signing/notarizing for distribution, and how an end user opens it past
Gatekeeper.

For *what the app does* and how it relates to the studio, see
[`macos/README.md`](../macos/README.md).

## Build & run (from source)

```bash
cd macos
swift build && swift run          # build + launch the menu-bar app
```

Requirements: **macOS 14+** (developed/tested on macOS 26 "Tahoe", Apple
Silicon) and a **Swift toolchain** (Xcode or the Command Line Tools,
`xcode-select --install`). `swift run` is enough for personal use and on-device
testing — no signing required for a local build.

Headless validation (the GPU counterpart to the studio's `smoke-test.js`):

```bash
cd macos
swift run PerlinLiveWallpaper --selftest
```

## System requirement

**macOS 14 or newer** (`LSMinimumSystemVersion` is 14.0; Metal + AppKit
desktop-level window). The app is a menu-bar agent (`LSUIElement`) with no Dock
icon.

## Packaging a `.app`

```bash
cd macos
./scripts/build-app.sh                 # build + assemble + Developer-ID sign
./scripts/build-app.sh --notarize      # …then notarize + staple
```

The script builds release, assembles `dist/Perlin Live Wallpaper.app` (icon from
the studio art), Developer-ID signs it with the **hardened runtime**, and — with
`--notarize` — notarizes and staples it. `dist/` is gitignored. Override the
signing identity or notary profile with `SIGN_ID=…` / `NOTARY_PROFILE=…`.

The bump-version helper keeps the app version consistent before a release tag —
run it from the **repo root** (not from `macos/`):

```bash
bash scripts/bump-version.sh 0.2.0     # Info.plist short version + build number
```

## Signing & notarizing (Developer ID)

Official builds are **Developer-ID signed and Apple-notarized**, so the `.app`
opens by double-click **without any Gatekeeper warning**, online or offline.

### One-time setup

1. **Apple Developer Program** membership (Individual), active.
2. A **"Developer ID Application"** certificate in the login keychain —
   `security find-identity -v -p codesigning` then lists the identity.
3. **notarytool credentials** stored once (an app-specific password from
   [account.apple.com](https://account.apple.com) — nothing secret lives in the
   repo):
   ```bash
   xcrun notarytool store-credentials jkaindl \
     --apple-id you@example.com --team-id U9X7M39R56 --password <app-specific-pw>
   ```

### Produce a notarized build

```bash
cd macos
./scripts/build-app.sh --notarize
```

The Mac must be **online** (secure timestamp + notary upload). Order: sign the
app → submit to notary (`--wait`) → staple → validate. The result is a
double-clickable, Gatekeeper-approved `.app`.

### Why the hardened runtime, no entitlements

Notarization requires the **hardened runtime** (a signing flag), not the App
Sandbox. The app is **not** sandboxed; it draws a desktop-level AppKit window and
talks to Metal and the Photos library (for Live Photo export) via public APIs
that need no sandbox entitlement keys. It is therefore signed with
`--options runtime` and no `--entitlements` file. The SwiftPM resource bundle
(presets + bundled studio) is a plain data folder with no Mach-O, so it is sealed
as a resource by the app signature rather than signed separately.

## Opening an unsigned / locally built app (Gatekeeper)

A **locally built, unsigned** `.app` (contributors without a certificate) is not
silently accepted by Gatekeeper. Since macOS 15 Sequoia the old right-click →
"Open" shortcut is gone; release it once via **System Settings → Privacy &
Security → "Open Anyway"**, or strip the quarantine flag in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Perlin Live Wallpaper.app"
```

(Builds produced by `swift run` directly are run from your own machine and carry
no quarantine flag, so this only applies to a downloaded or transferred build.)
