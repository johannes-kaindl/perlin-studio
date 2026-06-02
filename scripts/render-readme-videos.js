// Renders the docs/examples/*.webm loops from the actual built-in presets
// (perlin-presets.js) through the full render pipeline (perlin.js
// generatePerlinImage via a headless mock ctx) and pipes RGB frames to
// ffmpeg (libvpx-vp9). Mathematically seamless: loopProgress goes from 0 to
// (N-1)/N; ffmpeg output played with `<video loop>` snaps back to the start
// → perfect loop.
//
//   node scripts/render-readme-videos.js
//
// Requires ffmpeg on PATH (`brew install ffmpeg`).
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
global.window = {};
require(path.join(REPO, "perlin.js"));
require(path.join(REPO, "perlin-presets.js"));
const { generatePerlinImage } = global.window.MTPerlin;
const { BUILTIN_PRESETS, resolveParams } = global.window.MTPerlinPresets;

// Render one frame through the full pipeline into a packed RGB buffer
// (alpha dropped — ffmpeg wants rgb24; presets don't use the mask).
function renderFrameRGB(params) {
  const ctx = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    _img: null,
    putImageData(img) { this._img = img; },
  };
  generatePerlinImage(params, ctx);
  const rgba = ctx._img.data;
  const rgb = Buffer.alloc(params.width * params.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
  }
  return rgb;
}

// Encodes a sequence of RGB frames into a VP9 WebM via ffmpeg.
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

const W = 480, H = 270, FPS = 24, FRAMES = 60; // 2.5 s loop

const JOBS = [
  { out: "lava-loop.webm",    preset: "lava" },
  { out: "aurora-loop.webm",  preset: "aurora" },
  { out: "terrain-loop.webm", preset: "terrain" },
];

(async () => {
  for (const job of JOBS) {
    const base = BUILTIN_PRESETS[job.preset];
    if (!base) throw new Error("unknown preset: " + job.preset);
    const t0 = Date.now();
    const frames = [];
    for (let i = 0; i < FRAMES; i++) {
      frames.push(renderFrameRGB(resolveParams({ ...base, width: W, height: H, loop: true, loopProgress: i / FRAMES })));
    }
    const tRender = Date.now();
    const outPath = path.join(OUTDIR, job.out);
    await encodeWebm(W, H, FPS, frames, outPath);
    const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`✓ ${job.out.padEnd(22)} ${job.preset.padEnd(8)} ${FRAMES} frames  ${kb} KB  render ${tRender - t0}ms  encode ${Date.now() - tRender}ms`);
  }
  console.log("all loops written →", OUTDIR);
})().catch((e) => { console.error(e); process.exit(1); });
