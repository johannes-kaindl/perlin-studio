// Renders the README showcase images (assets/hero.png + gallery-*.png) using
// the actual perlin.js module from this repo. PNG encoding is pure Node
// (zlib + crc32), no external dependencies.
//
//   node scripts/render-readme-images.js
//
// Writes into assets/ — overwrites existing PNGs.
"use strict";

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

// perlin.js exports via window.MTPerlin — build the sandbox as in AGENTS.md.
const REPO = path.resolve(__dirname, "..");
global.window = {};
require(path.join(REPO, "perlin.js"));
const { makePermutation, fbm3, fbm4, colorize } = global.window.MTPerlin;

// ---------- Gradients (copy from perlin-studio.js so the renderer is self-contained) ----------
const GRADIENTS = {
  fire: [
    { pos: 0.0, color: [0, 0, 0] },
    { pos: 0.3, color: [136, 0, 0] },
    { pos: 0.6, color: [255, 89, 0] },
    { pos: 0.85, color: [255, 213, 0] },
    { pos: 1.0, color: [255, 255, 240] },
  ],
  ocean: [
    { pos: 0.0, color: [3, 11, 41] },
    { pos: 0.3, color: [5, 56, 107] },
    { pos: 0.6, color: [0, 144, 178] },
    { pos: 0.85, color: [120, 220, 220] },
    { pos: 1.0, color: [240, 248, 255] },
  ],
  forest: [
    { pos: 0.0, color: [25, 35, 20] },
    { pos: 0.3, color: [40, 80, 30] },
    { pos: 0.6, color: [80, 140, 50] },
    { pos: 0.85, color: [180, 200, 110] },
    { pos: 1.0, color: [240, 245, 200] },
  ],
  grayscale: [
    { pos: 0.0, color: [0, 0, 0] },
    { pos: 1.0, color: [255, 255, 255] },
  ],
  sunset: [
    { pos: 0.0, color: [12, 12, 60] },
    { pos: 0.3, color: [110, 30, 100] },
    { pos: 0.6, color: [240, 110, 80] },
    { pos: 0.85, color: [255, 200, 90] },
    { pos: 1.0, color: [255, 245, 200] },
  ],
};

// ---------- Render one frame (loop mode at the chosen progress) ----------
function renderFrame(params) {
  const { width, height, scaleX, scaleY, scaleT,
          octaves, persistence, lacunarity, base,
          loopProgress, loopRadius = 1 } = params;
  const perm = makePermutation(base);
  const buf = Buffer.alloc(width * height * 3);

  const radius = loopRadius * (scaleT || 1);
  const safeProgress = ((loopProgress || 0) % 1 + 1) % 1;
  const alpha = safeProgress * Math.PI * 2;
  const zc = Math.cos(alpha) * radius;
  const wc = Math.sin(alpha) * radius;

  const colorParams = { ...params };
  if (colorParams.gradientName) {
    colorParams.gradient = GRADIENTS[colorParams.gradientName] || GRADIENTS.grayscale;
  }

  let off = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = fbm4(perm, x * scaleX, y * scaleY, zc, wc, octaves, persistence, lacunarity);
      const [r, g, b] = colorize(n, colorParams);
      buf[off++] = r; buf[off++] = g; buf[off++] = b;
    }
  }
  return buf;
}

// ---------- PNG encoder (pure Node) ----------
// CRC32 table per the PNG spec (Annex D, IEEE 802.3 polynomial).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgb) {
  // IHDR: width, height, bit depth=8, colour type=2 (RGB), compression=0, filter=0, interlace=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);     // bit depth
  ihdr.writeUInt8(2, 9);     // colour type RGB
  ihdr.writeUInt8(0, 10);    // compression
  ihdr.writeUInt8(0, 11);    // filter
  ihdr.writeUInt8(0, 12);    // interlace

  // Prefix each scanline with filter byte 0 (None)
  const stride = width * 3;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgb.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(filtered, { level: 9 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Render jobs ----------
const ASSETS = path.join(REPO, "assets");
const LOOP_DEFAULTS = { loopRadius: 1.0, scaleT: 0.15 };

const JOBS = [
  // Hero / OG image — Lava variant, wide
  {
    out: "hero.png",
    params: {
      width: 1200, height: 630,
      scaleX: 0.008, scaleY: 0.008, scaleT: 0.12,
      octaves: 6, persistence: 0.62, lacunarity: 2.1, base: 7,
      colorMode: "gradient", gradientName: "fire",
      loopProgress: 0.42, loopRadius: 1.0,
    },
  },
  // Gallery
  {
    out: "gallery-aurora.png",
    params: {
      width: 700, height: 467,
      scaleX: 0.009, scaleY: 0.024, scaleT: 0.18,
      octaves: 5, persistence: 0.6, lacunarity: 2.4, base: 19,
      colorMode: "hsv",
      hsvHueShift: 0.30, hsvHueRange: 0.48, hsvSat: 0.88, hsvVal: 1.0,
      loopProgress: 0.27, loopRadius: 1.0,
    },
  },
  {
    out: "gallery-ocean.png",
    params: {
      width: 700, height: 467,
      scaleX: 0.011, scaleY: 0.011, scaleT: 0.14,
      octaves: 6, persistence: 0.55, lacunarity: 2.0, base: 23,
      colorMode: "gradient", gradientName: "ocean",
      loopProgress: 0.33, loopRadius: 1.0,
    },
  },
  {
    out: "gallery-terrain.png",
    params: {
      width: 700, height: 467,
      scaleX: 0.009, scaleY: 0.009, scaleT: 0.08,
      octaves: 6, persistence: 0.55, lacunarity: 2.0, base: 42,
      colorMode: "posterize", posterizeSteps: 7, gradientName: "forest",
      loopProgress: 0.60, loopRadius: 1.0,
    },
  },
  {
    out: "gallery-circuit.png",
    params: {
      width: 700, height: 467,
      scaleX: 0.025, scaleY: 0.025, scaleT: 0.2,
      octaves: 3, persistence: 0.7, lacunarity: 3.0, base: 11,
      colorMode: "posterize", posterizeSteps: 4, gradientName: "sunset",
      loopProgress: 0.18, loopRadius: 1.0,
    },
  },
];

if (!fs.existsSync(ASSETS)) {
  console.error("assets/ not found:", ASSETS);
  process.exit(1);
}

for (const job of JOBS) {
  const t0 = Date.now();
  const rgb = renderFrame(job.params);
  const png = encodePng(job.params.width, job.params.height, rgb);
  const outPath = path.join(ASSETS, job.out);
  fs.writeFileSync(outPath, png);
  const t1 = Date.now();
  const kb = (png.length / 1024).toFixed(1);
  console.log(`✓ ${job.out.padEnd(28)} ${job.params.width}×${job.params.height}  ${kb} KB  ${t1 - t0} ms`);
}
console.log("all images written →", ASSETS);
