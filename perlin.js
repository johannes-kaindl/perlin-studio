/**
 * perlin.js — Ken Perlin's "Improved Noise" in 3D and 4D, fBm, and color modes.
 *
 * Vanilla JS, no dependencies. An IIFE exports to `window.MTPerlin`.
 * The whole module is also available as a string under `MTPerlin.WORKER_SOURCE`,
 * so it can be loaded 1:1 into a Web Worker (Blob URL) — essential for the
 * smooth animation in the studio.
 *
 * Public API (`window.MTPerlin`):
 *   - `makePermutation(base)` → Uint8Array(512) — seeded permutation
 *   - `perlin3(perm, x, y, z)` → value in roughly [-1, 1]
 *   - `perlin4(perm, x, y, z, w)` → value in roughly [-1, 1]
 *   - `fbm3(perm, x, y, z, octaves, persistence, lacunarity)` → value in [0, 1]
 *   - `fbm4(perm, x, y, z, w, octaves, persistence, lacunarity)` → value in [0, 1]
 *   - `generatePerlinImage(params, ctx)` renders via the 3D/4D path into a canvas ctx
 *   - `colorize(noiseValue, params)` → `[r, g, b]` in 0–255
 *   - `WORKER_SOURCE` — full module code as a string for inline workers
 *
 * Color modes (`params.colorMode`):
 *   - `"rgb"`       per-channel scale + invert (default, like the Python original)
 *   - `"gradient"`  color stops `[{pos:0..1, color:[r,g,b]}, ...]`, linearly interpolated
 *   - `"hsv"`       noise → hue, hsvSat/hsvVal as constants
 *   - `"posterize"` noise quantised to N steps, then mapped onto a gradient
 *
 * Animation loop (`params.loop = true`):
 *   Instead of running linearly through the time axis, the 4D noise traces a
 *   circular orbit in `(z, w) = (cos(α)·r, sin(α)·r)`. After one full
 *   revolution (α = 2π), z and w match the starting position
 *   → a mathematically seamless loop.
 *
 * @license AGPL-3.0-or-later
 */
(function () {
  "use strict";

  const BASE_PERM = [
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
    8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
    35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
    134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
    55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
    18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,
    226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,
    17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,
    167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,
    246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,
    14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,
    150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,
    180
  ];

  /**
   * Builds a seeded permutation table for Perlin noise.
   * Shifts the classic `BASE_PERM` deterministically by `base` steps so every
   * integer seed produces a distinct noise field. The table is duplicated
   * (512 entries) so `perm[i + 1]` lookups avoid a modulo — faster in the
   * inner render loop.
   *
   * @param {number} base  Seed (any integer)
   * @returns {Uint8Array} 512 bytes, the permutation table
   */
  function makePermutation(base) {
    const offset = ((base | 0) % 256 + 256) % 256;
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) perm[i] = BASE_PERM[(i + offset) & 255];
    for (let i = 256; i < 512; i++) perm[i] = perm[i - 256];
    return perm;
  }

  // Ken Perlin's "fade" polynomial 6t⁵ − 15t⁴ + 10t³: enforces C² continuity
  // at grid points (first and second derivative are zero there).

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  /**
   * 3D Perlin noise (Improved Noise, Ken Perlin 2002).
   * Value range roughly `[-0.88, 0.88]`. At grid points (integer
   * coordinates) it's exactly 0 — by design, not a bug.
   *
   * @param {Uint8Array} perm  Permutation from `makePermutation`
   * @param {number} x  Coordinate (arbitrary)
   * @param {number} y
   * @param {number} z
   * @returns {number}  Noise value in roughly `[-1, 1]`
   */
  // Wrap an integer cell index for tileable noise. `period=0` falls back
  // to the classic `& 255` infinite-noise behaviour — bit-identical to
  // the pre-tileable code, that's the regression guarantee.
  function wrapCell(v, period) {
    return period > 0 ? (((v % period) + period) % period) & 255 : v & 255;
  }
  function nextCell(v, period) {
    return period > 0 ? ((((v + 1) % period) + period) % period) & 255 : (v + 1) & 255;
  }

  function perlin3(perm, x, y, z, repeatX, repeatY) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const rx = repeatX || 0;
    const ry = repeatY || 0;
    const Xa = wrapCell(xi, rx), Xb = nextCell(xi, rx);
    const Ya = wrapCell(yi, ry), Yb = nextCell(yi, ry);
    const Za = zi & 255,         Zb = (zi + 1) & 255;
    x -= xi; y -= yi; z -= zi;
    const u = fade(x), v = fade(y), w = fade(z);

    // Eight-corner hash, written with explicit X/Y wrap so the tile
    // closes seamlessly. (Z does not tile — loop mode uses tiny Z and
    // doesn't benefit from spatial tiling on the time axis.)
    const Aa = perm[Xa] + Ya, Ab = perm[Xa] + Yb;
    const Ba = perm[Xb] + Ya, Bb = perm[Xb] + Yb;
    const Aa0 = perm[Aa] + Za, Aa1 = perm[Aa] + Zb;
    const Ab0 = perm[Ab] + Za, Ab1 = perm[Ab] + Zb;
    const Ba0 = perm[Ba] + Za, Ba1 = perm[Ba] + Zb;
    const Bb0 = perm[Bb] + Za, Bb1 = perm[Bb] + Zb;

    return lerp(
      lerp(
        lerp(grad(perm[Aa0], x,     y,     z),     grad(perm[Ba0], x - 1, y,     z),     u),
        lerp(grad(perm[Ab0], x,     y - 1, z),     grad(perm[Bb0], x - 1, y - 1, z),     u),
        v
      ),
      lerp(
        lerp(grad(perm[Aa1], x,     y,     z - 1), grad(perm[Ba1], x - 1, y,     z - 1), u),
        lerp(grad(perm[Ab1], x,     y - 1, z - 1), grad(perm[Bb1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  /**
   * fBm (Fractal Brownian Motion) on top of `perlin3`.
   * Sums several octaves with progressively higher frequency and smaller
   * amplitude. Normalised to `[0, 1]`.
   *
   * @param {Uint8Array} perm
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} octaves      Octave count (1–10 is sensible)
   * @param {number} persistence  Amplitude factor per octave (0.5 = standard)
   * @param {number} lacunarity   Frequency factor per octave (2.0 = standard)
   * @returns {number} Value in `[0, 1]`
   */
  function fbm3(perm, x, y, z, octaves, persistence, lacunarity, repeatX, repeatY) {
    const rx0 = repeatX || 0;
    const ry0 = repeatY || 0;
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      // Tile period scales with octave frequency so all octaves agree on
      // where the seam is. Rounded to the nearest integer cell — small
      // mismatch for non-integer lacunarity is unavoidable, but with the
      // default lacunarity = 2 every octave lands on an integer multiple.
      const rx = rx0 > 0 ? Math.round(rx0 * freq) : 0;
      const ry = ry0 > 0 ? Math.round(ry0 * freq) : 0;
      sum  += amp * perlin3(perm, x * freq, y * freq, z * freq, rx, ry);
      norm += amp;
      amp  *= persistence;
      freq *= lacunarity;
    }
    const n = norm > 0 ? sum / norm : 0;
    return (n + 1) * 0.5;
  }

  // ---------- 4D NOISE (for loopable animation) ----------
  // 32 4D gradient vectors from Ken Perlin's Improved Noise reference (Java).
  // Each of the 16 corners of a 4D hypercube gets one of these gradients via
  // a hash; the dot product with the offset vector gives that corner's
  // contribution. A circular path in (z, w) yields a perfectly seamless loop
  // because cos/sin return to the starting position after 2π.
  const GRAD4 = [
    [0,1,1,1],  [0,1,1,-1],  [0,1,-1,1],  [0,1,-1,-1],
    [0,-1,1,1], [0,-1,1,-1], [0,-1,-1,1], [0,-1,-1,-1],
    [1,0,1,1],  [1,0,1,-1],  [1,0,-1,1],  [1,0,-1,-1],
    [-1,0,1,1], [-1,0,1,-1], [-1,0,-1,1], [-1,0,-1,-1],
    [1,1,0,1],  [1,1,0,-1],  [1,-1,0,1],  [1,-1,0,-1],
    [-1,1,0,1], [-1,1,0,-1], [-1,-1,0,1], [-1,-1,0,-1],
    [1,1,1,0],  [1,1,-1,0],  [1,-1,1,0],  [1,-1,-1,0],
    [-1,1,1,0], [-1,1,-1,0], [-1,-1,1,0], [-1,-1,-1,0],
  ];

  function grad4(hash, x, y, z, w) {
    const g = GRAD4[hash & 31];
    return g[0] * x + g[1] * y + g[2] * z + g[3] * w;
  }

  /**
   * 4D Perlin noise. Same idea as `perlin3`, but with 16 hypercube corners
   * and a 4-deep nested lerp. The studio only uses it for loop mode: a
   * circular orbit in `(z, w)` closes seamlessly.
   *
   * @param {Uint8Array} perm
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} w
   * @returns {number} Noise value in roughly `[-1, 1]`
   */
  function perlin4(perm, x, y, z, w, repeatX, repeatY) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), wi = Math.floor(w);
    const rx = repeatX || 0;
    const ry = repeatY || 0;
    const Xa = wrapCell(xi, rx), Xb = nextCell(xi, rx);
    const Ya = wrapCell(yi, ry), Yb = nextCell(yi, ry);
    const Za = zi & 255,         Zb = (zi + 1) & 255;
    const Wa = wi & 255,         Wb = (wi + 1) & 255;
    x -= xi; y -= yi; z -= zi; w -= wi;
    const u = fade(x), v = fade(y), s = fade(z), tt = fade(w);

    // Hash tree along X → Y → Z → W. Suffixes: a/b = low/high cell per axis,
    // chosen explicitly so X and Y can wrap for tileability while Z and W
    // pass through unchanged. The internal +1 lookups still go through the
    // duplicated perm table; only the X / Y entry points are wrap-aware.
    const Aa  = perm[Xa] + Ya;
    const Ab  = perm[Xa] + Yb;
    const Ba  = perm[Xb] + Ya;
    const Bb  = perm[Xb] + Yb;
    const AA  = perm[Aa] + Za;
    const AB  = perm[Ab] + Za;
    const BA  = perm[Ba] + Za;
    const BB  = perm[Bb] + Za;
    const AAA = perm[AA] + Wa, AAB = perm[AA + 1] + Wa;
    const ABA = perm[AB] + Wa, ABB = perm[AB + 1] + Wa;
    const BAA = perm[BA] + Wa, BAB = perm[BA + 1] + Wa;
    const BBA = perm[BB] + Wa, BBB = perm[BB + 1] + Wa;

    // 16 corners → 4-deep nested lerp.
    // Hash convention: AAB = Z shift (perm[AA+1]+W), AAA+1 = W shift (perm[AA]+W+1).
    // → Offsets must line up: AAB uses z-1, AAA+1 uses w-1.
    // Lerp order from inside out: u (X) → v (Y) → s (Z) → tt (W).
    return lerp(
      // W-low half
      lerp(
        // Z-low
        lerp(
          lerp(grad4(perm[AAA],     x,     y,     z,     w), grad4(perm[BAA],     x - 1, y,     z,     w),     u),
          lerp(grad4(perm[ABA],     x,     y - 1, z,     w), grad4(perm[BBA],     x - 1, y - 1, z,     w),     u),
          v
        ),
        // Z-high  (AAB = perm[AA+1]+W is a Z shift → offset z-1, w stays)
        lerp(
          lerp(grad4(perm[AAB],     x,     y,     z - 1, w), grad4(perm[BAB],     x - 1, y,     z - 1, w),     u),
          lerp(grad4(perm[ABB],     x,     y - 1, z - 1, w), grad4(perm[BBB],     x - 1, y - 1, z - 1, w),     u),
          v
        ),
        s
      ),
      // W-high half  (AAA+1 is a W shift → offset w-1, z stays)
      lerp(
        // Z-low
        lerp(
          lerp(grad4(perm[AAA + 1], x,     y,     z,     w - 1), grad4(perm[BAA + 1], x - 1, y,     z,     w - 1), u),
          lerp(grad4(perm[ABA + 1], x,     y - 1, z,     w - 1), grad4(perm[BBA + 1], x - 1, y - 1, z,     w - 1), u),
          v
        ),
        // Z-high  (AAB+1 = (Z shift)+1 = Z and W shift combined → offset z-1, w-1)
        lerp(
          lerp(grad4(perm[AAB + 1], x,     y,     z - 1, w - 1), grad4(perm[BAB + 1], x - 1, y,     z - 1, w - 1), u),
          lerp(grad4(perm[ABB + 1], x,     y - 1, z - 1, w - 1), grad4(perm[BBB + 1], x - 1, y - 1, z - 1, w - 1), u),
          v
        ),
        s
      ),
      tt
    );
  }

  /** fBm on top of `perlin4`. Value range `[0, 1]`. */
  function fbm4(perm, x, y, z, w, octaves, persistence, lacunarity, repeatX, repeatY) {
    const rx0 = repeatX || 0;
    const ry0 = repeatY || 0;
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const rx = rx0 > 0 ? Math.round(rx0 * freq) : 0;
      const ry = ry0 > 0 ? Math.round(ry0 * freq) : 0;
      sum  += amp * perlin4(perm, x * freq, y * freq, z * freq, w * freq, rx, ry);
      norm += amp;
      amp  *= persistence;
      freq *= lacunarity;
    }
    const n = norm > 0 ? sum / norm : 0;
    return (n + 1) * 0.5;
  }

  // ---------- DOMAIN WARPING ----------
  // Inigo-Quilez-style domain warp: displace the sample coordinate by a
  // second, smoother noise field before running the main fbm. Tiny code,
  // huge visual change — Perlin output stops looking like "Perlin" and
  // starts looking like marble veins, ink in water, alien terrain.
  //
  // The displacement uses single-octave `perlin3/4` (not fbm) — cheap,
  // smooth, and detail isn't useful in the warp field. Two arbitrary
  // offsets (137/23 and 211/-53) decorrelate the x and y displacements
  // from each other and from the main field, otherwise you'd get
  // diagonal streaking.
  //
  // `warpStrength=0` skips the warp entirely → byte-identical output to
  // the un-warped fbm path. That's the regression guarantee.

  // When tile is on AND warp is on, warpScale must be integer for the
  // tile to actually close — the warp samples in (x*s + offset) space,
  // so for the seam to coincide we need (tileWidth * s) to be an integer
  // multiple of the warp's wrap period. The simplest correctness-first
  // rule: round warpScale to the nearest non-zero integer whenever both
  // features are co-active. Outside this case the user keeps the full
  // sub-1.0 fidelity of the warp.
  function effectiveWarpScale(warpScale, repeatX, repeatY) {
    const s = warpScale || 1;
    if ((repeatX > 0 || repeatY > 0) && warpScale) return Math.max(1, Math.round(s));
    return s;
  }

  function warpedFbm3(perm, x, y, z, octaves, persistence, lacunarity, warpStrength, warpScale, repeatX, repeatY) {
    if (!warpStrength) return fbm3(perm, x, y, z, octaves, persistence, lacunarity, repeatX, repeatY);
    const s = effectiveWarpScale(warpScale, repeatX, repeatY);
    // Warp's perlin3 wraps at (tile * s) so the seam in main space coincides.
    // With integer s (guaranteed above when tile is on), this is always integer.
    const wrx = repeatX > 0 ? repeatX * s : 0;
    const wry = repeatY > 0 ? repeatY * s : 0;
    const dx = perlin3(perm, x * s + 137.0, y * s +  23.0, z, wrx, wry) * warpStrength;
    const dy = perlin3(perm, x * s + 211.0, y * s -  53.0, z, wrx, wry) * warpStrength;
    return fbm3(perm, x + dx, y + dy, z, octaves, persistence, lacunarity, repeatX, repeatY);
  }

  function warpedFbm4(perm, x, y, z, w, octaves, persistence, lacunarity, warpStrength, warpScale, repeatX, repeatY) {
    if (!warpStrength) return fbm4(perm, x, y, z, w, octaves, persistence, lacunarity, repeatX, repeatY);
    const s = effectiveWarpScale(warpScale, repeatX, repeatY);
    const wrx = repeatX > 0 ? repeatX * s : 0;
    const wry = repeatY > 0 ? repeatY * s : 0;
    const dx = perlin4(perm, x * s + 137.0, y * s +  23.0, z, w, wrx, wry) * warpStrength;
    const dy = perlin4(perm, x * s + 211.0, y * s -  53.0, z, w, wrx, wry) * warpStrength;
    return fbm4(perm, x + dx, y + dy, z, w, octaves, persistence, lacunarity, repeatX, repeatY);
  }

  // ---------- LAYER BLENDING ----------
  // Composite two noise samples in [0, 1] with one of a few classic
  // blend modes. The studio uses these to stack a second noise field
  // ("Layer 2") on top of the main one — e.g. fine grain over slow
  // rolling hills, or a contour grid multiplied with a colour field.
  // All modes return a value in [0, 1] so the downstream `colorize`
  // pipeline is unchanged.

  function blendLayers(n1, n2, mode) {
    if (mode === "multiply") return n1 * n2;
    if (mode === "add")      return n1 + n2 > 1 ? 1 : n1 + n2;
    if (mode === "screen")   return 1 - (1 - n1) * (1 - n2);
    if (mode === "darken")   return n1 < n2 ? n1 : n2;
    if (mode === "lighten")  return n1 > n2 ? n1 : n2;
    if (mode === "difference") {
      const d = n1 - n2;
      return d < 0 ? -d : d;
    }
    return n1; // unknown mode — Layer 2 ignored
  }

  // ---------- COLOR MODES ----------

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // Linear interpolation over a gradient-stop list.
  // stops: [{pos: 0..1, color: [r,g,b]}, ...] sorted by pos.
  function gradientLookup(stops, t) {
    t = clamp01(t);
    if (stops.length === 0) return [0, 0, 0];
    if (stops.length === 1) return stops[0].color.slice();
    if (t <= stops[0].pos) return stops[0].color.slice();
    const last = stops[stops.length - 1];
    if (t >= last.pos) return last.color.slice();
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      if (t <= b.pos) {
        const span = b.pos - a.pos;
        const u = span > 0 ? (t - a.pos) / span : 0;
        return [
          Math.round(a.color[0] + (b.color[0] - a.color[0]) * u),
          Math.round(a.color[1] + (b.color[1] - a.color[1]) * u),
          Math.round(a.color[2] + (b.color[2] - a.color[2]) * u),
        ];
      }
    }
    return last.color.slice();
  }

  // HSV → RGB, h in [0,1), s/v in [0,1]
  function hsvToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // ---------- RGB MULTI-CHANNEL (per-channel offset noise) ----------
  // When the studio's RGB mode runs in "multi-channel" mode, three
  // independent noise samples (taken at offset positions, but from the
  // same permutation) feed the R / G / B channels separately. The result:
  // colour channels drift independently, producing nebula-/film-grain-
  // like outputs that the single-noise RGB mode can't reach.

  function colorizeRgbMulti(nr, ng, nb, p) {
    const r = (p.rInvert ? 1 - nr : nr) * (p.rScale ?? 1);
    const g = (p.gInvert ? 1 - ng : ng) * (p.gScale ?? 1);
    const b = (p.bInvert ? 1 - nb : nb) * (p.bScale ?? 1);
    return [
      Math.max(0, Math.min(255, Math.round(r * 255))),
      Math.max(0, Math.min(255, Math.round(g * 255))),
      Math.max(0, Math.min(255, Math.round(b * 255))),
    ];
  }

  // ---------- FLOW FIELD ----------
  // Instead of mapping the noise *value* to colour, map the local
  // *gradient direction* — i.e. visualise the noise as a vector field.
  // Hue = atan2(dy, dx); magnitude tints brightness. Renders Perlin as
  // a flow chart of how it'd push a particle around. The render loops
  // sample a 3-point stencil per pixel and pass dx / dy here.

  function colorizeFlow(dx, dy, p) {
    const angle = Math.atan2(dy, dx); // (-π, π]
    // Map angle to hue with an optional shift so users can rotate the
    // colour wheel. (angle/(2π) + 0.5) brings it into [0, 1).
    let hue = angle / (Math.PI * 2) + 0.5 + (p.flowHueShift || 0);
    hue = ((hue % 1) + 1) % 1;
    const mag = Math.sqrt(dx * dx + dy * dy);
    // Magnitude can exceed 1 for noisy/warped fields. Scale by flowGain
    // (default 1) and clamp. flowFloor lifts the darkest pixels so the
    // image doesn't dissolve into black where the noise is flat.
    const gain = p.flowGain ?? 1.0;
    const floor = p.flowFloor ?? 0.0;
    const v = Math.max(0, Math.min(1, floor + mag * gain * (1 - floor)));
    const sat = p.flowSat ?? 0.85;
    return hsvToRgb(hue, sat, v);
  }

  /**
   * Maps a noise value to RGB. Branches on `params.colorMode`.
   *
   * @param {number} n  Noise value in `[0, 1]`
   * @param {Object} p  Studio parameters (see the module header for color modes)
   * @returns {[number, number, number]}  RGB in 0–255
   */
  function colorize(n, p) {
    const mode = p.colorMode || "rgb";
    if (mode === "rgb") {
      const r = (p.rInvert ? 1 - n : n) * (p.rScale ?? 0);
      const g = (p.gInvert ? 1 - n : n) * (p.gScale ?? 1);
      const b = (p.bInvert ? 1 - n : n) * (p.bScale ?? 0);
      return [
        Math.max(0, Math.min(255, Math.round(r * 255))),
        Math.max(0, Math.min(255, Math.round(g * 255))),
        Math.max(0, Math.min(255, Math.round(b * 255))),
      ];
    }
    if (mode === "gradient") {
      return gradientLookup(p.gradient || [], n);
    }
    if (mode === "hsv") {
      const hue = ((p.hsvHueShift ?? 0) + n * (p.hsvHueRange ?? 1)) % 1;
      return hsvToRgb(hue, p.hsvSat ?? 0.8, p.hsvVal ?? 1.0);
    }
    if (mode === "posterize") {
      const steps = Math.max(2, p.posterizeSteps || 5);
      const quantized = Math.floor(n * steps) / (steps - 1);
      return gradientLookup(p.gradient || [], Math.min(1, quantized));
    }
    return [0, 0, 0];
  }

  /**
   * Renders a Perlin image into a 2D canvas context. Internally branches
   * between the 3D path (`params.loop = false`) and the 4D path (loop).
   *
   * Synchronous — for animations use the worker via `WORKER_SOURCE`,
   * otherwise the main thread blocks.
   *
   * @param {Object} params  Studio parameters (see the module header)
   * @param {CanvasRenderingContext2D} ctx
   */
  function generatePerlinImage(params, ctx) {
    const {
      width, height, t,
      scaleX, scaleY, scaleT,
      octaves, persistence, lacunarity, base,
      loop, loopProgress, loopRadius,
      warpStrength, warpScale,
      tileX, tileY,
      layer2On, layer2ScaleX, layer2ScaleY, layer2Octaves, layer2Base,
      layer2BlendMode, layer2Mix,
      colorMode, rgbMultiChannel,
    } = params;
    const ws = warpStrength || 0;
    const wsc = warpScale || 1;
    const rx = tileX || 0;
    const ry = tileY || 0;
    const isFlow = colorMode === "flow";
    const isMulti = colorMode === "rgb" && rgbMultiChannel;
    const eps = (params.flowEps ?? 0.6);
    // Layer 2 only composes into the standard render path — combining it
    // with the multi-sample flow stencil or per-channel RGB would 6× the
    // per-pixel cost and the visual win is unclear. Document the
    // restriction in the UI.
    const isLayer = !!layer2On && (layer2Mix || 0) > 0 && !isFlow && !isMulti;
    const l2sx = layer2ScaleX || scaleX;
    const l2sy = layer2ScaleY || scaleY;
    const l2oct = layer2Octaves || octaves;
    const l2blend = layer2BlendMode || "multiply";
    const lmix = layer2Mix || 0;
    const perm2 = isLayer ? makePermutation(layer2Base || 0) : null;

    const perm = makePermutation(base);
    const img = ctx.createImageData(width, height);
    const data = img.data;

    if (loop) {
      // Loop mode: (z, w) trace a circle in 4D noise. Modulo 1 ensures that
      // progress=1 is computed exactly like progress=0 —
      // Math.sin(2π) is otherwise ~ -2.4e-16 as a float, and Math.floor of
      // that pushes the hash to -1, masked to 255 → a completely different
      // image.
      const radius = (loopRadius || 1) * (scaleT || 1);
      const safeProgress = ((loopProgress || 0) % 1 + 1) % 1;
      const alpha = safeProgress * Math.PI * 2;
      const zc = Math.cos(alpha) * radius;
      const wc = Math.sin(alpha) * radius;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let r, g, b;
          if (isFlow) {
            const n0 = warpedFbm4(perm, x * scaleX,         y * scaleY,         zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            const n1 = warpedFbm4(perm, (x + eps) * scaleX, y * scaleY,         zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            const n2 = warpedFbm4(perm, x * scaleX,         (y + eps) * scaleY, zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            [r, g, b] = colorizeFlow(n1 - n0, n2 - n0, params);
          } else if (isMulti) {
            const nr = warpedFbm4(perm,  x * scaleX,         y * scaleY,        zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            const ng = warpedFbm4(perm, (x * scaleX) +  53.0, y * scaleY,       zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            const nb = warpedFbm4(perm,  x * scaleX,        (y * scaleY) + 71.0, zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            [r, g, b] = colorizeRgbMulti(nr, ng, nb, params);
          } else {
            const n1 = warpedFbm4(perm, x * scaleX, y * scaleY, zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            let n = n1;
            if (isLayer) {
              const n2 = warpedFbm4(perm2, x * l2sx, y * l2sy, zc, wc, l2oct, persistence, lacunarity, ws, wsc, rx, ry);
              n = n1 * (1 - lmix) + blendLayers(n1, n2, l2blend) * lmix;
            }
            [r, g, b] = colorize(n, params);
          }
          const i = (y * width + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
      }
    } else {
      const tz = (t || 0) * scaleT;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let r, g, b;
          if (isFlow) {
            const n0 = warpedFbm3(perm, x * scaleX,         y * scaleY,         tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            const n1 = warpedFbm3(perm, (x + eps) * scaleX, y * scaleY,         tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            const n2 = warpedFbm3(perm, x * scaleX,         (y + eps) * scaleY, tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            [r, g, b] = colorizeFlow(n1 - n0, n2 - n0, params);
          } else if (isMulti) {
            const nr = warpedFbm3(perm,  x * scaleX,         y * scaleY,        tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            const ng = warpedFbm3(perm, (x * scaleX) +  53.0, y * scaleY,       tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            const nb = warpedFbm3(perm,  x * scaleX,        (y * scaleY) + 71.0, tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            [r, g, b] = colorizeRgbMulti(nr, ng, nb, params);
          } else {
            const n1 = warpedFbm3(perm, x * scaleX, y * scaleY, tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
            let n = n1;
            if (isLayer) {
              const n2 = warpedFbm3(perm2, x * l2sx, y * l2sy, tz, l2oct, persistence, lacunarity, ws, wsc, rx, ry);
              n = n1 * (1 - lmix) + blendLayers(n1, n2, l2blend) * lmix;
            }
            [r, g, b] = colorize(n, params);
          }
          const i = (y * width + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- WORKER SOURCE ----------
  // Loaded by the main thread as a Blob URL so the worker also runs under
  // file://. Self-contained copy of the core functions.
  const WORKER_SOURCE = `
    const BASE_PERM = ${JSON.stringify(BASE_PERM)};
    const GRAD4 = ${JSON.stringify(GRAD4)};
    ${makePermutation.toString()}
    ${fade.toString()}
    ${lerp.toString()}
    ${grad.toString()}
    ${grad4.toString()}
    ${wrapCell.toString()}
    ${nextCell.toString()}
    ${perlin3.toString()}
    ${perlin4.toString()}
    ${fbm3.toString()}
    ${fbm4.toString()}
    ${effectiveWarpScale.toString()}
    ${warpedFbm3.toString()}
    ${warpedFbm4.toString()}
    ${blendLayers.toString()}
    ${clamp01.toString()}
    ${gradientLookup.toString()}
    ${hsvToRgb.toString()}
    ${colorizeRgbMulti.toString()}
    ${colorizeFlow.toString()}
    ${colorize.toString()}

    self.onmessage = function(e) {
      const { id, params } = e.data;
      const { width, height, t, scaleX, scaleY, scaleT,
              octaves, persistence, lacunarity, base,
              loop, loopProgress, loopRadius,
              warpStrength, warpScale,
              tileX, tileY,
              layer2On, layer2ScaleX, layer2ScaleY, layer2Octaves,
              layer2Base, layer2BlendMode, layer2Mix,
              colorMode, rgbMultiChannel } = params;
      const ws = warpStrength || 0;
      const wsc = warpScale || 1;
      const rx = tileX || 0;
      const ry = tileY || 0;
      const isFlow = colorMode === "flow";
      const isMulti = colorMode === "rgb" && rgbMultiChannel;
      const eps = params.flowEps != null ? params.flowEps : 0.6;
      const isLayer = !!layer2On && (layer2Mix || 0) > 0 && !isFlow && !isMulti;
      const l2sx = layer2ScaleX || scaleX;
      const l2sy = layer2ScaleY || scaleY;
      const l2oct = layer2Octaves || octaves;
      const l2blend = layer2BlendMode || "multiply";
      const lmix = layer2Mix || 0;
      const perm = makePermutation(base);
      const perm2 = isLayer ? makePermutation(layer2Base || 0) : null;
      const buf = new Uint8ClampedArray(width * height * 4);

      if (loop) {
        const radius = (loopRadius || 1) * (scaleT || 1);
        const safeProgress = ((loopProgress || 0) % 1 + 1) % 1;
        const alpha = safeProgress * Math.PI * 2;
        const zc = Math.cos(alpha) * radius;
        const wc = Math.sin(alpha) * radius;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let c;
            if (isFlow) {
              const n0 = warpedFbm4(perm, x * scaleX,         y * scaleY,         zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              const n1 = warpedFbm4(perm, (x + eps) * scaleX, y * scaleY,         zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              const n2 = warpedFbm4(perm, x * scaleX,         (y + eps) * scaleY, zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              c = colorizeFlow(n1 - n0, n2 - n0, params);
            } else if (isMulti) {
              const nr = warpedFbm4(perm,  x * scaleX,          y * scaleY,        zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              const ng = warpedFbm4(perm, (x * scaleX) +  53.0, y * scaleY,        zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              const nb = warpedFbm4(perm,  x * scaleX,         (y * scaleY) + 71.0, zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              c = colorizeRgbMulti(nr, ng, nb, params);
            } else {
              const n1 = warpedFbm4(perm, x * scaleX, y * scaleY, zc, wc, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              let n = n1;
              if (isLayer) {
                const n2 = warpedFbm4(perm2, x * l2sx, y * l2sy, zc, wc, l2oct, persistence, lacunarity, ws, wsc, rx, ry);
                n = n1 * (1 - lmix) + blendLayers(n1, n2, l2blend) * lmix;
              }
              c = colorize(n, params);
            }
            const i = (y * width + x) * 4;
            buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2]; buf[i+3] = 255;
          }
        }
      } else {
        const tz = (t || 0) * scaleT;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let c;
            if (isFlow) {
              const n0 = warpedFbm3(perm, x * scaleX,         y * scaleY,         tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              const n1 = warpedFbm3(perm, (x + eps) * scaleX, y * scaleY,         tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              const n2 = warpedFbm3(perm, x * scaleX,         (y + eps) * scaleY, tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              c = colorizeFlow(n1 - n0, n2 - n0, params);
            } else if (isMulti) {
              const nr = warpedFbm3(perm,  x * scaleX,          y * scaleY,        tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              const ng = warpedFbm3(perm, (x * scaleX) +  53.0, y * scaleY,        tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              const nb = warpedFbm3(perm,  x * scaleX,         (y * scaleY) + 71.0, tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              c = colorizeRgbMulti(nr, ng, nb, params);
            } else {
              const n1 = warpedFbm3(perm, x * scaleX, y * scaleY, tz, octaves, persistence, lacunarity, ws, wsc, rx, ry);
              let n = n1;
              if (isLayer) {
                const n2 = warpedFbm3(perm2, x * l2sx, y * l2sy, tz, l2oct, persistence, lacunarity, ws, wsc, rx, ry);
                n = n1 * (1 - lmix) + blendLayers(n1, n2, l2blend) * lmix;
              }
              c = colorize(n, params);
            }
            const i = (y * width + x) * 4;
            buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2]; buf[i+3] = 255;
          }
        }
      }

      // Transferable ArrayBuffer — zero-copy back to the main thread.
      self.postMessage({ id, width, height, buffer: buf.buffer }, [buf.buffer]);
    };
  `;

  window.MTPerlin = {
    makePermutation, perlin3, perlin4, fbm3, fbm4,
    warpedFbm3, warpedFbm4, blendLayers,
    generatePerlinImage, colorize, colorizeRgbMulti, colorizeFlow,
    WORKER_SOURCE,
  };
})();
