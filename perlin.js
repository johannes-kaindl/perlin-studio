/**
 * perlin.js — Ken Perlins „Improved Noise" in 3D und 4D, fBm und Farb-Modi.
 *
 * Vanilla JS, keine Abhängigkeiten. Eine IIFE exportiert nach `window.MTPerlin`.
 * Das gesamte Modul ist außerdem als String unter `MTPerlin.WORKER_SOURCE`
 * verfügbar, sodass es 1:1 in einen Web Worker (Blob-URL) geladen werden kann
 * — wichtig für die fließende Animation im Studio.
 *
 * Öffentliche API (`window.MTPerlin`):
 *   - `makePermutation(base)` → Uint8Array(512) — seedete Permutation
 *   - `perlin3(perm, x, y, z)` → Wert in ca. [-1, 1]
 *   - `perlin4(perm, x, y, z, w)` → Wert in ca. [-1, 1]
 *   - `fbm3(perm, x, y, z, octaves, persistence, lacunarity)` → Wert in [0, 1]
 *   - `fbm4(perm, x, y, z, w, octaves, persistence, lacunarity)` → Wert in [0, 1]
 *   - `generatePerlinImage(params, ctx)` rendert via 3D/4D-Pfad ins Canvas-Ctx
 *   - `colorize(noiseValue, params)` → `[r, g, b]` in 0–255
 *   - `WORKER_SOURCE` — kompletter Modul-Code als String für Inline-Worker
 *
 * Farb-Modi (`params.colorMode`):
 *   - `"rgb"`       pro Kanal Scale + Invert (Default, wie Python-Original)
 *   - `"gradient"`  Color-Stops `[{pos:0..1, color:[r,g,b]}, ...]` linear interpoliert
 *   - `"hsv"`       Noise → Hue, hsvSat/hsvVal als Konstante
 *   - `"posterize"` Noise auf N Stufen quantisiert, dann auf Gradient gemappt
 *
 * Animations-Loop (`params.loop = true`):
 *   Statt linear durch die Zeit-Achse zu laufen, wird im 4D-Noise
 *   `(z, w) = (cos(α)·r, sin(α)·r)` auf einer Kreisbahn durchlaufen.
 *   Nach einer vollen Umdrehung (α = 2π) sind z, w wieder identisch
 *   zum Start → mathematisch nahtloser Loop.
 *
 * @license MIT
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
   * Erzeugt eine seedete Permutationstabelle für Perlin-Noise.
   * Verschiebt die klassische `BASE_PERM` deterministisch um `base` Schritte,
   * sodass jeder ganzzahlige Seed eine andere Rauschausprägung liefert.
   * Die Tabelle wird verdoppelt (512 Einträge), damit `perm[i + 1]`-Lookups
   * ohne Modulo auskommen — schneller im inneren Render-Loop.
   *
   * @param {number} base  Seed (beliebige ganze Zahl)
   * @returns {Uint8Array} 512 Bytes Permutationstabelle
   */
  function makePermutation(base) {
    const offset = ((base | 0) % 256 + 256) % 256;
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) perm[i] = BASE_PERM[(i + offset) & 255];
    for (let i = 256; i < 512; i++) perm[i] = perm[i - 256];
    return perm;
  }

  // Ken Perlins „Fade"-Polynom 6t⁵ − 15t⁴ + 10t³: erzwingt C²-Stetigkeit
  // an Gitterpunkten (erste und zweite Ableitung sind dort 0).

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  /**
   * 3D-Perlin-Noise (Improved Noise, Ken Perlin 2002).
   * Wertebereich ca. `[-0.88, 0.88]`. An Gitterpunkten (ganze Koordinaten)
   * exakt 0 — das ist by design, keine Bug.
   *
   * @param {Uint8Array} perm  Permutation aus `makePermutation`
   * @param {number} x  Koordinate (beliebig)
   * @param {number} y
   * @param {number} z
   * @returns {number}  Noise-Wert in ca. `[-1, 1]`
   */
  function perlin3(perm, x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);

    const A  = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B  = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;

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

  /**
   * fBm (Fractal Brownian Motion) auf Basis von `perlin3`.
   * Summiert mehrere Oktaven mit jeweils höherer Frequenz und kleinerer
   * Amplitude. Normalisiert auf `[0, 1]`.
   *
   * @param {Uint8Array} perm
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} octaves      Anzahl Oktaven (1–10 sinnvoll)
   * @param {number} persistence  Amplitudenfaktor pro Oktave (0.5 = Standard)
   * @param {number} lacunarity   Frequenzfaktor pro Oktave (2.0 = Standard)
   * @returns {number} Wert in `[0, 1]`
   */
  function fbm3(perm, x, y, z, octaves, persistence, lacunarity) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum  += amp * perlin3(perm, x * freq, y * freq, z * freq);
      norm += amp;
      amp  *= persistence;
      freq *= lacunarity;
    }
    const n = norm > 0 ? sum / norm : 0;
    return (n + 1) * 0.5;
  }

  // ---------- 4D NOISE (für loopbare Animation) ----------
  // 32 4D-Gradient-Vektoren aus Ken Perlins Improved-Noise-Referenz (Java).
  // Jeder Eckpunkt eines 4D-Hyperwürfels (16 Stk.) bekommt per Hash einen
  // dieser Gradienten zugewiesen; das Skalarprodukt mit dem Offset-Vektor
  // gibt den Beitrag dieser Ecke. Eine kreisförmige Bahn in (z, w) ergibt
  // einen perfekt nahtlosen Loop, weil cos/sin nach 2π zur Startposition
  // zurückkehren.
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
   * 4D-Perlin-Noise. Identisch in der Idee zu `perlin3`, aber mit 16 Hyperwürfel-
   * Eckpunkten und 4-fach verschachteltem Lerp. Wird im Studio nur für den
   * Loop-Modus genutzt: eine Kreisbahn in `(z, w)` ist nahtlos schließbar.
   *
   * @param {Uint8Array} perm
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} w
   * @returns {number} Noise-Wert in ca. `[-1, 1]`
   */
  function perlin4(perm, x, y, z, w) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const W = Math.floor(w) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z); w -= Math.floor(w);
    const u = fade(x), v = fade(y), s = fade(z), tt = fade(w);

    // Hash-Baum entlang X → Y → Z → W. Suffixe A/B = "low/high"-Seite je Achse.
    const A   = perm[X] + Y;
    const B   = perm[X + 1] + Y;
    const AA  = perm[A] + Z;
    const AB  = perm[A + 1] + Z;
    const BA  = perm[B] + Z;
    const BB  = perm[B + 1] + Z;
    const AAA = perm[AA] + W,     AAB = perm[AA + 1] + W;
    const ABA = perm[AB] + W,     ABB = perm[AB + 1] + W;
    const BAA = perm[BA] + W,     BAB = perm[BA + 1] + W;
    const BBA = perm[BB] + W,     BBB = perm[BB + 1] + W;

    // 16 Eckpunkte → 4-fache Lerp-Verschachtelung.
    // Hash-Konvention: AAB = Z-shift (perm[AA+1]+W), AAA+1 = W-shift (perm[AA]+W+1).
    // → Offsets müssen passend gewählt werden: AAB nutzt z-1, AAA+1 nutzt w-1.
    // Lerp-Reihenfolge von innen nach außen: u (X) → v (Y) → s (Z) → tt (W).
    return lerp(
      // W-low Hälfte
      lerp(
        // Z-low
        lerp(
          lerp(grad4(perm[AAA],     x,     y,     z,     w), grad4(perm[BAA],     x - 1, y,     z,     w),     u),
          lerp(grad4(perm[ABA],     x,     y - 1, z,     w), grad4(perm[BBA],     x - 1, y - 1, z,     w),     u),
          v
        ),
        // Z-high  (AAB = perm[AA+1]+W ist Z-shift → offset z-1, w bleibt)
        lerp(
          lerp(grad4(perm[AAB],     x,     y,     z - 1, w), grad4(perm[BAB],     x - 1, y,     z - 1, w),     u),
          lerp(grad4(perm[ABB],     x,     y - 1, z - 1, w), grad4(perm[BBB],     x - 1, y - 1, z - 1, w),     u),
          v
        ),
        s
      ),
      // W-high Hälfte  (AAA+1 ist W-shift → offset w-1, z bleibt)
      lerp(
        // Z-low
        lerp(
          lerp(grad4(perm[AAA + 1], x,     y,     z,     w - 1), grad4(perm[BAA + 1], x - 1, y,     z,     w - 1), u),
          lerp(grad4(perm[ABA + 1], x,     y - 1, z,     w - 1), grad4(perm[BBA + 1], x - 1, y - 1, z,     w - 1), u),
          v
        ),
        // Z-high  (AAB+1 = (Z-shift)+1 = Z- und W-shift kombiniert → offset z-1, w-1)
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

  /** fBm auf Basis von `perlin4`. Wertebereich `[0, 1]`. */
  function fbm4(perm, x, y, z, w, octaves, persistence, lacunarity) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum  += amp * perlin4(perm, x * freq, y * freq, z * freq, w * freq);
      norm += amp;
      amp  *= persistence;
      freq *= lacunarity;
    }
    const n = norm > 0 ? sum / norm : 0;
    return (n + 1) * 0.5;
  }

  // ---------- COLOR MODES ----------

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // Lineare Interpolation in einer Gradient-Stop-Liste.
  // stops: [{pos: 0..1, color: [r,g,b]}, ...] sortiert nach pos.
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

  /**
   * Mappt einen Noise-Wert auf RGB. Verzweigt nach `params.colorMode`.
   *
   * @param {number} n  Noise-Wert in `[0, 1]`
   * @param {Object} p  Studio-Parameter (s. Modul-Header für Farb-Modi)
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
   * Rendert ein Perlin-Bild in einen 2D-Canvas-Context. Verzweigt intern
   * zwischen 3D-Pfad (`params.loop = false`) und 4D-Pfad (Loop).
   *
   * Synchron — für Animationen sollte der Worker via `WORKER_SOURCE`
   * verwendet werden, sonst blockiert der Main-Thread.
   *
   * @param {Object} params  Studio-Parameter (s. Modul-Header)
   * @param {CanvasRenderingContext2D} ctx
   */
  function generatePerlinImage(params, ctx) {
    const {
      width, height, t,
      scaleX, scaleY, scaleT,
      octaves, persistence, lacunarity, base,
      loop, loopProgress, loopRadius,
    } = params;

    const perm = makePermutation(base);
    const img = ctx.createImageData(width, height);
    const data = img.data;

    if (loop) {
      // Loop-Modus: (z, w) durchlaufen einen Kreis im 4D-Noise. Modulo 1
      // sichert ab, dass progress=1 exakt wie progress=0 berechnet wird —
      // Math.sin(2π) ist sonst Float-mäßig ≈ -2.4e-16 und Math.floor davon
      // wirft den Hash auf -1, was als 255 maskiert wird → komplett anderes Bild.
      const radius = (loopRadius || 1) * (scaleT || 1);
      const safeProgress = ((loopProgress || 0) % 1 + 1) % 1;
      const alpha = safeProgress * Math.PI * 2;
      const zc = Math.cos(alpha) * radius;
      const wc = Math.sin(alpha) * radius;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const n = fbm4(perm, x * scaleX, y * scaleY, zc, wc, octaves, persistence, lacunarity);
          const [r, g, b] = colorize(n, params);
          const i = (y * width + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
      }
    } else {
      const tz = (t || 0) * scaleT;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const n = fbm3(perm, x * scaleX, y * scaleY, tz, octaves, persistence, lacunarity);
          const [r, g, b] = colorize(n, params);
          const i = (y * width + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- WORKER SOURCE ----------
  // Wird vom Main-Thread als Blob-URL geladen, damit der Worker auch unter
  // file:// funktioniert. Self-contained Kopie der Kernfunktionen.
  const WORKER_SOURCE = `
    const BASE_PERM = ${JSON.stringify(BASE_PERM)};
    const GRAD4 = ${JSON.stringify(GRAD4)};
    ${makePermutation.toString()}
    ${fade.toString()}
    ${lerp.toString()}
    ${grad.toString()}
    ${grad4.toString()}
    ${perlin3.toString()}
    ${perlin4.toString()}
    ${fbm3.toString()}
    ${fbm4.toString()}
    ${clamp01.toString()}
    ${gradientLookup.toString()}
    ${hsvToRgb.toString()}
    ${colorize.toString()}

    self.onmessage = function(e) {
      const { id, params } = e.data;
      const { width, height, t, scaleX, scaleY, scaleT,
              octaves, persistence, lacunarity, base,
              loop, loopProgress, loopRadius } = params;
      const perm = makePermutation(base);
      const buf = new Uint8ClampedArray(width * height * 4);

      if (loop) {
        const radius = (loopRadius || 1) * (scaleT || 1);
        const safeProgress = ((loopProgress || 0) % 1 + 1) % 1;
        const alpha = safeProgress * Math.PI * 2;
        const zc = Math.cos(alpha) * radius;
        const wc = Math.sin(alpha) * radius;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const n = fbm4(perm, x * scaleX, y * scaleY, zc, wc, octaves, persistence, lacunarity);
            const c = colorize(n, params);
            const i = (y * width + x) * 4;
            buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2]; buf[i+3] = 255;
          }
        }
      } else {
        const tz = (t || 0) * scaleT;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const n = fbm3(perm, x * scaleX, y * scaleY, tz, octaves, persistence, lacunarity);
            const c = colorize(n, params);
            const i = (y * width + x) * 4;
            buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2]; buf[i+3] = 255;
          }
        }
      }

      // Transferable ArrayBuffer — zero-copy zurück zum Main-Thread.
      self.postMessage({ id, width, height, buffer: buf.buffer }, [buf.buffer]);
    };
  `;

  window.MTPerlin = {
    makePermutation, perlin3, perlin4, fbm3, fbm4,
    generatePerlinImage, colorize,
    WORKER_SOURCE,
  };
})();
