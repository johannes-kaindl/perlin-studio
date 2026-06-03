import Foundation

/// The Metal Shading Language source, compiled at runtime via
/// `device.makeLibrary(source:)` so the package needs no Xcode metallib step
/// and stays `swift build`-able.
///
/// This is a direct port of `perlin.js` — the **non-tiling 3D advancing-time**
/// path only (a wallpaper wants infinite, never-repeating motion, not a loop).
/// The permutation table is computed Swift-side (exact port of
/// `makePermutation`) and passed in as a 512-entry buffer, so the seed matches
/// the studio bit-for-bit. Colour covers gradient / posterize / hsv.
enum NoiseShader {
    static let source = """
    #include <metal_stdlib>
    using namespace metal;

    struct Uniforms {
        float2 resolution;
        float tz;          // time axis, already folded by scaleT on the CPU
        float scaleX;
        float scaleY;
        float persistence;
        float lacunarity;
        float warpStrength;
        float warpScale;
        float hsvHueShift;
        float hsvHueRange;
        float hsvSat;
        float hsvVal;
        float presetHeight;
        int octaves;
        int colorMode;     // 0 gradient, 1 posterize, 2 hsv
        int posterizeSteps;
    };

    // Ken Perlin's fade polynomial 6t^5 - 15t^4 + 10t^3.
    inline float fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

    inline float grad3(uint hash, float x, float y, float z) {
        uint h = hash & 15u;
        float u = h < 8u ? x : y;
        float v = h < 4u ? y : ((h == 12u || h == 14u) ? x : z);
        return ((h & 1u) == 0u ? u : -u) + ((h & 2u) == 0u ? v : -v);
    }

    // perm holds 512 entries (duplicated 256) so the +1 lookups never wrap.
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

    // Inigo-Quilez-style domain warp: two decorrelated single-octave
    // displacements (137/23 and 211/-53) before the main fbm.
    inline float warpedFbm3(device const uint *perm, float x, float y, float z,
                            int octaves, float persistence, float lacunarity,
                            float warpStrength, float warpScale) {
        if (warpStrength == 0.0) return fbm3(perm, x, y, z, octaves, persistence, lacunarity);
        float s = (warpScale == 0.0) ? 1.0 : warpScale;
        float dx = perlin3(perm, x * s + 137.0, y * s +  23.0, z) * warpStrength;
        float dy = perlin3(perm, x * s + 211.0, y * s -  53.0, z) * warpStrength;
        return fbm3(perm, x + dx, y + dy, z, octaves, persistence, lacunarity);
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
                                       device const uint *perm [[buffer(1)]],
                                       texture2d<float> gradTex [[texture(0)]],
                                       sampler samp [[sampler(0)]]) {
        // Map screen pixels to the preset's noise space, anchored on height so
        // a wider screen reveals more horizontally without stretching.
        float k = U.presetHeight / U.resolution.y;
        float cx = in.position.x * U.scaleX * k;
        float cy = in.position.y * U.scaleY * k;
        float tz = U.tz;
        float n = warpedFbm3(perm, cx, cy, tz, U.octaves, U.persistence, U.lacunarity,
                             U.warpStrength, U.warpScale);
        float3 rgb;
        if (U.colorMode == 2) {
            float hue = U.hsvHueShift + n * U.hsvHueRange;
            rgb = hsv2rgb(hue, U.hsvSat, U.hsvVal);
        } else if (U.colorMode == 1) {
            float steps = float(max(2, U.posterizeSteps));
            float q = min(floor(n * steps) / (steps - 1.0), 1.0);
            rgb = gradTex.sample(samp, float2(q, 0.5)).rgb;
        } else {
            rgb = gradTex.sample(samp, float2(n, 0.5)).rgb;
        }
        return float4(rgb, 1.0);
    }
    """
}
