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

// v1 bundles only presets whose colour mode the MSL shader supports today:
// gradient / posterize / hsv. `nebula` (rgbMultiChannel) and `flow` are
// deferred — see the design spec.
const NAMES = ["default", "lava", "aurora", "clouds", "terrain", "circuit", "marble", "composite"];

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
