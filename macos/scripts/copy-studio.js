#!/usr/bin/env node
/**
 * copy-studio.js — bundle the Perlin Studio web app into the macOS app as a
 * resource, so the embedded editor (WKWebView) loads it offline and
 * version-matched. Single-source from the repo root; re-run after changing the
 * studio:  node macos/scripts/copy-studio.js
 *
 * @license AGPL-3.0-or-later
 */
"use strict";
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..", "..");
const out = path.join(__dirname, "..", "Sources", "PerlinLiveWallpaper", "Resources", "studio");
const outAssets = path.join(out, "assets");

const FILES = [
  "index.html", "styles.css", "manifest.webmanifest",
  "perlin.js", "perlin-presets.js", "perlin-engine.js", "perlin-studio.js", "perlin-element.js",
];
const ASSETS = ["favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];

fs.mkdirSync(outAssets, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const a of ASSETS) {
  const src = path.join(root, "assets", a);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outAssets, a));
}
console.log("copied studio (" + FILES.length + " files + assets) to " + path.relative(process.cwd(), out));
