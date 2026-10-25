/**
 * perlin-gl.js — GPU renderer for Perlin Studio (WebGL2 fragment shader).
 *
 * A port of the CPU maths in perlin.js, not a new noise: the shader reads the
 * same seeded permutation table (a 512x2 texture) and the same 32 gradients, and
 * mirrors perlin3/perlin4, fBm, domain warp, tiling, layer 2 and the
 * rgb / gradient / hsv / posterize / cosine colour modes line by line. The same preset
 * therefore renders the same image on both engines, up to float32 against
 * float64 (scripts/check-gl-parity.mjs measures the difference).
 *
 * What it does NOT cover falls back to the CPU engine, frame by frame — see
 * `supports()`: the flow and multi-channel RGB colour modes (several noise
 * samples per pixel) and gradients with more than MAX_STOPS stops.
 *
 * Plain script: attaches `window.MTPerlinGL`. file://-safe — the shader is a
 * string, no build step. PerlinEngine owns the choice between engines
 * (`engine.setBackend("gpu")`); this module only renders one frame on request.
 *
 *   MTPerlinGL.isAvailable()        → a WebGL2 context can be created
 *   MTPerlinGL.createRenderer()     → { supports(params), render(params, ctx2d), destroy() } or null
 *
 * The loop angle is computed in JS (float64) and passed as uniforms, so the
 * seamless-loop guarantee of the CPU path (`safeProgress`, progress 1 === 0)
 * holds bit for bit on the GPU too: the shader never calls sin/cos on it.
 *
 * @license AGPL-3.0-or-later
 */
(function (root) {
  "use strict";

  const MAX_STOPS = 16;
  const MAX_OCTAVES = 12;
  const BLEND_MODES = { multiply: 0, add: 1, screen: 2, darken: 3, lighten: 4, difference: 5 };
  const COLOR_MODES = { rgb: 0, gradient: 1, hsv: 2, posterize: 3, cosine: 4 };

  // GRAD4 is the table from perlin.js (Ken Perlin's reference), written as GLSL.
  const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uPerm;      // 512 x 2, R8: row 0 = main seed, row 1 = layer 2 seed
uniform vec2  uSize;
uniform bool  uLoop;
uniform vec2  uZW;            // loop: (z, w) on the circle, computed in JS
uniform float uTz;            // linear: z = t * scaleT
uniform vec2  uScale;
uniform vec2  uL2Scale;
uniform int   uOct, uL2Oct;
uniform float uPers, uLac;
uniform float uWarpS, uWarpScale;
uniform int   uRepX, uRepY;
uniform bool  uLayer;
uniform int   uBlend;
uniform float uMix;
uniform int   uMode;
uniform vec3  uRgbScale, uRgbInvert;
uniform vec4  uHsv;           // shift, range, sat, val
uniform vec3  uCosA, uCosB, uCosC, uCosD;   // cosine palette: a + b*cos(2pi(c*n + d))
uniform int   uSteps;
uniform int   uStopN;
uniform float uStopPos[${MAX_STOPS}];
uniform vec3  uStopColor[${MAX_STOPS}];

out vec4 outColor;

const vec4 GRAD4[32] = vec4[32](
  vec4(0,1,1,1),  vec4(0,1,1,-1),  vec4(0,1,-1,1),  vec4(0,1,-1,-1),
  vec4(0,-1,1,1), vec4(0,-1,1,-1), vec4(0,-1,-1,1), vec4(0,-1,-1,-1),
  vec4(1,0,1,1),  vec4(1,0,1,-1),  vec4(1,0,-1,1),  vec4(1,0,-1,-1),
  vec4(-1,0,1,1), vec4(-1,0,1,-1), vec4(-1,0,-1,1), vec4(-1,0,-1,-1),
  vec4(1,1,0,1),  vec4(1,1,0,-1),  vec4(1,-1,0,1),  vec4(1,-1,0,-1),
  vec4(-1,1,0,1), vec4(-1,1,0,-1), vec4(-1,-1,0,1), vec4(-1,-1,0,-1),
  vec4(1,1,1,0),  vec4(1,1,-1,0),  vec4(1,-1,1,0),  vec4(1,-1,-1,0),
  vec4(-1,1,1,0), vec4(-1,1,-1,0), vec4(-1,-1,1,0), vec4(-1,-1,-1,0)
);

int P(int row, int i) { return int(texelFetch(uPerm, ivec2(i, row), 0).r * 255.0 + 0.5); }

float fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

// GLSL ES leaves % undefined for negative operands, so floor-mod by hand.
int imod(int a, int b) { return a - b * int(floor(float(a) / float(b))); }
int wrapCell(int v, int period) { return period > 0 ? (imod(v, period) & 255) : (v & 255); }
int nextCell(int v, int period) { return period > 0 ? (imod(v + 1, period) & 255) : ((v + 1) & 255); }

float grad3(int hash, float x, float y, float z) {
  int h = hash & 15;
  float u = h < 8 ? x : y;
  float v = h < 4 ? y : ((h == 12 || h == 14) ? x : z);
  return (((h & 1) == 0) ? u : -u) + (((h & 2) == 0) ? v : -v);
}
float grad4(int hash, float x, float y, float z, float w) {
  return dot(GRAD4[hash & 31], vec4(x, y, z, w));
}

float perlin3(int row, float x, float y, float z, int rx, int ry) {
  float xf = floor(x), yf = floor(y), zf = floor(z);
  int xi = int(xf), yi = int(yf), zi = int(zf);
  int Xa = wrapCell(xi, rx), Xb = nextCell(xi, rx);
  int Ya = wrapCell(yi, ry), Yb = nextCell(yi, ry);
  int Za = zi & 255, Zb = (zi + 1) & 255;
  x -= xf; y -= yf; z -= zf;
  float u = fade(x), v = fade(y), w = fade(z);
  int Aa = P(row, Xa) + Ya, Ab = P(row, Xa) + Yb;
  int Ba = P(row, Xb) + Ya, Bb = P(row, Xb) + Yb;
  int Aa0 = P(row, Aa) + Za, Aa1 = P(row, Aa) + Zb;
  int Ab0 = P(row, Ab) + Za, Ab1 = P(row, Ab) + Zb;
  int Ba0 = P(row, Ba) + Za, Ba1 = P(row, Ba) + Zb;
  int Bb0 = P(row, Bb) + Za, Bb1 = P(row, Bb) + Zb;
  return mix(
    mix(
      mix(grad3(P(row, Aa0), x,       y,       z),       grad3(P(row, Ba0), x - 1.0, y,       z),       u),
      mix(grad3(P(row, Ab0), x,       y - 1.0, z),       grad3(P(row, Bb0), x - 1.0, y - 1.0, z),       u),
      v),
    mix(
      mix(grad3(P(row, Aa1), x,       y,       z - 1.0), grad3(P(row, Ba1), x - 1.0, y,       z - 1.0), u),
      mix(grad3(P(row, Ab1), x,       y - 1.0, z - 1.0), grad3(P(row, Bb1), x - 1.0, y - 1.0, z - 1.0), u),
      v),
    w);
}

// Same hash tree and offsets as perlin4() in perlin.js. AAB = perm[AA+1]+W is a
// Z shift (offset z-1), AAA+1 = perm[AA]+W+1 is a W shift (offset w-1) — do not
// "tidy" the pairing, that is math bug class 2 (see .claude/rules/perlin-core.md).
float perlin4(int row, float x, float y, float z, float w, int rx, int ry) {
  float xf = floor(x), yf = floor(y), zf = floor(z), wf = floor(w);
  int xi = int(xf), yi = int(yf), zi = int(zf), wi = int(wf);
  int Xa = wrapCell(xi, rx), Xb = nextCell(xi, rx);
  int Ya = wrapCell(yi, ry), Yb = nextCell(yi, ry);
  int Za = zi & 255;
  int Wa = wi & 255;
  x -= xf; y -= yf; z -= zf; w -= wf;
  float u = fade(x), v = fade(y), s = fade(z), tt = fade(w);
  int Aa = P(row, Xa) + Ya, Ab = P(row, Xa) + Yb;
  int Ba = P(row, Xb) + Ya, Bb = P(row, Xb) + Yb;
  int AA = P(row, Aa) + Za, AB = P(row, Ab) + Za, BA = P(row, Ba) + Za, BB = P(row, Bb) + Za;
  int AAA = P(row, AA) + Wa, AAB = P(row, AA + 1) + Wa;
  int ABA = P(row, AB) + Wa, ABB = P(row, AB + 1) + Wa;
  int BAA = P(row, BA) + Wa, BAB = P(row, BA + 1) + Wa;
  int BBA = P(row, BB) + Wa, BBB = P(row, BB + 1) + Wa;
  return mix(
    mix(
      mix(
        mix(grad4(P(row, AAA),     x,       y,       z,       w), grad4(P(row, BAA),     x - 1.0, y,       z,       w),       u),
        mix(grad4(P(row, ABA),     x,       y - 1.0, z,       w), grad4(P(row, BBA),     x - 1.0, y - 1.0, z,       w),       u),
        v),
      mix(
        mix(grad4(P(row, AAB),     x,       y,       z - 1.0, w), grad4(P(row, BAB),     x - 1.0, y,       z - 1.0, w),       u),
        mix(grad4(P(row, ABB),     x,       y - 1.0, z - 1.0, w), grad4(P(row, BBB),     x - 1.0, y - 1.0, z - 1.0, w),       u),
        v),
      s),
    mix(
      mix(
        mix(grad4(P(row, AAA + 1), x,       y,       z,       w - 1.0), grad4(P(row, BAA + 1), x - 1.0, y,       z,       w - 1.0), u),
        mix(grad4(P(row, ABA + 1), x,       y - 1.0, z,       w - 1.0), grad4(P(row, BBA + 1), x - 1.0, y - 1.0, z,       w - 1.0), u),
        v),
      mix(
        mix(grad4(P(row, AAB + 1), x,       y,       z - 1.0, w - 1.0), grad4(P(row, BAB + 1), x - 1.0, y,       z - 1.0, w - 1.0), u),
        mix(grad4(P(row, ABB + 1), x,       y - 1.0, z - 1.0, w - 1.0), grad4(P(row, BBB + 1), x - 1.0, y - 1.0, z - 1.0, w - 1.0), u),
        v),
      s),
    tt);
}

int roundInt(float v) { return int(floor(v + 0.5)); }   // Math.round: halves go up

float fbm3(int row, float x, float y, float z, int oct, int rx0, int ry0) {
  float amp = 1.0, freq = 1.0, sum = 0.0, norm = 0.0;
  for (int o = 0; o < ${MAX_OCTAVES}; o++) {
    if (o >= oct) break;
    int rx = rx0 > 0 ? roundInt(float(rx0) * freq) : 0;
    int ry = ry0 > 0 ? roundInt(float(ry0) * freq) : 0;
    sum += amp * perlin3(row, x * freq, y * freq, z * freq, rx, ry);
    norm += amp;
    amp *= uPers;
    freq *= uLac;
  }
  float n = norm > 0.0 ? sum / norm : 0.0;
  return (n + 1.0) * 0.5;
}
float fbm4(int row, float x, float y, float z, float w, int oct, int rx0, int ry0) {
  float amp = 1.0, freq = 1.0, sum = 0.0, norm = 0.0;
  for (int o = 0; o < ${MAX_OCTAVES}; o++) {
    if (o >= oct) break;
    int rx = rx0 > 0 ? roundInt(float(rx0) * freq) : 0;
    int ry = ry0 > 0 ? roundInt(float(ry0) * freq) : 0;
    sum += amp * perlin4(row, x * freq, y * freq, z * freq, w * freq, rx, ry);
    norm += amp;
    amp *= uPers;
    freq *= uLac;
  }
  float n = norm > 0.0 ? sum / norm : 0.0;
  return (n + 1.0) * 0.5;
}

// warpStrength = 0 skips the warp entirely, like the CPU path.
float warped3(int row, float x, float y, float z, int oct) {
  if (uWarpS == 0.0) return fbm3(row, x, y, z, oct, uRepX, uRepY);
  float s = uWarpScale;
  int wrx = uRepX > 0 ? roundInt(float(uRepX) * s) : 0;
  int wry = uRepY > 0 ? roundInt(float(uRepY) * s) : 0;
  float dx = perlin3(row, x * s + 137.0, y * s + 23.0, z, wrx, wry) * uWarpS;
  float dy = perlin3(row, x * s + 211.0, y * s - 53.0, z, wrx, wry) * uWarpS;
  return fbm3(row, x + dx, y + dy, z, oct, uRepX, uRepY);
}
float warped4(int row, float x, float y, float z, float w, int oct) {
  if (uWarpS == 0.0) return fbm4(row, x, y, z, w, oct, uRepX, uRepY);
  float s = uWarpScale;
  int wrx = uRepX > 0 ? roundInt(float(uRepX) * s) : 0;
  int wry = uRepY > 0 ? roundInt(float(uRepY) * s) : 0;
  float dx = perlin4(row, x * s + 137.0, y * s + 23.0, z, w, wrx, wry) * uWarpS;
  float dy = perlin4(row, x * s + 211.0, y * s - 53.0, z, w, wrx, wry) * uWarpS;
  return fbm4(row, x + dx, y + dy, z, w, oct, uRepX, uRepY);
}

float blendLayers(float n1, float n2) {
  if (uBlend == 0) return n1 * n2;
  if (uBlend == 1) return min(n1 + n2, 1.0);
  if (uBlend == 2) return 1.0 - (1.0 - n1) * (1.0 - n2);
  if (uBlend == 3) return min(n1, n2);
  if (uBlend == 4) return max(n1, n2);
  if (uBlend == 5) return abs(n1 - n2);
  return n1;
}

vec3 gradientLookup(float t) {
  t = clamp(t, 0.0, 1.0);
  if (uStopN == 0) return vec3(0.0);
  if (uStopN == 1) return uStopColor[0];
  if (t <= uStopPos[0]) return uStopColor[0];
  int last = uStopN - 1;
  if (t >= uStopPos[last]) return uStopColor[last];
  for (int i = 1; i < ${MAX_STOPS}; i++) {
    if (i >= uStopN) break;
    if (t <= uStopPos[i]) {
      float span = uStopPos[i] - uStopPos[i - 1];
      float u = span > 0.0 ? (t - uStopPos[i - 1]) / span : 0.0;
      return mix(uStopColor[i - 1], uStopColor[i], u);
    }
  }
  return uStopColor[last];
}

vec3 hsvToRgb(float h, float s, float v) {
  h = fract(h);
  float i = floor(h * 6.0);
  float f = h * 6.0 - i;
  float p = v * (1.0 - s), q = v * (1.0 - f * s), t = v * (1.0 - (1.0 - f) * s);
  int k = int(i) % 6;
  if (k == 0) return vec3(v, t, p);
  if (k == 1) return vec3(q, v, p);
  if (k == 2) return vec3(p, v, t);
  if (k == 3) return vec3(p, q, v);
  if (k == 4) return vec3(t, p, v);
  return vec3(v, p, q);
}

vec3 colorize(float n) {
  if (uMode == 0) {
    vec3 c = mix(vec3(n), vec3(1.0 - n), uRgbInvert) * uRgbScale;
    return clamp(c, 0.0, 1.0);
  }
  if (uMode == 1) return gradientLookup(n);
  if (uMode == 2) return hsvToRgb(mod(uHsv.x + n * uHsv.y, 1.0), uHsv.z, uHsv.w);
  if (uMode == 4) return clamp(uCosA + uCosB * cos(6.28318530718 * (uCosC * n + uCosD)), 0.0, 1.0);
  float steps = float(uSteps);
  return gradientLookup(min(1.0, floor(n * steps) / (steps - 1.0)));
}

void main() {
  // CPU pixel (x, y) has y = 0 at the top and no half-pixel offset.
  float px = floor(gl_FragCoord.x);
  float py = uSize.y - 1.0 - floor(gl_FragCoord.y);
  float n1 = uLoop
    ? warped4(0, px * uScale.x, py * uScale.y, uZW.x, uZW.y, uOct)
    : warped3(0, px * uScale.x, py * uScale.y, uTz, uOct);
  float n = n1;
  if (uLayer) {
    float n2 = uLoop
      ? warped4(1, px * uL2Scale.x, py * uL2Scale.y, uZW.x, uZW.y, uL2Oct)
      : warped3(1, px * uL2Scale.x, py * uL2Scale.y, uTz, uL2Oct);
    n = n1 * (1.0 - uMix) + blendLayers(n1, n2) * uMix;
  }
  outColor = vec4(colorize(n), 1.0);
}`;

  const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  function isAvailable() {
    try {
      if (typeof document === "undefined") return false;
      return !!document.createElement("canvas").getContext("webgl2");
    } catch (e) { return false; }
  }

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("perlin-gl shader: " + log);
    }
    return sh;
  }

  /** Returns a renderer bound to its own off-screen WebGL canvas, or null. */
  function createRenderer() {
    if (typeof document === "undefined" || !root.MTPerlin) return null;
    const glCanvas = document.createElement("canvas");
    const gl = glCanvas.getContext("webgl2", {
      antialias: false, depth: false, stencil: false, alpha: false, premultipliedAlpha: false,
    });
    if (!gl) return null;

    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("perlin-gl link: " + gl.getProgramInfoLog(prog));
    } catch (e) {
      if (typeof console !== "undefined") console.warn(e.message);
      return null;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const loc = {};
    const U = (name) => (loc[name] = loc[name] || gl.getUniformLocation(prog, name));
    gl.uniform1i(U("uPerm"), 0);

    const maxDim = Math.min(gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0], gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    let permKey = null;
    let lost = false;
    glCanvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; });

    function uploadPerm(base, base2) {
      const key = base + "|" + base2;
      if (key === permKey) return;
      const data = new Uint8Array(1024);
      data.set(root.MTPerlin.makePermutation(base), 0);
      data.set(root.MTPerlin.makePermutation(base2), 512);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 512, 2, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      permKey = key;
    }

    /** True when this renderer produces the same image as the CPU path for `p`. */
    function supports(p) {
      if (lost || !p) return false;
      const mode = p.colorMode || "rgb";
      if (!(mode in COLOR_MODES)) return false;           // flow: several samples per pixel
      if (mode === "rgb" && p.rgbMultiChannel) return false;
      if ((mode === "gradient" || mode === "posterize") && (p.gradient || []).length > MAX_STOPS) return false;
      if ((p.octaves | 0) > MAX_OCTAVES || (p.layer2Octaves | 0) > MAX_OCTAVES) return false;
      if (p.width > maxDim || p.height > maxDim) return false;
      return true;
    }

    /** Render `p` and copy the result into the 2D context `ctx` (already sized to p). */
    function render(p, ctx) {
      const W = p.width, H = p.height;
      if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; }
      gl.viewport(0, 0, W, H);

      const base = p.base | 0;
      const isLayer = !!p.layer2On && (p.layer2Mix || 0) > 0;
      uploadPerm(base, isLayer ? (p.layer2Base | 0) : base);

      const rx = p.tileX || 0, ry = p.tileY || 0;
      const wsc = p.warpScale || 1;
      // With tiling on, the warp scale must be a whole number for the seam to close
      // (effectiveWarpScale in perlin.js).
      const warpScale = (rx > 0 || ry > 0) ? Math.max(1, Math.round(wsc)) : wsc;
      const scaleX = p.scaleX, scaleY = p.scaleY;

      gl.uniform2f(U("uSize"), W, H);
      gl.uniform2f(U("uScale"), scaleX, scaleY);
      gl.uniform2f(U("uL2Scale"), p.layer2ScaleX || scaleX, p.layer2ScaleY || scaleY);
      gl.uniform1i(U("uOct"), p.octaves | 0);
      gl.uniform1i(U("uL2Oct"), (p.layer2Octaves || p.octaves) | 0);
      gl.uniform1f(U("uPers"), p.persistence);
      gl.uniform1f(U("uLac"), p.lacunarity);
      gl.uniform1f(U("uWarpS"), p.warpStrength || 0);
      gl.uniform1f(U("uWarpScale"), warpScale);
      gl.uniform1i(U("uRepX"), rx | 0);
      gl.uniform1i(U("uRepY"), ry | 0);
      gl.uniform1i(U("uLayer"), isLayer ? 1 : 0);
      gl.uniform1i(U("uBlend"), BLEND_MODES[p.layer2BlendMode || "multiply"] ?? -1);
      gl.uniform1f(U("uMix"), p.layer2Mix || 0);

      gl.uniform1i(U("uLoop"), p.loop ? 1 : 0);
      if (p.loop) {
        // Same arithmetic as generatePerlinImage: progress is folded into [0, 1) first, so
        // progress 1 is computed exactly like progress 0.
        const radius = (p.loopRadius || 1) * (p.scaleT || 1);
        const safeProgress = ((p.loopProgress || 0) % 1 + 1) % 1;
        const alpha = safeProgress * Math.PI * 2;
        gl.uniform2f(U("uZW"), Math.cos(alpha) * radius, Math.sin(alpha) * radius);
      } else {
        gl.uniform1f(U("uTz"), (p.t || 0) * p.scaleT);
      }

      const mode = p.colorMode || "rgb";
      gl.uniform1i(U("uMode"), COLOR_MODES[mode]);
      if (mode === "rgb") {
        gl.uniform3f(U("uRgbScale"), p.rScale ?? 0, p.gScale ?? 1, p.bScale ?? 0);
        gl.uniform3f(U("uRgbInvert"), p.rInvert ? 1 : 0, p.gInvert ? 1 : 0, p.bInvert ? 1 : 0);
      } else if (mode === "hsv") {
        gl.uniform4f(U("uHsv"), p.hsvHueShift ?? 0, p.hsvHueRange ?? 1, p.hsvSat ?? 0.8, p.hsvVal ?? 1.0);
      } else if (mode === "cosine") {
        const q = p.cosine || {};
        gl.uniform3fv(U("uCosA"), q.a || [0.5, 0.5, 0.5]);
        gl.uniform3fv(U("uCosB"), q.b || [0.5, 0.5, 0.5]);
        gl.uniform3fv(U("uCosC"), q.c || [1, 1, 1]);
        gl.uniform3fv(U("uCosD"), q.d || [0, 0.33, 0.67]);
      } else {
        const stops = p.gradient || [];
        const pos = new Float32Array(MAX_STOPS), col = new Float32Array(MAX_STOPS * 3);
        for (let i = 0; i < stops.length; i++) {
          pos[i] = stops[i].pos;
          col[i * 3] = stops[i].color[0] / 255;
          col[i * 3 + 1] = stops[i].color[1] / 255;
          col[i * 3 + 2] = stops[i].color[2] / 255;
        }
        gl.uniform1i(U("uStopN"), stops.length);
        gl.uniform1fv(U("uStopPos"), pos);
        gl.uniform3fv(U("uStopColor"), col);
        gl.uniform1i(U("uSteps"), Math.max(2, p.posterizeSteps || 5));
      }

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (lost || gl.isContextLost()) throw new Error("perlin-gl: WebGL context lost");
      ctx.drawImage(glCanvas, 0, 0);
    }

    function destroy() {
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
      lost = true;
    }

    return { supports, render, destroy, canvas: glCanvas };
  }

  root.MTPerlinGL = { isAvailable, createRenderer, MAX_STOPS };
})(typeof window !== "undefined" ? window : globalThis);
