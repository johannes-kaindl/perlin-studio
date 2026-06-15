#!/usr/bin/env bash
#
# build-app.sh — package PerlinLiveWallpaper as a signed (and optionally
# notarized) .app bundle.
#
#   ./scripts/build-app.sh              build + assemble + Developer-ID sign
#   ./scripts/build-app.sh --notarize   …then notarize + staple
#
# Notarization needs a one-time keychain profile (no password is stored here):
#   xcrun notarytool store-credentials jkaindl \
#     --apple-id <you@example.com> --team-id U9X7M39R56 --password <app-specific-pw>
# Override the profile name with NOTARY_PROFILE=… if you used a different one.
#
set -euo pipefail
cd "$(dirname "$0")/.."   # -> macos/

APP_NAME="Perlin Live Wallpaper"
EXEC="PerlinLiveWallpaper"
SIGN_ID="${SIGN_ID:-Developer ID Application: Johannes Kaindl (U9X7M39R56)}"
NOTARY_PROFILE="${NOTARY_PROFILE:-jkaindl}"
BUILD_DIR=".build/release"
APP="dist/${APP_NAME}.app"

echo "==> swift build -c release"
swift build -c release

echo "==> assembling ${APP}"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD_DIR/$EXEC" "$APP/Contents/MacOS/$EXEC"
cp packaging/Info.plist "$APP/Contents/Info.plist"

# SwiftPM resource bundle (presets + bundled studio). -L follows the
# .build/release symlink; the bundle is required, so fail loudly if missing.
RES_BUNDLE="$(find -L "$BUILD_DIR" -maxdepth 1 -name '*.bundle' | head -1)"
if [ -z "$RES_BUNDLE" ]; then echo "ERROR: resource bundle not found in $BUILD_DIR" >&2; exit 1; fi
cp -R "$RES_BUNDLE" "$APP/Contents/Resources/"

# App icon from the studio art (best-effort; not required for notarization).
ICON_SRC="../assets/icon-512.png"
if command -v iconutil >/dev/null && [ -f "$ICON_SRC" ]; then
  ICONSET="dist/AppIcon.iconset"
  rm -rf "$ICONSET"; mkdir -p "$ICONSET"
  for n in "16:16x16" "32:16x16@2x" "32:32x32" "64:32x32@2x" "128:128x128" \
           "256:128x128@2x" "256:256x256" "512:256x256@2x" "512:512x512"; do
    px="${n%%:*}"; name="${n##*:}"
    sips -z "$px" "$px" "$ICON_SRC" --out "$ICONSET/icon_${name}.png" >/dev/null 2>&1 || true
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" 2>/dev/null \
    && echo "    icon: AppIcon.icns" || echo "    icon: skipped"
  rm -rf "$ICONSET"
fi

echo "==> codesign (Developer ID, hardened runtime)"
# The SwiftPM resource bundle is a plain data folder (no Info.plist, no Mach-O),
# so it is sealed as a resource by the app signature — not signed separately.
codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$APP"
codesign --verify --strict --verbose=2 "$APP"

if [ "${1:-}" = "--notarize" ]; then
  echo "==> notarize (keychain profile: $NOTARY_PROFILE)"
  ZIP="dist/${EXEC}.zip"
  ditto -c -k --keepParent "$APP" "$ZIP"
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  echo "==> staple"
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
  rm -f "$ZIP"
  echo "==> notarized: $APP"
else
  echo "==> signed (not notarized): $APP"
  echo "    run with --notarize once the keychain profile exists (see header)."
fi
