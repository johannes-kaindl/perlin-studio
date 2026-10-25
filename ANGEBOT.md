---
repo: perlin-studio
stand: 2026-10-25
liefert:
  - id: still-png
    artefakt: a single Perlin frame as a lossless still image
    format: "PNG, any size up to the browser canvas limit, RGBA"
    deterministisch_aus: [preset-or-parameters, seed, loopProgress, width, height]
    befehl: "Browser-UI, PNG snapshot button in index.html"
    lizenz: "AGPL-3.0-or-later (code); the rendered image carries no extra restriction"
  - id: loop-video
    artefakt: a seamless animated Perlin loop as a video file
    format: "MP4/H.264 (Safari, iOS, Chrome 126+) or WebM (Firefox), arbitrary length and frame rate"
    deterministisch_aus: []
    befehl: "Browser-UI, video export in index.html"
    lizenz: "AGPL-3.0-or-later (code); the rendered video carries no extra restriction"
  - id: readme-loops
    artefakt: three reference loops (lava, aurora, terrain) rendered from the built-in presets
    format: "WebM VP9, 480x270, 24 fps, 60 frames (2.5 s), seamless"
    deterministisch_aus: [preset, width, height, fps, frame-count, ffmpeg-libvpx-version]
    befehl: "node scripts/render-readme-videos.js"
    lizenz: "AGPL-3.0-or-later (code); CC-BY-SA-4.0 for the documentation use"
  - id: readme-stills
    artefakt: hero image and six gallery stills rendered from the built-in presets
    format: "PNG, hero 1200x630, gallery 560 px wide"
    deterministisch_aus: [preset, width, height, zlib-version]
    befehl: "node scripts/render-readme-images.js"
    lizenz: "AGPL-3.0-or-later (code); CC-BY-SA-4.0 for the documentation use"
  - id: web-component
    artefakt: the embeddable <perlin-noise> custom element as one script file
    format: "single JavaScript file, no dependencies, no build"
    deterministisch_aus: [perlin.js, perlin-presets.js, perlin-engine.js, perlin-element.js]
    befehl: "node scripts/build-standalone.js"
    lizenz: "AGPL-3.0-or-later; commercial option in LICENSING.md"
  - id: live-wallpaper-app
    artefakt: Perlin Live Wallpaper, a menu-bar app drawing the noise as an animated desktop background
    format: "macOS 14+ .app bundle, Developer-ID signed, optionally notarized"
    deterministisch_aus: []
    befehl: "macos/scripts/build-app.sh"
    lizenz: "AGPL-3.0-or-later"
  - id: live-photo
    artefakt: a Live Photo (HEVC clip plus paired HEIC still) made from the same noise
    format: "Live Photo in the Photos library, rendered on device"
    deterministisch_aus: [preset-or-parameters, seed, duration, resolution]
    befehl: "iOS app Perlin Live Photo (ios/), Create Live Photo"
    lizenz: "AGPL-3.0-or-later"
nicht_geliefert:
  - was: animated GIF export
    grund: still an open roadmap idea (export phase P1b), no implementation yet
  - was: video with an alpha channel
    grund: planned as export phase P3, the current exporters flatten onto a background colour
  - was: an animated iOS lock-screen wallpaper
    grund: iOS content-gates animated Live Photos, so a synthetic one animates in Photos only
  - was: native app parity for the 4D loop
    grund: planned as export phase P2, the Metal renderer does not yet do the 4D loop path of the web studio
---
# Offer

What this repo gives to others, not what it can do. Required for media repos (PROF-MEDIA-01).

## Get it

The still images and videos come from the studio itself: open the hosted copy at `https://pages.jkaindl.de/perlin-studio/` or double-click `index.html`, pick a preset or set parameters, then export. The reference loops (`docs/examples/*.webm`) and the embeddable element (`dist/perlin-noise.js`) are also served from that site, so a consumer can fetch them directly. A consumer should freeze what it takes and stamp the origin (PROF-MEDIA-02): the repo, the tag (`vX.Y.Z`), and the parameters or preset name. The native apps are built from `macos/` and `ios/`; their build guides are `docs/how-to/install-the-macos-app.md` and `ios/README.md`.

## What it is not

It is not a texture library: there is no fixed set of finished images beyond the README showcase, only a generator that produces any image from parameters. The video export is not byte-reproducible, because the browser encoder (`MediaRecorder`) decides the container bytes; only the rendered frames are determined by the parameters. The macOS app is a desktop-level window behind the icons, not a system wallpaper, and the iOS Live Photo is not an animated lock-screen wallpaper.

## Checked

The optional GPU renderer is compared pixel by pixel with the CPU path by `node scripts/check-gl-parity.mjs` (by hand, it needs a browser): at most one colour level apart, measured on one machine (Apple M5 Pro, Chromium). `node scripts/smoke-test.js` (loop identity at progress 0 and 1, value ranges, Z/W axis independence, colour range) and `node scripts/check-syntax.mjs` both run before every deploy. The on-device acceptance of the iOS app (8 points) is still open, so the `live-photo` entry rests on the headless test of the shared core and has not yet been checked on a phone. Nothing checks that the video export is seamless in a browser other than by eye.
