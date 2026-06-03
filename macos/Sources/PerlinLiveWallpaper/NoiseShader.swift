import Foundation

/// The Metal Shading Language source, compiled at runtime via
/// `device.makeLibrary(source:)`.
///
/// A faithful port of `perlin.js` — the **non-tiling 3D advancing-time** path —
/// covering every studio colour mode except `tile` and image `mask`:
/// gradient / posterize / hsv / rgb (incl. per-channel "nebula") / flow, plus
/// the domain warp and a second-layer (`layer2`) composite. The permutation
/// table(s) are computed Swift-side (exact port of `makePermutation`) so seeds
/// match the studio bit-for-bit.
enum NoiseShader {
    static let source = """
    #include <metal_stdlib>
    using namespace metal;

    struct Uniforms {
        float2 resolution;
        float tz;            // time axis, already folded by scaleT on the CPU
        float scaleX;
        float scaleY;
        float persistence;
        float lacunarity;
        float warpStrength;
        float warpScale;
        float presetHeight;
        float hsvHueShift;
        float hsvHueRange;
        float hsvSat;
        float hsvVal;
        float rScale;
        float gScale;
        float bScale;
        float flowHueShift;
        float flowSat;
        float flowGain;
        float flowFloor;
        float flowEps;
        float layer2ScaleX;
        float layer2ScaleY;
        float layer2Mix;
        int octaves;
        int colorMode;       // 0 gradient, 1 posterize, 2 hsv, 3 rgb, 4 flow
        int posterizeSteps;
        int rgbMultiChannel;  // 0/1
        int rInvert;          // 0/1
        int gInvert;
        int bInvert;
        int layer2On;         // 0/1
        int layer2Octaves;
        int layer2BlendMode;  // 0 multiply,1 add,2 screen,3 darken,4 lighten,5 difference
    };

    // Ken Perlin's fade polynomial 6t^5 - 15t^4 + 10t^3.
    inline float fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

    inline float grad3(uint hash, float x, float y, float z) {
        uint h = hash & 15u;
        float u = h < 8u ? x : y;
        float v = h < 4u ? y : ((h == 12u || h == 14u) ? x : z);
        return ((h & 1u) == 0u ? u : -u) + ((h & 2u) == 0u ? v : -v);
    }

    inline float perlin3(device const uint *perm, float x, float y, float z) {
        float fx = floor(x), fy = floor(y), fz = floor(z);
        uint Xa = uint(int(fx) & 255), Xb = uint((int(fx) + 1) & 255);
        uint Ya = uint(int(fy) & 255), Yb = uint((int(fy) + 1) & 255);
        uint Za = uint(int(fz) & 255), Zb = uint((int(fz) + 1) & 255);
        x -= fx; y -= fy; z -= fz;
        float u = fade(x), v = fade(y), w = fade(z);
        uint Aa = perm[Xa] + Ya, Ab = perm[Xa] + Yb;
        uint Ba = perm[Xb] + Ya, Bb = perm[Xb] + Yb;
        uint Aa0 = perm[Aa] + Za, Aa1 = perm[Aa] + Zb;
        uint Ab0 = perm[Ab] + Za, Ab1 = perm[Ab] + Zb;
        uint Ba0 = perm[Ba] + Za, Ba1 = perm[Ba] + Zb;
        uint Bb0 = perm[Bb] + Za, Bb1 = perm[Bb] + Zb;
        return mix(
            mix(
                mix(grad3(perm[Aa0], x,       y,       z),       grad3(perm[Ba0], x - 1.0, y,       z),       u),
                mix(grad3(perm[Ab0], x,       y - 1.0, z),       grad3(perm[Bb0], x - 1.0, y - 1.0, z),       u), v),
            mix(
                mix(grad3(perm[Aa1], x,       y,       z - 1.0), grad3(perm[Ba1], x - 1.0, y,       z - 1.0), u),
                mix(grad3(perm[Ab1], x,       y - 1.0, z - 1.0), grad3(perm[Bb1], x - 1.0, y - 1.0, z - 1.0), u), v),
            w);
    }

    inline float fbm3(device const uint *perm, float x, float y, float z,
                      int octaves, float persistence, float lacunarity) {
        float amp = 1.0, freq = 1.0, sum = 0.0, norm = 0.0;
        for (int o = 0; o < octaves; ++o) {
            sum  += amp * perlin3(perm, x * freq, y * freq, z * freq);
            norm += amp;
            amp  *= persistence;
            freq *= lacunarity;
        }
        float n = norm > 0.0 ? sum / norm : 0.0;
        return (n + 1.0) * 0.5;
    }

    inline float warpedFbm3(device const uint *perm, float x, float y, float z,
                            int octaves, float persistence, float lacunarity,
                            float warpStrength, float warpScale) {
        if (warpStrength == 0.0) return fbm3(perm, x, y, z, octaves, persistence, lacunarity);
        float s = (warpScale == 0.0) ? 1.0 : warpScale;
        float dx = perlin3(perm, x * s + 137.0, y * s +  23.0, z) * warpStrength;
        float dy = perlin3(perm, x * s + 211.0, y * s -  53.0, z) * warpStrength;
        return fbm3(perm, x + dx, y + dy, z, octaves, persistence, lacunarity);
    }

    inline float blendLayers(float a, float b, int mode) {
        if (mode == 1) return min(a + b, 1.0);            // add
        if (mode == 2) return 1.0 - (1.0 - a) * (1.0 - b); // screen
        if (mode == 3) return min(a, b);                   // darken
        if (mode == 4) return max(a, b);                   // lighten
        if (mode == 5) return abs(a - b);                  // difference
        return a * b;                                      // multiply (0)
    }

    inline float3 hsv2rgb(float h, float s, float v) {
        h = fract(h);
        float i = floor(h * 6.0);
        float f = h * 6.0 - i;
        float p = v * (1.0 - s);
        float q = v * (1.0 - f * s);
        float t = v * (1.0 - (1.0 - f) * s);
        int ii = int(i) % 6;
        if (ii == 0) return float3(v, t, p);
        if (ii == 1) return float3(q, v, p);
        if (ii == 2) return float3(p, v, t);
        if (ii == 3) return float3(p, q, v);
        if (ii == 4) return float3(t, p, v);
        return float3(v, p, q);
    }

    struct VSOut { float4 position [[position]]; };

    // Full-screen triangle — no vertex buffer needed.
    vertex VSOut wallpaper_vertex(uint vid [[vertex_id]]) {
        float2 p = float2(float((vid << 1) & 2), float(vid & 2));
        VSOut o;
        o.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
        return o;
    }

    fragment float4 wallpaper_fragment(VSOut in [[stage_in]],
                                       constant Uniforms &U [[buffer(0)]],
                                       device const uint *perm  [[buffer(1)]],
                                       device const uint *perm2 [[buffer(2)]],
                                       texture2d<float> gradTex [[texture(0)]],
                                       sampler samp [[sampler(0)]]) {
        // Map screen pixels to the preset's noise space, anchored on height so a
        // wider screen reveals more horizontally without stretching.
        float k = U.presetHeight / U.resolution.y;
        float cx = in.position.x * U.scaleX * k;
        float cy = in.position.y * U.scaleY * k;
        float tz = U.tz;
        float3 rgb;

        if (U.colorMode == 4) {                 // flow: noise gradient -> hue
            float ex = U.flowEps * U.scaleX;     // noise-space stencil step (= studio eps*scaleX)
            float ey = U.flowEps * U.scaleY;
            float n0 = warpedFbm3(perm, cx,      cy,      tz, U.octaves, U.persistence, U.lacunarity, U.warpStrength, U.warpScale);
            float n1 = warpedFbm3(perm, cx + ex, cy,      tz, U.octaves, U.persistence, U.lacunarity, U.warpStrength, U.warpScale);
            float n2 = warpedFbm3(perm, cx,      cy + ey, tz, U.octaves, U.persistence, U.lacunarity, U.warpStrength, U.warpScale);
            float dx = n1 - n0, dy = n2 - n0;
            float hue = fract(atan2(dy, dx) / (2.0 * M_PI_F) + 0.5 + U.flowHueShift);
            float mag = sqrt(dx * dx + dy * dy);
            float val = clamp(U.flowFloor + mag * U.flowGain * (1.0 - U.flowFloor), 0.0, 1.0);
            rgb = hsv2rgb(hue, U.flowSat, val);
        } else if (U.colorMode == 3 && U.rgbMultiChannel != 0) {  // nebula: 3 offset fields
            float nr = warpedFbm3(perm, cx,        cy,        tz, U.octaves, U.persistence, U.lacunarity, U.warpStrength, U.warpScale);
            float ng = warpedFbm3(perm, cx + 53.0, cy,        tz, U.octaves, U.persistence, U.lacunarity, U.warpStrength, U.warpScale);
            float nb = warpedFbm3(perm, cx,        cy + 71.0, tz, U.octaves, U.persistence, U.lacunarity, U.warpStrength, U.warpScale);
            float r = (U.rInvert != 0 ? 1.0 - nr : nr) * U.rScale;
            float g = (U.gInvert != 0 ? 1.0 - ng : ng) * U.gScale;
            float b = (U.bInvert != 0 ? 1.0 - nb : nb) * U.bScale;
            rgb = clamp(float3(r, g, b), 0.0, 1.0);
        } else {                                 // single sample (+ optional layer 2)
            float n1 = warpedFbm3(perm, cx, cy, tz, U.octaves, U.persistence, U.lacunarity, U.warpStrength, U.warpScale);
            float n = n1;
            if (U.layer2On != 0) {
                float l2x = in.position.x * U.layer2ScaleX * k;
                float l2y = in.position.y * U.layer2ScaleY * k;
                float n2 = warpedFbm3(perm2, l2x, l2y, tz, U.layer2Octaves, U.persistence, U.lacunarity, U.warpStrength, U.warpScale);
                n = n1 * (1.0 - U.layer2Mix) + blendLayers(n1, n2, U.layer2BlendMode) * U.layer2Mix;
            }
            if (U.colorMode == 2) {              // hsv
                rgb = hsv2rgb(U.hsvHueShift + n * U.hsvHueRange, U.hsvSat, U.hsvVal);
            } else if (U.colorMode == 1) {       // posterize
                float steps = float(max(2, U.posterizeSteps));
                float q = min(floor(n * steps) / (steps - 1.0), 1.0);
                rgb = gradTex.sample(samp, float2(q, 0.5)).rgb;
            } else if (U.colorMode == 3) {       // rgb, single-channel
                float r = (U.rInvert != 0 ? 1.0 - n : n) * U.rScale;
                float g = (U.gInvert != 0 ? 1.0 - n : n) * U.gScale;
                float b = (U.bInvert != 0 ? 1.0 - n : n) * U.bScale;
                rgb = clamp(float3(r, g, b), 0.0, 1.0);
            } else {                              // gradient
                rgb = gradTex.sample(samp, float2(n, 0.5)).rgb;
            }
        }
        return float4(rgb, 1.0);
    }
    """
}
