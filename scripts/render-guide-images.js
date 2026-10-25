// Renders the documentation illustration images (docs/images/*.png) from the
// real render pipeline (perlin.js generatePerlinImage via a headless mock
// ctx) so the "what does each control do" comparisons are accurate. Pure Node
// (zlib + crc32), no external dependencies — same approach as
// scripts/render-readme-images.js.
//
//   node scripts/render-guide-images.js
"use strict";

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
global.window = {};
require(path.join(REPO, "perlin.js"));
require(path.join(REPO, "perlin-presets.js"));
const { generatePerlinImage } = global.window.MTPerlin;
const { resolveParams } = global.window.MTPerlinPresets;

function renderRGB(params) {
  const ctx = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    _img: null,
    putImageData(img) { this._img = img; },
  };
  generatePerlinImage(resolveParams(params), ctx);
  const rgba = ctx._img.data;
  const rgb = Buffer.alloc(params.width * params.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
  }
  return rgb;
}

// ---- PNG encoder (pure Node, RGB / colour type 2) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
// nearestScale: integer upscale by nearest-neighbour so a low-resolution
// render reads as crisp pixel blocks (mirrors the studio's pixelated display).
function nearestScale(rgb, w, h, factor) {
  const W = w * factor, H = h * factor;
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = (y / factor) | 0;
    for (let x = 0; x < W; x++) {
      const sx = (x / factor) | 0;
      const si = (sy * w + sx) * 3, di = (y * W + x) * 3;
      out[di] = rgb[si]; out[di + 1] = rgb[si + 1]; out[di + 2] = rgb[si + 2];
    }
  }
  return { rgb: out, width: W, height: H };
}
function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); ihdr.writeUInt8(2, 9); ihdr.writeUInt8(0, 10); ihdr.writeUInt8(0, 11); ihdr.writeUInt8(0, 12);
  const stride = width * 3;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) { filtered[y * (stride + 1)] = 0; rgb.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const idat = zlib.deflateSync(filtered, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// Shared base so the comparisons isolate one variable at a time.
const W = 360, H = 240;
const BASE = {
  width: W, height: H, scaleT: 0.15, loop: true, loopProgress: 0.2, loopRadius: 1.0,
  scaleX: 0.018, scaleY: 0.018, octaves: 5, persistence: 0.5, lacunarity: 2.0, base: 9,
  colorMode: "gradient", gradientName: "viridis",
  warpStrength: 0, warpScale: 1, layer2On: false,
};

const OUT = path.join(REPO, "docs", "images");
fs.mkdirSync(OUT, { recursive: true });

function write(name, params, opts = {}) {
  let rgb = renderRGB(params), w = params.width, h = params.height;
  if (opts.pixelate) { const up = nearestScale(rgb, w, h, opts.pixelate); rgb = up.rgb; w = up.width; h = up.height; }
  const png = encodePng(w, h, rgb);
  fs.writeFileSync(path.join(OUT, name + ".png"), png);
  console.log(`✓ ${name.padEnd(22)} ${w}×${h}  ${(png.length / 1024).toFixed(1)} KB`);
}

// 1) Octaves: detail
write("octaves-2", { ...BASE, octaves: 2 });
write("octaves-8", { ...BASE, octaves: 8 });
// 2) Scale: zoom level (higher scaleX = noise advances faster per pixel = finer)
write("scale-coarse", { ...BASE, scaleX: 0.008, scaleY: 0.008 });
write("scale-fine", { ...BASE, scaleX: 0.045, scaleY: 0.045 });
// 3) Persistence: roughness
write("persistence-low", { ...BASE, octaves: 7, persistence: 0.32 });
write("persistence-high", { ...BASE, octaves: 7, persistence: 0.75 });
// 4) Domain warp: off vs on
write("warp-off", { ...BASE, octaves: 4, warpStrength: 0 });
write("warp-on", { ...BASE, octaves: 4, warpStrength: 1.8, warpScale: 0.6 });
// 5) Low-resolution pixel ("Minecraft") look — render small, nearest-upscale ×9
write("lowres-blocks", { ...BASE, width: 40, height: 27, scaleX: 0.09, scaleY: 0.09, octaves: 4 }, { pixelate: 9 });
write("lowres-smooth", { ...BASE, scaleX: 0.09, scaleY: 0.09, octaves: 4 });
// 6) Colour modes on the same field
const cbase = { ...BASE, scaleX: 0.016, scaleY: 0.016, octaves: 5, base: 14 };
write("mode-rgb", { ...cbase, colorMode: "rgb", rScale: 1, gScale: 1, bScale: 1, rInvert: false, gInvert: true, bInvert: false, rgbMultiChannel: false });
write("mode-gradient", { ...cbase, colorMode: "gradient", gradientName: "magma" });
write("mode-hsv", { ...cbase, colorMode: "hsv", hsvHueShift: 0.55, hsvHueRange: 0.5, hsvSat: 0.85, hsvVal: 1.0 });
write("mode-posterize", { ...cbase, colorMode: "posterize", posterizeSteps: 5, gradientName: "ocean" });
write("mode-flow", { ...cbase, colorMode: "flow", flowHueShift: 0, flowSat: 0.9, flowGain: 14, flowFloor: 0.24, flowEps: 0.5 });

// 7) Cosine colour mode on the same field, and the seven built-in palettes as strips
write("mode-cosine", { ...cbase, colorMode: "cosine", cosineName: "neon" });
{
  const { COSINE_PALETTES } = global.window.MTPerlinPresets;
  const names = Object.keys(COSINE_PALETTES);
  const sw = 560, rowH = 26, gap = 4, sh = names.length * rowH + (names.length - 1) * gap;
  const rgb = Buffer.alloc(sw * sh * 3, 20);   // dark gaps between the strips
  names.forEach((name, row) => {
    const p = { colorMode: "cosine", cosine: COSINE_PALETTES[name] };
    for (let x = 0; x < sw; x++) {
      const c = global.window.MTPerlin.colorize(x / (sw - 1), p);
      for (let y = 0; y < rowH; y++) {
        const i = ((row * (rowH + gap) + y) * sw + x) * 3;
        rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
      }
    }
  });
  const png = encodePng(sw, sh, rgb);
  fs.writeFileSync(path.join(OUT, "cosine-palettes.png"), png);
  console.log(`✓ ${"cosine-palettes".padEnd(22)} ${sw}×${sh}  ${(png.length / 1024).toFixed(1)} KB  (top to bottom: ${names.join(", ")})`);
}
// 8) Noise types under one colour mode: Perlin needs octaves, the cellular types look clean with 1-2
const nbase = { ...BASE, colorMode: "cosine", cosineName: "neon", base: 6 };
write("noise-perlin", { ...nbase, scaleX: 0.02, scaleY: 0.02, octaves: 5, fieldType: "perlin" });
write("noise-cells", { ...nbase, scaleX: 0.03, scaleY: 0.03, octaves: 1, fieldType: "cells" });
write("noise-borders", { ...nbase, scaleX: 0.03, scaleY: 0.03, octaves: 1, fieldType: "borders" });
write("noise-smooth", { ...nbase, scaleX: 0.03, scaleY: 0.03, octaves: 1, fieldType: "smooth" });
// 9) Relief lighting off and on, over a warped field so the slopes are visible
const rbase = { ...BASE, octaves: 4, warpStrength: 1.6, warpScale: 0.5, colorMode: "gradient", gradientName: "sunset", base: 5 };
write("relief-off", { ...rbase });
write("relief-on", { ...rbase, reliefOn: true, reliefGain: 4, lightAzimuth: 315, lightElevation: 45, reliefAmbient: 0.35, reliefSpec: 0.25, reliefShine: 32 });

console.log("guide images →", OUT);
