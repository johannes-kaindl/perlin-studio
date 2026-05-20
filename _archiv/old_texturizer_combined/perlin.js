/*
  Perlin-Noise (Ken Perlins „Improved Noise") in 3D + fBm (Fractal Brownian Motion).
  Vanilla JS, keine Abhängigkeiten. Funktional analog zur Python-`noise.pnoise3` mit
  octaves/persistence/lacunarity. `base` seedet die Permutationstabelle.

  Globale API:
    window.MTPerlin = {
      makePermutation(base),  // → Uint8Array(512)
      perlin3(perm, x, y, z),  // → [-1, 1]
      fbm3(perm, x, y, z, octaves, persistence, lacunarity),  // → [0, 1]
      generatePerlinImage(params, ctx),  // rendert ImageData ins gegebene 2D-Context
    };
*/
(function () {
  "use strict";

  // Klassische Permutationstabelle aus Ken Perlins Referenz.
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

  function makePermutation(base) {
    // Wir verschieben die Permutation deterministisch um `base`,
    // sodass jeder ganzzahlige Seed eine andere Rauschausprägung liefert.
    const offset = ((base | 0) % 256 + 256) % 256;
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) {
      perm[i] = BASE_PERM[(i + offset) & 255];
    }
    for (let i = 256; i < 512; i++) {
      perm[i] = perm[i - 256];
    }
    return perm;
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  function perlin3(perm, x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);

    const A  = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B  = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;

    return lerp(
      lerp(
        lerp(grad(perm[AA], x, y, z),       grad(perm[BA], x - 1, y, z), u),
        lerp(grad(perm[AB], x, y - 1, z),   grad(perm[BB], x - 1, y - 1, z), u),
        v
      ),
      lerp(
        lerp(grad(perm[AA + 1], x, y, z - 1),     grad(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  function fbm3(perm, x, y, z, octaves, persistence, lacunarity) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum  += amp * perlin3(perm, x * freq, y * freq, z * freq);
      norm += amp;
      amp  *= persistence;
      freq *= lacunarity;
    }
    // Normalisierung auf etwa [-1, 1] und dann auf [0, 1]
    const n = norm > 0 ? sum / norm : 0;
    return (n + 1) * 0.5;
  }

  /**
   * Rendert ein Perlin-Bild in den gegebenen 2D-Canvas-Context.
   * @param {Object} params  Parameter analog zum Python-Generator:
   *   { width, height, t, scaleX, scaleY, scaleT,
   *     octaves, persistence, lacunarity, base,
   *     rScale, gScale, bScale,
   *     rInvert, gInvert, bInvert }
   * @param {CanvasRenderingContext2D} ctx
   */
  function generatePerlinImage(params, ctx) {
    const {
      width, height, t,
      scaleX, scaleY, scaleT,
      octaves, persistence, lacunarity, base,
      rScale, gScale, bScale,
      rInvert, gInvert, bInvert,
    } = params;

    const perm = makePermutation(base);
    const img = ctx.createImageData(width, height);
    const data = img.data;

    const tz = t * scaleT;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const n = fbm3(perm, x * scaleX, y * scaleY, tz, octaves, persistence, lacunarity);
        const r = (rInvert ? 1 - n : n) * rScale;
        const g = (gInvert ? 1 - n : n) * gScale;
        const b = (bInvert ? 1 - n : n) * bScale;

        const i = (y * width + x) * 4;
        data[i]     = Math.max(0, Math.min(255, Math.round(r * 255)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        data[i + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  window.MTPerlin = { makePermutation, perlin3, fbm3, generatePerlinImage };
})();
