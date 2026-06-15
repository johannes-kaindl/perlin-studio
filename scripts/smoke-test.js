#!/usr/bin/env node
/**
 * scripts/smoke-test.js — math invariants for perlin.js.
 *
 * Catches the two bug classes called out in AGENTS.md:
 *   1. Float-rounding at loop endpoints (Math.sin(2π) ≈ -2.4e-16 → hash
 *      mask collapses to 255 → a completely different image).
 *   2. Z/W axis swap in `perlin4` (would leave the axes weakly coupled
 *      and break the loop closure).
 *
 * Loads perlin.js the same way AGENTS.md prescribes: stub `window`,
 * require, read the global it sets. No deps, no build.
 *
 * Run:   node scripts/smoke-test.js
 * Exit 0 on success, 1 on any failure.
 */
"use strict";

const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "perlin.js"));
const MT = global.window.MTPerlin;

let failed = 0;
function ok(label, cond, detail) {
  if (cond) {
    process.stdout.write("  ok   " + label + "\n");
  } else {
    failed++;
    process.stdout.write("  FAIL " + label + (detail ? " — " + detail : "") + "\n");
  }
}

// ----- A: Permutation determinism -----
{
  const a = MT.makePermutation(42);
  const b = MT.makePermutation(42);
  const c = MT.makePermutation(43);
  ok("permutation length is 512", a.length === 512, "got " + a.length);
  let aEqB = true, aEqC = true;
  for (let i = 0; i < 512; i++) {
    if (a[i] !== b[i]) aEqB = false;
    if (a[i] !== c[i]) aEqC = false;
  }
  ok("same seed produces identical permutation", aEqB);
  ok("different seed produces different permutation", !aEqC);
}

// ----- B: perlin3 / perlin4 value range -----
{
  // Deterministic sampling (seeded PRNG) so this range check is reproducible
  // and can never flake the deploy gate on a stray high sample — Math.random
  // occasionally drew a legitimate 4D peak just past the old ±1.05 bound.
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const perm = MT.makePermutation(7);
  const rnd = mulberry32(0x9e3779b9);
  let min3 = +Infinity, max3 = -Infinity;
  let min4 = +Infinity, max4 = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const x = rnd() * 50 - 25;
    const y = rnd() * 50 - 25;
    const z = rnd() * 50 - 25;
    const w = rnd() * 50 - 25;
    const n3 = MT.perlin3(perm, x, y, z);
    const n4 = MT.perlin4(perm, x, y, z, w);
    if (n3 < min3) min3 = n3; if (n3 > max3) max3 = n3;
    if (n4 < min4) min4 = n4; if (n4 > max4) max4 = n4;
  }
  // Improved Perlin noise sits near ±1, but 4D can legitimately peak a little
  // past it. This is a gross-corruption sanity check (a hash/masking bug
  // yields values orders of magnitude out), not a tight invariant — ±1.1
  // covers the real range with margin.
  ok("perlin3 stays inside [-1.1, 1.1]", min3 >= -1.1 && max3 <= 1.1,
     "range was [" + min3.toFixed(4) + ", " + max3.toFixed(4) + "]");
  ok("perlin4 stays inside [-1.1, 1.1]", min4 >= -1.1 && max4 <= 1.1,
     "range was [" + min4.toFixed(4) + ", " + max4.toFixed(4) + "]");
}

// ----- C: 4D loop identity (the safeProgress fix) -----
// generatePerlinImage at loopProgress=0 and loopProgress=1 must produce
// the exact same pixels. Without ((p % 1) + 1) % 1, sin(2π) ≈ -2.4e-16
// pushes the hash to 255 and yields a completely different image.
{
  const W = 16, H = 16;
  function mockCtx() {
    return {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      _img: null,
      putImageData(img) { this._img = img; },
    };
  }
  const params = {
    width: W, height: H, t: 0,
    scaleX: 0.05, scaleY: 0.05, scaleT: 0.15,
    octaves: 3, persistence: 0.5, lacunarity: 2.0, base: 11,
    loop: true, loopProgress: 0, loopRadius: 1.0,
    colorMode: "rgb",
    rScale: 1, gScale: 1, bScale: 1,
    rInvert: false, gInvert: false, bInvert: false,
  };
  const ctx0 = mockCtx();
  MT.generatePerlinImage(params, ctx0);
  params.loopProgress = 1;
  const ctx1 = mockCtx();
  MT.generatePerlinImage(params, ctx1);

  const a = ctx0._img.data, b = ctx1._img.data;
  let identical = a.length === b.length;
  let firstDiff = -1;
  for (let i = 0; identical && i < a.length; i++) {
    if (a[i] !== b[i]) { identical = false; firstDiff = i; }
  }
  ok("loopProgress=0 and loopProgress=1 produce identical frames", identical,
     firstDiff >= 0 ? "first diff at byte " + firstDiff + " (a=" + a[firstDiff] + " b=" + b[firstDiff] + ")" : "");

  // Sanity guard: confirm the comparison isn't trivially true (e.g. two
  // empty buffers). loopProgress=0.5 sits opposite on the circle and must
  // diverge meaningfully from loopProgress=0.
  params.loopProgress = 0.5;
  const ctxHalf = mockCtx();
  MT.generatePerlinImage(params, ctxHalf);
  const h = ctxHalf._img.data;
  let diffCount = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== h[i]) diffCount++;
  ok("loopProgress=0.5 actually differs from loopProgress=0", diffCount > a.length * 0.5,
     diffCount + "/" + a.length + " bytes differed");

  // Float-level loop identity: at progress=0 and progress=1 the (z, w)
  // input to perlin4 must be byte-equal, not just close. Without the
  // safeProgress wrap, sin(2π) leaks a ~-2.4e-16 into w. The image-level
  // check above misses this — the permutation table is mod-256 so
  // perm[256] === perm[0], masking the bytewise effect. The float check
  // catches future regressions where that masking might no longer hold.
  const perm = MT.makePermutation(11);
  const r = 0.15;
  function alphaFor(p) { const s = ((p % 1) + 1) % 1; return s * Math.PI * 2; }
  const a0 = alphaFor(0), a1 = alphaFor(1);
  const zw0 = [Math.cos(a0) * r, Math.sin(a0) * r];
  const zw1 = [Math.cos(a1) * r, Math.sin(a1) * r];
  ok("safeProgress yields bit-identical (z, w) at p=0 and p=1",
     zw0[0] === zw1[0] && zw0[1] === zw1[1],
     "p=0 → " + JSON.stringify(zw0) + ", p=1 → " + JSON.stringify(zw1));
  // And the noise value must match exactly across many sample points.
  let mismatches = 0, maxDelta = 0;
  for (let i = 0; i < 64; i++) {
    const x = (i % 8) * 0.31, y = Math.floor(i / 8) * 0.27;
    const v0 = MT.perlin4(perm, x, y, zw0[0], zw0[1]);
    const v1 = MT.perlin4(perm, x, y, zw1[0], zw1[1]);
    if (v0 !== v1) {
      mismatches++;
      maxDelta = Math.max(maxDelta, Math.abs(v0 - v1));
    }
  }
  ok("perlin4 at p=0 == perlin4 at p=1 across 64 grid points",
     mismatches === 0,
     mismatches + " mismatches, max delta " + maxDelta);
}

// ----- D: Z and W axes are independent -----
// perlin4 must respond to z and w separately. If the axes were swapped
// or collapsed in the hash tree, varying only z would give the same
// result as varying only w from the same base point.
{
  const perm = MT.makePermutation(3);
  const x = 1.7, y = 2.3, base = 0.5;
  let zVaries = 0, wVaries = 0, zwAgree = 0;
  for (let i = 1; i <= 12; i++) {
    const d = i * 0.13;
    const onlyZ = MT.perlin4(perm, x, y, base + d, base);
    const onlyW = MT.perlin4(perm, x, y, base, base + d);
    const ref   = MT.perlin4(perm, x, y, base, base);
    if (Math.abs(onlyZ - ref) > 1e-6) zVaries++;
    if (Math.abs(onlyW - ref) > 1e-6) wVaries++;
    if (Math.abs(onlyZ - onlyW) < 1e-9) zwAgree++;
  }
  ok("perlin4 responds to z-axis shifts", zVaries >= 10, zVaries + "/12 shifts moved the value");
  ok("perlin4 responds to w-axis shifts", wVaries >= 10, wVaries + "/12 shifts moved the value");
  ok("z and w shifts are not collinear", zwAgree <= 1, zwAgree + "/12 pairs were identical");
}

// ----- D2: domain warping regression + activation -----
// warpStrength=0 must produce bit-identical output to the un-warped fbm.
// That's the regression guard — adding the warp feature can't drift the
// default rendering by even one float.
{
  const perm = MT.makePermutation(17);
  let driftSamples = 0;
  let activeSamples = 0;
  for (let i = 0; i < 32; i++) {
    const x = (i * 0.41) % 10;
    const y = ((i + 5) * 0.27) % 10;
    const z = 0.3;

    const base3   = MT.fbm3(perm, x, y, z, 5, 0.5, 2.0);
    const warp0_3 = MT.warpedFbm3(perm, x, y, z, 5, 0.5, 2.0, 0, 1);
    const warp1_3 = MT.warpedFbm3(perm, x, y, z, 5, 0.5, 2.0, 0.8, 1);
    if (base3 !== warp0_3) driftSamples++;
    if (Math.abs(base3 - warp1_3) > 1e-9) activeSamples++;

    const base4   = MT.fbm4(perm, x, y, z, 0.1, 5, 0.5, 2.0);
    const warp0_4 = MT.warpedFbm4(perm, x, y, z, 0.1, 5, 0.5, 2.0, 0, 1);
    const warp1_4 = MT.warpedFbm4(perm, x, y, z, 0.1, 5, 0.5, 2.0, 0.8, 1);
    if (base4 !== warp0_4) driftSamples++;
    if (Math.abs(base4 - warp1_4) > 1e-9) activeSamples++;
  }
  ok("warpStrength=0 is bit-identical to plain fbm3/fbm4", driftSamples === 0,
     driftSamples + " of 64 samples drifted");
  ok("warpStrength>0 actually displaces the sample", activeSamples >= 60,
     activeSamples + "/64 samples moved");
}

// ----- E: colorize stays in 0–255 -----
{
  const params = {
    colorMode: "rgb",
    rScale: 1.0, gScale: 1.0, bScale: 1.0,
    rInvert: false, gInvert: false, bInvert: false,
  };
  let inRange = true, ex = null;
  for (let i = 0; i < 1000; i++) {
    const n = Math.random();
    const rgb = MT.colorize(n, params);
    if (rgb.length !== 3) { inRange = false; ex = "bad arity " + rgb.length; break; }
    for (const c of rgb) {
      if (!Number.isFinite(c) || c < 0 || c > 255) { inRange = false; ex = "got " + c; break; }
    }
    if (!inRange) break;
  }
  ok("colorize returns rgb in [0, 255]", inRange, ex || "");
}

// ----- F: colorizeRgbMulti + colorizeFlow stay in range -----
{
  const params = {
    rScale: 1.0, gScale: 1.0, bScale: 1.0,
    rInvert: false, gInvert: false, bInvert: false,
  };
  let multiOk = true, flowOk = true;
  for (let i = 0; i < 500; i++) {
    const rgb = MT.colorizeRgbMulti(Math.random(), Math.random(), Math.random(), params);
    for (const c of rgb) if (!Number.isFinite(c) || c < 0 || c > 255) { multiOk = false; break; }
    if (!multiOk) break;
    // Flow gets arbitrary signed dx/dy
    const flow = MT.colorizeFlow((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
                                  { flowSat: 0.8, flowGain: 4, flowFloor: 0.05 });
    for (const c of flow) if (!Number.isFinite(c) || c < 0 || c > 255) { flowOk = false; break; }
    if (!flowOk) break;
  }
  ok("colorizeRgbMulti returns rgb in [0, 255]", multiOk);
  ok("colorizeFlow returns rgb in [0, 255]", flowOk);
}

// ----- F2: tileable noise — seam closes, off path stays identical -----
// The reason this feature even ships: with repeatX=N, perlin3 must
// return the SAME value at (x) and (x + N). If the seam doesn't close,
// the tile fails visually. Test against multiple offsets along both
// axes plus into the negative range.
{
  const perm = MT.makePermutation(13);
  const N = 8;
  // repeat=0 baseline: function still returns same value as before the
  // tile refactor — sanity check that the new code path with repeat=0
  // is bit-identical to the un-tiled call.
  let baseDrift = 0;
  for (let i = 0; i < 32; i++) {
    const x = (i * 0.31), y = (i * 0.27), z = 0.3;
    const v0 = MT.perlin3(perm, x, y, z);
    const v0_explicit = MT.perlin3(perm, x, y, z, 0, 0);
    if (v0 !== v0_explicit) baseDrift++;
  }
  ok("perlin3 with repeat=0 is bit-identical to repeat-arg-omitted", baseDrift === 0);

  // X-axis tile identity. With repeat = N, value at (x, y, z) must
  // equal value at (x + N, y, z) and (x + 2N, y, z) and (x - N, y, z).
  let xSeam = 0, xExpected = 0;
  for (let i = 0; i < 24; i++) {
    const x = (i % 6) * 0.7 - 1.5;
    const y = (i * 0.41) % 10;
    const z = 0.5;
    const a = MT.perlin3(perm, x, y, z, N, 0);
    const b = MT.perlin3(perm, x + N, y, z, N, 0);
    const c = MT.perlin3(perm, x + 2 * N, y, z, N, 0);
    const d = MT.perlin3(perm, x - N, y, z, N, 0);
    xExpected += 3;
    if (Math.abs(a - b) < 1e-12) xSeam++;
    if (Math.abs(a - c) < 1e-12) xSeam++;
    if (Math.abs(a - d) < 1e-12) xSeam++;
  }
  ok("perlin3 tile-X seam closes (a == a + N == a + 2N == a - N)",
     xSeam === xExpected,
     xSeam + "/" + xExpected + " seam comparisons matched");

  // Y-axis tile identity.
  let ySeam = 0, yExpected = 0;
  for (let i = 0; i < 24; i++) {
    const x = (i * 0.41) % 10;
    const y = (i % 6) * 0.7 - 1.5;
    const z = 0.5;
    const a = MT.perlin3(perm, x, y, z, 0, N);
    const b = MT.perlin3(perm, x, y + N, z, 0, N);
    const c = MT.perlin3(perm, x, y + 2 * N, z, 0, N);
    const d = MT.perlin3(perm, x, y - N, z, 0, N);
    yExpected += 3;
    if (Math.abs(a - b) < 1e-12) ySeam++;
    if (Math.abs(a - c) < 1e-12) ySeam++;
    if (Math.abs(a - d) < 1e-12) ySeam++;
  }
  ok("perlin3 tile-Y seam closes",
     ySeam === yExpected,
     ySeam + "/" + yExpected + " seam comparisons matched");

  // Same checks for perlin4 (X/Y only — Z and W don't tile by design).
  let p4Seam = 0;
  for (let i = 0; i < 12; i++) {
    const x = (i * 0.31) - 1, y = (i * 0.19), z = 0.5, w = 0.7;
    const a = MT.perlin4(perm, x, y, z, w, N, N);
    const b = MT.perlin4(perm, x + N, y, z, w, N, N);
    const c = MT.perlin4(perm, x, y + N, z, w, N, N);
    if (Math.abs(a - b) < 1e-12) p4Seam++;
    if (Math.abs(a - c) < 1e-12) p4Seam++;
  }
  ok("perlin4 tile seam closes on X and Y", p4Seam === 24,
     p4Seam + "/24 seam comparisons matched");

  // fbm3 inherits tile identity from perlin3 across all octaves, as
  // long as lacunarity is integer (default 2) so each octave's wrap
  // lands on an integer cell.
  let fbmSeam = 0;
  for (let i = 0; i < 12; i++) {
    const x = (i * 0.41), y = (i * 0.37), z = 0.5;
    const a = MT.fbm3(perm, x, y, z, 5, 0.5, 2.0, N, 0);
    const b = MT.fbm3(perm, x + N, y, z, 5, 0.5, 2.0, N, 0);
    if (Math.abs(a - b) < 1e-12) fbmSeam++;
  }
  ok("fbm3 tile seam closes across octaves (lacunarity=2)",
     fbmSeam === 12,
     fbmSeam + "/12 fbm samples matched at the seam");

  // warpedFbm3 must also tile, otherwise warp on a tile breaks the seam.
  let warpSeam = 0;
  for (let i = 0; i < 12; i++) {
    const x = (i * 0.41), y = (i * 0.37), z = 0.5;
    const a = MT.warpedFbm3(perm, x, y, z, 5, 0.5, 2.0, 1.2, 0.7, N, 0);
    const b = MT.warpedFbm3(perm, x + N, y, z, 5, 0.5, 2.0, 1.2, 0.7, N, 0);
    if (Math.abs(a - b) < 1e-12) warpSeam++;
  }
  ok("warpedFbm3 tile seam closes with warp on",
     warpSeam === 12,
     warpSeam + "/12 warped samples matched at the seam");
}

// ----- G: render-loop branches differ (per-channel + flow) -----
// Sanity check that flipping rgbMultiChannel and colorMode actually
// reaches different render paths — otherwise the new sample loops
// could silently be no-ops.
{
  const W = 16, H = 16;
  function mockCtx() {
    return {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      _img: null,
      putImageData(img) { this._img = img; },
    };
  }
  const baseParams = {
    width: W, height: H, t: 0,
    scaleX: 0.04, scaleY: 0.04, scaleT: 0.15,
    octaves: 3, persistence: 0.5, lacunarity: 2.0, base: 41,
    loop: true, loopProgress: 0.2, loopRadius: 1.0,
    colorMode: "rgb",
    rScale: 1, gScale: 1, bScale: 1,
    rInvert: false, gInvert: false, bInvert: false,
  };
  const ctxSingle = mockCtx();
  MT.generatePerlinImage({ ...baseParams, rgbMultiChannel: false }, ctxSingle);
  const ctxMulti = mockCtx();
  MT.generatePerlinImage({ ...baseParams, rgbMultiChannel: true }, ctxMulti);
  let diffMulti = 0;
  for (let i = 0; i < ctxSingle._img.data.length; i++) {
    if (ctxSingle._img.data[i] !== ctxMulti._img.data[i]) diffMulti++;
  }
  ok("rgbMultiChannel=true diverges from single-noise RGB",
     diffMulti > (W * H * 4) * 0.4,
     diffMulti + "/" + (W * H * 4) + " bytes differed");

  const ctxFlow = mockCtx();
  MT.generatePerlinImage({
    ...baseParams,
    colorMode: "flow",
    flowSat: 0.85, flowGain: 5, flowFloor: 0.05, flowEps: 0.6,
  }, ctxFlow);
  let diffFlow = 0;
  for (let i = 0; i < ctxSingle._img.data.length; i++) {
    if (ctxSingle._img.data[i] !== ctxFlow._img.data[i]) diffFlow++;
  }
  ok("colorMode='flow' diverges from rgb",
     diffFlow > (W * H * 4) * 0.5,
     diffFlow + "/" + (W * H * 4) + " bytes differed");
}

// ----- H0: blendLayers — each blend mode has the right algebra -----
{
  const eps = 1e-12;
  const close = (a, b) => Math.abs(a - b) < eps;
  ok("multiply: 0.5 × 0.4 = 0.2", close(MT.blendLayers(0.5, 0.4, "multiply"), 0.2));
  ok("add clamps at 1 (0.6 + 0.5 → 1)", close(MT.blendLayers(0.6, 0.5, "add"), 1));
  ok("add below 1 stays linear (0.3 + 0.4 = 0.7)", close(MT.blendLayers(0.3, 0.4, "add"), 0.7));
  ok("screen: 1 − (1 − 0.5)(1 − 0.4) = 0.7", close(MT.blendLayers(0.5, 0.4, "screen"), 0.7));
  ok("darken: min(0.5, 0.3) = 0.3", close(MT.blendLayers(0.5, 0.3, "darken"), 0.3));
  ok("lighten: max(0.5, 0.3) = 0.5", close(MT.blendLayers(0.5, 0.3, "lighten"), 0.5));
  ok("difference: |0.7 − 0.3| = 0.4", close(MT.blendLayers(0.7, 0.3, "difference"), 0.4));
  // Unknown blend mode falls back to "Layer 2 ignored" → return n1.
  ok("unknown blend mode returns n1", close(MT.blendLayers(0.5, 0.4, "rubberduck"), 0.5));
}

// ----- H1: layer2On = false produces same output as no layer at all -----
{
  const W = 16, H = 16;
  function mockCtx() {
    return {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      _img: null,
      putImageData(img) { this._img = img; },
    };
  }
  const base = {
    width: W, height: H, t: 0,
    scaleX: 0.04, scaleY: 0.04, scaleT: 0.15,
    octaves: 3, persistence: 0.5, lacunarity: 2.0, base: 53,
    loop: true, loopProgress: 0.3, loopRadius: 1.0,
    colorMode: "rgb",
    rScale: 1, gScale: 1, bScale: 1,
    rInvert: false, gInvert: false, bInvert: false,
  };
  const ctx0 = mockCtx();
  MT.generatePerlinImage(base, ctx0);
  const ctxOff = mockCtx();
  MT.generatePerlinImage({
    ...base, layer2On: false, layer2BlendMode: "multiply", layer2Mix: 1.0,
    layer2ScaleX: 0.05, layer2ScaleY: 0.05, layer2Octaves: 3, layer2Base: 99,
  }, ctxOff);
  let drift = 0;
  for (let i = 0; i < ctx0._img.data.length; i++) {
    if (ctx0._img.data[i] !== ctxOff._img.data[i]) drift++;
  }
  ok("layer2On=false is bit-identical to the un-layered baseline", drift === 0,
     drift + " bytes drifted");

  // And with layer2On=true + mix > 0 the output MUST diverge.
  const ctxOn = mockCtx();
  MT.generatePerlinImage({
    ...base, layer2On: true, layer2BlendMode: "multiply", layer2Mix: 1.0,
    layer2ScaleX: 0.06, layer2ScaleY: 0.06, layer2Octaves: 4, layer2Base: 101,
  }, ctxOn);
  let differ = 0;
  for (let i = 0; i < ctx0._img.data.length; i++) {
    if (ctx0._img.data[i] !== ctxOn._img.data[i]) differ++;
  }
  ok("layer2On=true with mix=1 actually composes a second field",
     differ > (W * H * 4) * 0.4,
     differ + " bytes differed");

  // mix = 0 short-circuits: even with layer2On = true, the output stays
  // on the un-layered baseline because (1−mix) = 1 keeps only n1.
  const ctxMix0 = mockCtx();
  MT.generatePerlinImage({
    ...base, layer2On: true, layer2BlendMode: "multiply", layer2Mix: 0,
    layer2ScaleX: 0.06, layer2ScaleY: 0.06, layer2Octaves: 4, layer2Base: 101,
  }, ctxMix0);
  let mix0Drift = 0;
  for (let i = 0; i < ctx0._img.data.length; i++) {
    if (ctx0._img.data[i] !== ctxMix0._img.data[i]) mix0Drift++;
  }
  ok("layer2 mix=0 short-circuits to the un-layered output", mix0Drift === 0);
}

// ----- H: image-mask alpha math (controller-side helper, sanity-only) -----
// The mask helper itself lives in perlin-studio.js, but its core
// behaviour — "set alpha = mask byte, optionally inverted" — is just
// per-pixel byte arithmetic. Reproduce it here without DOM dependencies
// to lock the invariant.
{
  function applyMaskByteArith(data, mask, invert) {
    const out = data.slice();
    for (let i = 0; i < mask.length; i++) {
      out[i * 4 + 3] = invert ? 255 - mask[i] : mask[i];
    }
    return out;
  }
  const data = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 255,
    70, 80, 90, 255,
    100, 110, 120, 255,
  ]);
  const mask = new Uint8Array([0, 128, 255, 200]);
  const masked = applyMaskByteArith(data, mask, false);
  const inverted = applyMaskByteArith(data, mask, true);
  ok("mask copies mask bytes into alpha channel",
     masked[3] === 0 && masked[7] === 128 && masked[11] === 255 && masked[15] === 200);
  ok("mask invert flips bytes via 255 − mask",
     inverted[3] === 255 && inverted[7] === 127 && inverted[11] === 0 && inverted[15] === 55);
  ok("mask leaves RGB channels untouched",
     masked[0] === 10 && masked[5] === 50 && masked[10] === 90);
}

// ----- I: resolveParams (perlin-presets.js) -----
// The shared presets module is what both the studio and the <perlin-noise>
// element use to turn a preset into a renderable params object. The key
// invariant: a named gradient must be expanded to concrete stops before the
// params reach the worker, without mutating the caller's object.
{
  const P = require(path.join(__dirname, "..", "perlin-presets.js"));
  const { GRADIENTS, BUILTIN_PRESETS, resolveParams } = P;

  const fire = resolveParams({ colorMode: "gradient", gradientName: "fire" });
  ok("resolveParams injects named gradient stops (fire)",
     Array.isArray(fire.gradient) && JSON.stringify(fire.gradient) === JSON.stringify(GRADIENTS.fire));

  const post = resolveParams({ colorMode: "posterize", gradientName: "ocean" });
  ok("resolveParams resolves a gradient for posterize mode",
     Array.isArray(post.gradient) && post.gradient.length >= 2);

  const stops = [{ pos: 0, color: [1, 2, 3] }, { pos: 1, color: [4, 5, 6] }];
  const custom = resolveParams({ colorMode: "gradient", gradientName: "custom", gradient: stops });
  ok("resolveParams preserves explicit custom stops",
     JSON.stringify(custom.gradient) === JSON.stringify(stops));

  const input = { colorMode: "rgb", rScale: 1 };
  const rgb = resolveParams(input);
  ok("resolveParams leaves non-gradient modes without a gradient", rgb.gradient === undefined);
  ok("resolveParams does not mutate its input", input.gradient === undefined && rgb !== input);

  const unknown = resolveParams({ colorMode: "gradient", gradientName: "nope" });
  ok("resolveParams falls back to viridis for unknown gradient names",
     JSON.stringify(unknown.gradient) === JSON.stringify(GRADIENTS.viridis));

  const lava = resolveParams(BUILTIN_PRESETS.lava);
  ok("a built-in preset (lava) resolves to a renderable params object",
     Array.isArray(lava.gradient));
}

// ----- EXPORT: computeFitRect -----
global.window = global.window || {};
require(path.join(__dirname, "..", "perlin-export.js"));
const EX = global.window.MTPerlinExport;
{
  // cover: 100x100 into 200x100 -> scale 2 -> 200x200, centered vertically (y = -50)
  const cov = EX.computeFitRect(100, 100, 200, 100, "cover");
  ok("computeFitRect cover w", cov.w === 200, "got " + cov.w);
  ok("computeFitRect cover h", cov.h === 200, "got " + cov.h);
  ok("computeFitRect cover x centered", cov.x === 0, "got " + cov.x);
  ok("computeFitRect cover y centered", cov.y === -50, "got " + cov.y);
  // contain: 100x100 into 200x100 -> scale 1 -> 100x100, centered horizontally (x = 50)
  const con = EX.computeFitRect(100, 100, 200, 100, "contain");
  ok("computeFitRect contain w", con.w === 100, "got " + con.w);
  ok("computeFitRect contain h", con.h === 100, "got " + con.h);
  ok("computeFitRect contain x centered", con.x === 50, "got " + con.x);
  ok("computeFitRect contain y centered", con.y === 0, "got " + con.y);
}

// ----- EXPORT: hexToRgb -----
{
  const c = EX.hexToRgb("#0a0a18");
  ok("hexToRgb r", c[0] === 10, "got " + c[0]);
  ok("hexToRgb g", c[1] === 10, "got " + c[1]);
  ok("hexToRgb b", c[2] === 24, "got " + c[2]);
}

// ----- EXPORT: compositeOverColor -----
{
  // One pixel, straight alpha. noise=[200,100,50] @ a=128 over bg black.
  // out = round(noise * a/255 + bg * (1 - a/255)); a_out = 255.
  const noise = new Uint8ClampedArray([200, 100, 50, 128]);
  const out = EX.compositeOverColor(noise, [0, 0, 0]);
  ok("compositeOverColor r", out[0] === Math.round(200 * 128 / 255), "got " + out[0]);
  ok("compositeOverColor g", out[1] === Math.round(100 * 128 / 255), "got " + out[1]);
  ok("compositeOverColor b", out[2] === Math.round(50 * 128 / 255), "got " + out[2]);
  ok("compositeOverColor opaque", out[3] === 255, "got " + out[3]);

  // alpha=0 -> pure background; alpha=255 -> pure noise.
  const bgOnly = EX.compositeOverColor(new Uint8ClampedArray([200, 100, 50, 0]), [12, 34, 56]);
  ok("compositeOverColor a=0 is bg", bgOnly[0] === 12 && bgOnly[1] === 34 && bgOnly[2] === 56);
  const fg = EX.compositeOverColor(new Uint8ClampedArray([200, 100, 50, 255]), [12, 34, 56]);
  ok("compositeOverColor a=255 is noise", fg[0] === 200 && fg[1] === 100 && fg[2] === 50);

  // Does not mutate the input.
  const inp = new Uint8ClampedArray([9, 9, 9, 100]);
  EX.compositeOverColor(inp, [0, 0, 0]);
  ok("compositeOverColor is pure", inp[0] === 9 && inp[3] === 100);
}

console.log("");
if (failed === 0) {
  console.log("smoke tests: all passed");
  process.exit(0);
} else {
  console.log("smoke tests: " + failed + " failed");
  process.exit(1);
}
