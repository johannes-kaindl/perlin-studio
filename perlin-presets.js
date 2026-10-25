/**
 * perlin-presets.js — colour gradients, built-in presets, and param resolution.
 *
 * Shared by the studio controller (perlin-studio.js) and the embeddable
 * <perlin-noise> element (perlin-element.js) so both turn a preset into a
 * renderable params object identically.
 *
 * Plain script: attaches `window.MTPerlinPresets`. Also CommonJS-exportable so
 * the smoke test can import `resolveParams` under Node.
 *
 * @license AGPL-3.0-or-later
 */
(function (root) {
  "use strict";

  // ============= COSINE PALETTES =============
  // color(t) = a + b·cos(2π(c·t + d)), per channel. The seven parameter sets are the examples of
  // Inigo Quilez' "Simple color palettes" (iquilezles.org/articles/palettes; his code snippets are
  // MIT). Names are ours, from how the ramps look.
  const COSINE_PALETTES = {
    rainbow: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.00, 0.33, 0.67] },
    dusk:    { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.00, 0.10, 0.20] },
    rose:    { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.30, 0.20, 0.20] },
    citrus:  { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 0.5], d: [0.80, 0.90, 0.30] },
    peach:   { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 0.7, 0.4], d: [0.00, 0.15, 0.20] },
    neon:    { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [2.0, 1.0, 0.0], d: [0.50, 0.20, 0.25] },
    coral:   { a: [0.8, 0.5, 0.4], b: [0.2, 0.4, 0.2], c: [2.0, 1.0, 1.0], d: [0.00, 0.25, 0.25] },
  };

  // ============= GRADIENTS =============
  const GRADIENTS = {
    viridis: [
      { pos: 0.0, color: [68, 1, 84] },
      { pos: 0.25, color: [59, 82, 139] },
      { pos: 0.5, color: [33, 145, 140] },
      { pos: 0.75, color: [94, 201, 98] },
      { pos: 1.0, color: [253, 231, 37] },
    ],
    magma: [
      { pos: 0.0, color: [0, 0, 4] },
      { pos: 0.25, color: [80, 18, 123] },
      { pos: 0.5, color: [183, 55, 121] },
      { pos: 0.75, color: [251, 136, 97] },
      { pos: 1.0, color: [252, 253, 191] },
    ],
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
    ice: [
      { pos: 0.0, color: [10, 20, 50] },
      { pos: 0.4, color: [80, 130, 200] },
      { pos: 0.8, color: [180, 220, 250] },
      { pos: 1.0, color: [255, 255, 255] },
    ],
  };

  // ============= BUILTIN PRESETS =============
  // All presets default to loop=on with a small scaleT for a gentle ripple.
  // loopRadius = 1 traces a full circle in noise space; scaleT shrinks it so
  // the loop stays within a single cell-sized region.
  const LOOP_DEFAULTS = { loop: true, loopDuration: 4, loopRadius: 1.0 };

  // Default warp = off. Presets that want warp opt in explicitly.
  const WARP_OFF = { warpStrength: 0, warpScale: 1 };
  // Default layer 2 = off. Presets that want a composite opt in explicitly.
  const LAYER2_OFF = {
    layer2On: false,
    layer2ScaleX: 0.06, layer2ScaleY: 0.06,
    layer2Octaves: 4, layer2Base: 101,
    layer2BlendMode: "multiply", layer2Mix: 0.5,
  };

  const BUILTIN_PRESETS = {
    default: {
      width: 256, height: 256,
      scaleX: 0.011, scaleY: 0.011, scaleT: 0.15,
      octaves: 5, persistence: 0.62, lacunarity: 2.1, base: 0,
      colorMode: "gradient", gradientName: "viridis",
      ...WARP_OFF, ...LAYER2_OFF, ...LOOP_DEFAULTS,
    },
    lava: {
      width: 384, height: 256,
      scaleX: 0.015, scaleY: 0.015, scaleT: 0.12,
      octaves: 5, persistence: 0.65, lacunarity: 2.2, base: 7,
      colorMode: "gradient", gradientName: "fire",
      ...WARP_OFF, ...LAYER2_OFF, ...LOOP_DEFAULTS, loopDuration: 6,
    },
    aurora: {
      width: 384, height: 256,
      scaleX: 0.009, scaleY: 0.024, scaleT: 0.18,
      octaves: 5, persistence: 0.6, lacunarity: 2.4, base: 19,
      colorMode: "hsv", hsvHueShift: 0.30, hsvHueRange: 0.48, hsvSat: 0.88, hsvVal: 1.0,
      ...WARP_OFF, ...LAYER2_OFF, ...LOOP_DEFAULTS, loopDuration: 5,
    },
    clouds: {
      width: 384, height: 256,
      scaleX: 0.0075, scaleY: 0.0075, scaleT: 0.1,
      octaves: 7, persistence: 0.62, lacunarity: 2.1, base: 3,
      colorMode: "gradient", gradientName: "grayscale",
      ...WARP_OFF, ...LAYER2_OFF, ...LOOP_DEFAULTS, loopDuration: 8,
    },
    terrain: {
      width: 384, height: 256,
      scaleX: 0.0085, scaleY: 0.0085, scaleT: 0.08,
      octaves: 6, persistence: 0.58, lacunarity: 2.1, base: 42,
      colorMode: "posterize", posterizeSteps: 8, gradientName: "forest",
      ...WARP_OFF, ...LAYER2_OFF, ...LOOP_DEFAULTS, loopDuration: 10,
    },
    circuit: {
      width: 384, height: 256,
      scaleX: 0.024, scaleY: 0.024, scaleT: 0.18,
      octaves: 4, persistence: 0.6, lacunarity: 2.8, base: 11,
      colorMode: "posterize", posterizeSteps: 5, gradientName: "ocean",
      ...WARP_OFF, ...LAYER2_OFF, ...LOOP_DEFAULTS, loopDuration: 3,
    },
    // Domain-warp showcase: chunky low-octave field gets pulled into
    // marble-vein swirls by a slower, stronger warp field. Warm earthy
    // gradient sells the stone look.
    marble: {
      width: 384, height: 256,
      scaleX: 0.012, scaleY: 0.012, scaleT: 0.1,
      octaves: 4, persistence: 0.55, lacunarity: 2.2, base: 31,
      warpStrength: 1.6, warpScale: 0.6,
      colorMode: "gradient", gradientName: "sunset",
      ...LAYER2_OFF, ...LOOP_DEFAULTS, loopDuration: 8,
    },
    // Per-channel-noise showcase: three independent noise fields drive
    // R / G / B separately. Warp adds vein-like coherence.
    nebula: {
      width: 384, height: 256,
      scaleX: 0.013, scaleY: 0.013, scaleT: 0.12,
      octaves: 5, persistence: 0.6, lacunarity: 2.2, base: 53,
      warpStrength: 1.3, warpScale: 0.7,
      colorMode: "rgb",
      rScale: 1.4, gScale: 0.55, bScale: 1.5,
      rInvert: false, gInvert: true, bInvert: false,
      rgbMultiChannel: true,
      ...LAYER2_OFF, ...LOOP_DEFAULTS, loopDuration: 9,
    },
    // Flow-field showcase: noise rendered as vector-field directions, so
    // the eye reads it as a storm front or a wind map. High gain pushes
    // even gentle gradients to readable saturation.
    flow: {
      width: 384, height: 256,
      scaleX: 0.02, scaleY: 0.02, scaleT: 0.1,
      octaves: 5, persistence: 0.5, lacunarity: 2.0, base: 23,
      ...WARP_OFF,
      colorMode: "flow",
      flowHueShift: 0.0, flowSat: 0.9, flowGain: 14, flowFloor: 0.24, flowEps: 0.5,
      ...LAYER2_OFF, ...LOOP_DEFAULTS, loopDuration: 6,
    },
    // Layer-2 showcase: slow rolling base + fine, denser second layer in
    // multiply blend. Reads like clouds with embossed contours. Composed
    // on the ice gradient for a frozen-pane look.
    composite: {
      width: 384, height: 256,
      scaleX: 0.008, scaleY: 0.008, scaleT: 0.1,
      octaves: 4, persistence: 0.5, lacunarity: 2.0, base: 17,
      ...WARP_OFF,
      layer2On: true,
      layer2ScaleX: 0.05, layer2ScaleY: 0.05,
      layer2Octaves: 5, layer2Base: 211,
      layer2BlendMode: "multiply", layer2Mix: 0.6,
      colorMode: "gradient", gradientName: "magma",
      ...LOOP_DEFAULTS, loopDuration: 7,
    },
  };

  /**
   * Returns a new, fully-resolved params object the engine/worker can consume.
   * For gradient/posterize modes with a named gradient but no explicit stops,
   * injects the concrete stop list (falling back to viridis for unknown
   * names). Never mutates the input.
   *
   * @param {Object} preset  A preset or params snapshot (may be partial)
   * @returns {Object} A shallow clone with `gradient` resolved when applicable
   */
  function resolveParams(preset) {
    const p = Object.assign({}, preset);
    const mode = p.colorMode;
    if (mode === "gradient" || mode === "posterize") {
      const hasStops = Array.isArray(p.gradient) && p.gradient.length >= 2;
      if (!hasStops) {
        p.gradient = GRADIENTS[p.gradientName] || GRADIENTS.viridis;
      }
    }
    if (mode === "cosine") {
      const q = p.cosine;
      const hasPalette = q && ["a", "b", "c", "d"].every((k) => Array.isArray(q[k]) && q[k].length >= 3);
      if (!hasPalette) p.cosine = COSINE_PALETTES[p.cosineName] || COSINE_PALETTES.rainbow;
    }
    return p;
  }

  root.MTPerlinPresets = { GRADIENTS, COSINE_PALETTES, BUILTIN_PRESETS, resolveParams };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { GRADIENTS, COSINE_PALETTES, BUILTIN_PRESETS, resolveParams };
  }
})(typeof window !== "undefined" ? window : globalThis);
