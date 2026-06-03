#!/usr/bin/env node
/**
 * export-presets.js — resolve the studio's built-in presets to JSON the Swift
 * app can decode. Keeps the *parameters* single-source in perlin-presets.js;
 * only the noise *algorithm* is re-implemented (in MSL). Re-run after changing
 * presets:  node macos/scripts/export-presets.js
 *
 * @license AGPL-3.0-or-later
 */
"use strict";
const path = require("path");
const fs = require("fs");

const { BUILTIN_PRESETS, resolveParams } = require("../../perlin-presets.js");

// The MSL shader now covers every studio colour mode except tile / image-mask:
// gradient / posterize / hsv / rgb (incl. per-channel nebula) / flow + layer2.
const NAMES = ["default", "lava", "aurora", "clouds", "terrain", "circuit", "marble", "composite", "nebula", "flow"];

const outDir = path.join(__dirname, "..", "Sources", "PerlinLiveWallpaper", "Resources", "presets");
fs.mkdirSync(outDir, { recursive: true });

for (const name of NAMES) {
  const preset = BUILTIN_PRESETS[name];
  if (!preset) throw new Error("unknown preset: " + name);
  const resolved = resolveParams(preset);
  resolved.name = name;
  fs.writeFileSync(path.join(outDir, name + ".json"), JSON.stringify(resolved, null, 2) + "\n");
}
console.log("wrote " + NAMES.length + " presets to " + path.relative(process.cwd(), outDir));
