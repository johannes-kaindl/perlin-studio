#!/usr/bin/env node
// Emit the named gradient palettes from perlin-presets.js to a bundled JSON,
// single-sourcing them (like export-presets.js does for presets).
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "..", "perlin-presets.js"));
const { GRADIENTS } = global.window.MTPerlinPresets;
const out = Object.entries(GRADIENTS).map(([name, stops]) => ({
  name,
  stops: stops.map((s) => ({ pos: s.pos, color: s.color })),
}));
const dest = path.join(__dirname, "..", "Sources", "PerlinLiveWallpaper", "Resources", "gradients.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
process.stderr.write(`export-gradients: ${out.length} gradients -> ${dest}\n`);
