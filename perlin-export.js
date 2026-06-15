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

  root.MTPerlinExport = { computeFitRect };
})(typeof window !== "undefined" ? window : globalThis);
