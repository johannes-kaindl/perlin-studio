#!/usr/bin/env bash
# Single-source version bump for the macOS companion app (PROF-NAT-02).
#
#   bash scripts/bump-version.sh 0.2.0
#
# Perlin Studio's web side is no-build / zero-dependency (PROF-WEB-01): there is
# no package.json and no machine-readable web version (the studio's history lives
# in CHANGELOG.md). The only versioned native artifact is the macOS app, whose
# version is single-source in macos/packaging/Info.plist. This script keeps that
# one source self-consistent:
#
#   Info.plist → CFBundleShortVersionString = <ver>, CFBundleVersion += 1
#
# (comply-or-explain re PROF-NAT-02: there is no package.json to sync — see
# AGENTS.md "Abweichungen von der Leitkonvention".)
#
# macOS-only (uses PlistBuddy). Releases are cut locally on macOS anyway.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:-}"
[ -n "$VER" ] || { echo "usage: $0 <version>   e.g. $0 0.2.0" >&2; exit 1; }
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "✗ version must be X.Y.Z (got '$VER')" >&2; exit 1; }

PLIST="$ROOT/macos/packaging/Info.plist"
PB=/usr/libexec/PlistBuddy
[ -f "$PLIST" ] || { echo "✗ missing $PLIST" >&2; exit 1; }
[ -w "$PLIST" ] || { echo "✗ not writable: $PLIST" >&2; exit 1; }
[ -x "$PB" ]    || { echo "✗ PlistBuddy not found ($PB) — run on macOS" >&2; exit 1; }

# Stage into a temp copy in the same dir so the commit is an atomic rename; the
# trap removes it on any early exit, so a mid-run failure can never leave a
# half-written plist behind.
PLIST_TMP="$(mktemp "$(dirname "$PLIST")/.bump.plist.XXXXXX")"
trap 'rm -f "$PLIST_TMP"' EXIT

cp "$PLIST" "$PLIST_TMP"
CUR=$("$PB" -c "Print :CFBundleVersion" "$PLIST_TMP")
"$PB" -c "Set :CFBundleShortVersionString $VER" "$PLIST_TMP"
"$PB" -c "Set :CFBundleVersion $((CUR + 1))" "$PLIST_TMP"

# Validate the staged temp BEFORE committing it.
GOT_SHORT=$("$PB" -c "Print :CFBundleShortVersionString" "$PLIST_TMP")
GOT_BUILD=$("$PB" -c "Print :CFBundleVersion" "$PLIST_TMP")
[ "$GOT_SHORT" = "$VER" ]         || { echo "✗ staged short version mismatch ($GOT_SHORT ≠ $VER)" >&2; exit 1; }
[ "$GOT_BUILD" = "$((CUR + 1))" ] || { echo "✗ staged build mismatch ($GOT_BUILD ≠ $((CUR + 1)))" >&2; exit 1; }

# Preserve the original file mode — mktemp creates the temp as 0600, so without
# this the plist would silently lose its group/other read bits on the rename.
chmod "$(stat -f '%Lp' "$PLIST")" "$PLIST_TMP"
mv "$PLIST_TMP" "$PLIST"
trap - EXIT

FIN_SHORT=$("$PB" -c "Print :CFBundleShortVersionString" "$PLIST")
[ "$FIN_SHORT" = "$VER" ] || { echo "✗ version drift after write: Info.plist=$FIN_SHORT (wanted $VER)" >&2; exit 1; }

echo "✓ version → $VER   (Info.plist CFBundleShortVersionString; CFBundleVersion $CUR → $((CUR + 1)))"
echo "  next: git commit -am 'chore(release): $VER' && git tag $VER && git push origin main $VER"
echo "        (GitHub mirror follows automatically via the Forgejo push mirror)"
