/**
 * perlin-export.js — pure compositing math for Perlin Studio's video export.
 *
 * No DOM, no dependencies: attaches window.MTPerlinExport so it is usable in
 * the browser and require()-able in Node (the smoke-test gate). The studio
 * (perlin-studio.js) wraps these with the actual canvas/MediaRecorder plumbing.
 *
 * @license AGPL-3.0-or-later
 */
(function (root) {
  "use strict";

  // Rect for drawing a srcW x srcH image into a dstW x dstH frame, centered.
  // "cover" fills the frame (cropping overflow); "contain" letterboxes.
  function computeFitRect(srcW, srcH, dstW, dstH, fit) {
    const scale = fit === "contain"
      ? Math.min(dstW / srcW, dstH / srcH)
      : Math.max(dstW / srcW, dstH / srcH);
    const w = srcW * scale;
    const h = srcH * scale;
    return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
  }

  // "#rrggbb" -> [r, g, b] (0–255). Assumes the 7-char form an <input type=color> yields.
  function hexToRgb(hex) {
    const n = parseInt((hex || "#000000").slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Composite straight-alpha RGBA noise over an opaque [r,g,b] background.
  // Returns a NEW opaque Uint8ClampedArray; does not mutate the input.
  function compositeOverColor(noise, bg) {
    const out = new Uint8ClampedArray(noise.length);
    const br = bg[0], bg1 = bg[1], bb = bg[2];
    for (let i = 0; i < noise.length; i += 4) {
      const a = noise[i + 3] / 255;
      const ia = 1 - a;
      out[i]     = Math.round(noise[i]     * a + br  * ia);
      out[i + 1] = Math.round(noise[i + 1] * a + bg1 * ia);
      out[i + 2] = Math.round(noise[i + 2] * a + bb  * ia);
      out[i + 3] = 255;
    }
    return out;
  }

  root.MTPerlinExport = { computeFitRect, compositeOverColor, hexToRgb };
})(typeof window !== "undefined" ? window : globalThis);
