// Rendert die docs/examples/*.webm Loops via dem echten perlin.js und
// pipet RGB-Frames an ffmpeg (libvpx-vp9). Mathematisch nahtlos:
// loopProgress geht von 0 bis (N-1)/N, ffmpeg-output mit `<video loop>`
// schließt zum Start zurück → perfekter Loop.
//
//   node scripts/render-readme-videos.js
//
// Voraussetzung: ffmpeg im PATH (`brew install ffmpeg`).
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
global.window = {};
require(path.join(REPO, "perlin.js"));
const { makePermutation, fbm4, colorize } = global.window.MTPerlin;

// Gradient-Definitionen (Copy aus perlin-studio.js).
const GRADIENTS = {
  fire: [
    { pos: 0.0, color: [0, 0, 0] },
    { pos: 0.3, color: [136, 0, 0] },
    { pos: 0.6, color: [255, 89, 0] },
    { pos: 0.85, color: [255, 213, 0] },
    { pos: 1.0, color: [255, 255, 240] },
  ],
  forest: [
    { pos: 0.0, color: [25, 35, 20] },
    { pos: 0.3, color: [40, 80, 30] },
    { pos: 0.6, color: [80, 140, 50] },
    { pos: 0.85, color: [180, 200, 110] },
    { pos: 1.0, color: [240, 245, 200] },
  ],
};

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

  const cp = { ...params };
  if (cp.gradientName) cp.gradient = GRADIENTS[cp.gradientName] || GRADIENTS.forest;

  let off = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = fbm4(perm, x * scaleX, y * scaleY, zc, wc, octaves, persistence, lacunarity);
      const [r, g, b] = colorize(n, cp);
      buf[off++] = r; buf[off++] = g; buf[off++] = b;
    }
  }
  return buf;
}

// Encodet eine Sequenz von RGB-Frames als VP9-WebM via ffmpeg.
function encodeWebm(width, height, fps, frames, outPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-f", "rawvideo",
      "-pixel_format", "rgb24",
      "-video_size", `${width}x${height}`,
      "-framerate", String(fps),
      "-i", "pipe:0",
      "-c:v", "libvpx-vp9",
      "-b:v", "0",
      "-crf", "34",
      "-pix_fmt", "yuv420p",
      "-deadline", "good",
      "-cpu-used", "2",
      "-row-mt", "1",
      outPath,
    ], { stdio: ["pipe", "inherit", "pipe"] });

    let errOut = "";
    ff.stderr.on("data", (d) => { errOut += d.toString(); });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${errOut.slice(-800)}`));
    });

    (async () => {
      for (const frame of frames) {
        if (!ff.stdin.write(frame)) {
          await new Promise((r) => ff.stdin.once("drain", r));
        }
      }
      ff.stdin.end();
    })().catch(reject);
  });
}

// ---------- Jobs ----------
const OUTDIR = path.join(REPO, "docs", "examples");
fs.mkdirSync(OUTDIR, { recursive: true });

const W = 480, H = 270, FPS = 24, FRAMES = 60; // 2.5s Loop

const JOBS = [
  {
    out: "lava-loop.webm",
    params: {
      width: W, height: H,
      scaleX: 0.014, scaleY: 0.014, scaleT: 0.16,
      octaves: 5, persistence: 0.62, lacunarity: 2.2, base: 7,
      colorMode: "gradient", gradientName: "fire",
      loopRadius: 1.0,
    },
  },
  {
    out: "aurora-loop.webm",
    params: {
      width: W, height: H,
      scaleX: 0.009, scaleY: 0.024, scaleT: 0.20,
      octaves: 5, persistence: 0.58, lacunarity: 2.4, base: 19,
      colorMode: "hsv",
      hsvHueShift: 0.30, hsvHueRange: 0.48, hsvSat: 0.88, hsvVal: 1.0,
      loopRadius: 1.0,
    },
  },
  {
    out: "terrain-loop.webm",
    params: {
      width: W, height: H,
      scaleX: 0.011, scaleY: 0.011, scaleT: 0.10,
      octaves: 6, persistence: 0.55, lacunarity: 2.0, base: 42,
      colorMode: "posterize", posterizeSteps: 7, gradientName: "forest",
      loopRadius: 1.0,
    },
  },
];

(async () => {
  for (const job of JOBS) {
    const t0 = Date.now();
    const frames = [];
    for (let i = 0; i < FRAMES; i++) {
      const params = { ...job.params, loopProgress: i / FRAMES };
      frames.push(renderFrame(params));
    }
    const tRender = Date.now();
    const outPath = path.join(OUTDIR, job.out);
    await encodeWebm(W, H, FPS, frames, outPath);
    const stat = fs.statSync(outPath);
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`✓ ${job.out.padEnd(22)} ${FRAMES} Frames  ${kb} KB  render ${tRender - t0}ms  encode ${Date.now() - tRender}ms`);
  }
  console.log("alle Loops geschrieben →", OUTDIR);
})().catch((e) => { console.error(e); process.exit(1); });
