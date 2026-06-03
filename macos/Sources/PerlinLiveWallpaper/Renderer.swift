import Metal
import MetalKit
import simd
import CoreGraphics
import ImageIO

// Mirrors `struct Uniforms` in NoiseShader.swift exactly (field order + types).
// float2 first (8-byte aligned at offset 0), then all Float (4-byte), then all
// Int32 (4-byte). Don't reorder without re-checking the MSL struct.
private struct WallpaperUniforms {
    var resolution: SIMD2<Float>
    var tz: Float            // time folded by scaleT, CPU-side (see encode)
    var scaleX: Float
    var scaleY: Float
    var persistence: Float
    var lacunarity: Float
    var warpStrength: Float
    var warpScale: Float
    var presetHeight: Float
    var hsvHueShift: Float
    var hsvHueRange: Float
    var hsvSat: Float
    var hsvVal: Float
    var rScale: Float
    var gScale: Float
    var bScale: Float
    var flowHueShift: Float
    var flowSat: Float
    var flowGain: Float
    var flowFloor: Float
    var flowEps: Float
    var layer2ScaleX: Float
    var layer2ScaleY: Float
    var layer2Mix: Float
    var octaves: Int32
    var colorMode: Int32
    var posterizeSteps: Int32
    var rgbMultiChannel: Int32
    var rInvert: Int32
    var gInvert: Int32
    var bInvert: Int32
    var layer2On: Int32
    var layer2Octaves: Int32
    var layer2BlendMode: Int32
    var maskOn: Int32
    var maskInvert: Int32
}

/// Renders one view's frames. Holds only the cheap per-preset GPU resources
/// (permutation buffer + gradient LUT); the device, queue, pipeline and sampler
/// are shared via `GPUContext`, so swapping presets or rebuilding windows never
/// recompiles the shader.
///
/// Threading: `draw`/`encode` and `update` must run on the same (main) thread —
/// the MTKView delegate drives drawing on the main run loop and the menu mutates
/// presets there too, so the unsynchronized resource swap in `update` is safe.
final class Renderer {
    private let gpu: GPUContext
    private var permBuffer: MTLBuffer
    private var permBuffer2: MTLBuffer   // layer-2 permutation (layer2Base)
    private var gradientTexture: MTLTexture
    private var maskTexture: MTLTexture   // 1x1 white dummy when no mask
    private var maskOn = false
    private var maskInvert = false
    private var preset: Preset
    private var permBase: Int
    private var permBase2: Int

    init?(gpu: GPUContext, preset: Preset) {
        self.gpu = gpu
        self.preset = preset
        self.permBase = preset.base
        self.permBase2 = preset.layer2Base ?? 0
        guard let pb = Renderer.makePermBuffer(device: gpu.device, base: permBase) else { return nil }
        self.permBuffer = pb
        guard let pb2 = Renderer.makePermBuffer(device: gpu.device, base: permBase2) else { return nil }
        self.permBuffer2 = pb2
        guard let gt = Renderer.makeGradientTexture(device: gpu.device, preset: preset) else { return nil }
        self.gradientTexture = gt
        guard let dummy = Renderer.makeWhiteMask(device: gpu.device) else { return nil }
        self.maskTexture = dummy
    }

    /// Set or clear the image mask. `base64Png` is a (data-URL or bare) PNG; the
    /// alpha-or-luminance is baked into an R8 texture exactly like the studio.
    func setMask(base64Png: String?, invert: Bool) {
        dispatchPrecondition(condition: .onQueue(.main))
        maskInvert = invert
        if let b64 = base64Png, let tex = Renderer.makeMaskTexture(device: gpu.device, base64Png: b64) {
            maskTexture = tex
            maskOn = true
        } else {
            maskOn = false
            if let dummy = Renderer.makeWhiteMask(device: gpu.device) { maskTexture = dummy }
        }
    }

    func update(preset: Preset) {
        dispatchPrecondition(condition: .onQueue(.main))
        self.preset = preset
        if preset.base != permBase, let pb = Renderer.makePermBuffer(device: gpu.device, base: preset.base) {
            permBase = preset.base
            permBuffer = pb
        }
        let base2 = preset.layer2Base ?? 0
        if base2 != permBase2, let pb2 = Renderer.makePermBuffer(device: gpu.device, base: base2) {
            permBase2 = base2
            permBuffer2 = pb2
        }
        if let gt = Renderer.makeGradientTexture(device: gpu.device, preset: preset) {
            gradientTexture = gt
        }
    }

    func draw(in view: MTKView, time: Double) {
        guard let rpd = view.currentRenderPassDescriptor else { return }
        encode(passDescriptor: rpd, drawableSize: view.drawableSize,
               drawable: view.currentDrawable, time: time)
    }

    /// Encodes one frame into `rpd`. Presents `drawable` if given (on-screen);
    /// leaves it off for offscreen / self-test rendering.
    @discardableResult
    func encode(passDescriptor rpd: MTLRenderPassDescriptor, drawableSize size: CGSize,
                drawable: MTLDrawable?, time: Double) -> MTLCommandBuffer? {
        guard let cmd = gpu.queue.makeCommandBuffer(),
              let enc = cmd.makeRenderCommandEncoder(descriptor: rpd) else { return nil }
        // Fold scaleT into the time axis on the CPU (in Double) and narrow the
        // smaller tz, not the raw seconds — keeps the per-frame step Float-
        // representable far longer. tz still grows unbounded, so after several
        // days of uninterrupted uptime the animation gradually slows; a restart
        // or preset change resets it. Accepted low-severity tradeoff; a bounded
        // wrap can't be seamless for non-integer lacunarity, so it's avoided.
        let tz = time * preset.scaleT
        func flag(_ b: Bool?) -> Int32 { (b ?? false) ? 1 : 0 }
        var u = WallpaperUniforms(
            resolution: SIMD2<Float>(Float(size.width), Float(size.height)),
            tz: Float(tz),
            scaleX: Float(preset.scaleX),
            scaleY: Float(preset.scaleY),
            persistence: Float(preset.persistence),
            lacunarity: Float(preset.lacunarity),
            warpStrength: Float(preset.warpStrength ?? 0),
            warpScale: Float(preset.warpScale ?? 1),
            presetHeight: Float(preset.height),
            hsvHueShift: Float(preset.hsvHueShift ?? 0),
            hsvHueRange: Float(preset.hsvHueRange ?? 1),
            hsvSat: Float(preset.hsvSat ?? 0.8),
            hsvVal: Float(preset.hsvVal ?? 1.0),
            rScale: Float(preset.rScale ?? 1),
            gScale: Float(preset.gScale ?? 1),
            bScale: Float(preset.bScale ?? 1),
            flowHueShift: Float(preset.flowHueShift ?? 0),
            flowSat: Float(preset.flowSat ?? 0.85),
            flowGain: Float(preset.flowGain ?? 1),
            flowFloor: Float(preset.flowFloor ?? 0),
            flowEps: Float(preset.flowEps ?? 0.6),
            layer2ScaleX: Float(preset.layer2ScaleX ?? preset.scaleX),
            layer2ScaleY: Float(preset.layer2ScaleY ?? preset.scaleY),
            layer2Mix: Float(preset.layer2Mix ?? 0),
            octaves: Int32(preset.octaves),
            colorMode: preset.colorModeIndex,
            posterizeSteps: Int32(preset.posterizeSteps ?? 5),
            rgbMultiChannel: flag(preset.rgbMultiChannel),
            rInvert: flag(preset.rInvert),
            gInvert: flag(preset.gInvert),
            bInvert: flag(preset.bInvert),
            layer2On: flag(preset.layer2On),
            layer2Octaves: Int32(preset.layer2Octaves ?? preset.octaves),
            layer2BlendMode: preset.layer2BlendModeIndex,
            maskOn: maskOn ? 1 : 0,
            maskInvert: maskInvert ? 1 : 0
        )
        enc.setRenderPipelineState(gpu.pipeline)
        enc.setFragmentBytes(&u, length: MemoryLayout<WallpaperUniforms>.stride, index: 0)
        enc.setFragmentBuffer(permBuffer, offset: 0, index: 1)
        enc.setFragmentBuffer(permBuffer2, offset: 0, index: 2)
        enc.setFragmentTexture(gradientTexture, index: 0)
        enc.setFragmentTexture(maskTexture, index: 1)
        enc.setFragmentSamplerState(gpu.sampler, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.endEncoding()
        if let drawable = drawable { cmd.present(drawable) }
        cmd.commit()
        return cmd
    }

    // Exact port of makePermutation(base): shift BASE_PERM, duplicate to 512.
    private static func makePermBuffer(device: MTLDevice, base: Int) -> MTLBuffer? {
        let offset = ((base % 256) + 256) % 256
        var perm = [UInt32](repeating: 0, count: 512)
        for i in 0..<256 { perm[i] = UInt32(BASE_PERM[(i + offset) & 255]) }
        for i in 256..<512 { perm[i] = perm[i - 256] }
        return device.makeBuffer(bytes: perm, length: 512 * MemoryLayout<UInt32>.stride, options: [])
    }

    // 256x1 RGBA LUT baked from the preset's gradient stops (exact port of
    // gradientLookup). Bake at texel CENTERS ((i+0.5)/256) so the shader's
    // linear sampler reconstructs the gradient without a half-texel shift.
    private static func makeGradientTexture(device: MTLDevice, preset: Preset) -> MTLTexture? {
        let stops = (preset.gradient?.isEmpty == false) ? preset.gradient! : grayscale
        let sorted = stops.sorted { $0.pos < $1.pos }
        var lut = [UInt8](repeating: 255, count: 256 * 4)
        for i in 0..<256 {
            let c = gradientLookup(sorted, (Double(i) + 0.5) / 256.0)
            lut[i * 4 + 0] = UInt8(clamping: c.0)
            lut[i * 4 + 1] = UInt8(clamping: c.1)
            lut[i * 4 + 2] = UInt8(clamping: c.2)
            lut[i * 4 + 3] = 255
        }
        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: 256, height: 1, mipmapped: false)
        td.usage = .shaderRead
        guard let tex = device.makeTexture(descriptor: td) else { return nil }
        tex.replace(region: MTLRegionMake2D(0, 0, 256, 1), mipmapLevel: 0, withBytes: lut, bytesPerRow: 256 * 4)
        return tex
    }

    private static let grayscale: [GradientStop] = [
        GradientStop(pos: 0, color: [0, 0, 0]),
        GradientStop(pos: 1, color: [255, 255, 255]),
    ]

    // 1x1 fully-white R8 mask — used when no mask is set (alpha stays 1).
    private static func makeWhiteMask(device: MTLDevice) -> MTLTexture? {
        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm, width: 1, height: 1, mipmapped: false)
        td.usage = .shaderRead
        guard let tex = device.makeTexture(descriptor: td) else { return nil }
        var white: UInt8 = 255
        tex.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &white, bytesPerRow: 1)
        return tex
    }

    // Bake a PNG into an R8 mask: the image's alpha, or its Rec.709 luminance if
    // the image is fully opaque — exactly the studio's rule. Flipped so row 0 is
    // the top, matching the shader's top-left screen sampling.
    private static func makeMaskTexture(device: MTLDevice, base64Png: String) -> MTLTexture? {
        let b64: String
        if base64Png.hasPrefix("data:"), let comma = base64Png.firstIndex(of: ",") {
            b64 = String(base64Png[base64Png.index(after: comma)...])
        } else {
            b64 = base64Png
        }
        guard let data = Data(base64Encoded: b64),
              let src = CGImageSourceCreateWithData(data as CFData, nil),
              let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
        let w = cg.width, h = cg.height
        guard w > 0, h > 0 else { return nil }

        var px = [UInt8](repeating: 0, count: w * h * 4)
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: w * 4, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        // No flip: CGBitmapContext lays out row 0 = top, which matches the
        // shader's top-down screen sampling (in.position.y = 0 at the top).
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

        var mask = [UInt8](repeating: 0, count: w * h)
        var anyTransparent = false
        for i in 0..<(w * h) {
            let a = px[i * 4 + 3]
            if a < 255 { anyTransparent = true }
            mask[i] = a
        }
        if !anyTransparent {
            for i in 0..<(w * h) {
                let r = Double(px[i * 4 + 0]), g = Double(px[i * 4 + 1]), b = Double(px[i * 4 + 2])
                mask[i] = UInt8((0.2126 * r + 0.7152 * g + 0.0722 * b).rounded())
            }
        }
        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm, width: w, height: h, mipmapped: false)
        td.usage = .shaderRead
        guard let tex = device.makeTexture(descriptor: td) else { return nil }
        tex.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: mask, bytesPerRow: w)
        return tex
    }

    // Exact port of gradientLookup — piecewise-linear over sorted stops.
    private static func gradientLookup(_ stops: [GradientStop], _ tIn: Double) -> (Int, Int, Int) {
        let t = min(1.0, max(0.0, tIn))
        guard let firstStop = stops.first, let lastStop = stops.last else { return (0, 0, 0) }
        if stops.count == 1 { return (firstStop.color[0], firstStop.color[1], firstStop.color[2]) }
        if t <= firstStop.pos { return (firstStop.color[0], firstStop.color[1], firstStop.color[2]) }
        if t >= lastStop.pos { return (lastStop.color[0], lastStop.color[1], lastStop.color[2]) }
        for i in 1..<stops.count {
            let a = stops[i - 1], b = stops[i]
            if t <= b.pos {
                let span = b.pos - a.pos
                let u = span > 0 ? (t - a.pos) / span : 0
                return (
                    Int((Double(a.color[0]) + (Double(b.color[0]) - Double(a.color[0])) * u).rounded()),
                    Int((Double(a.color[1]) + (Double(b.color[1]) - Double(a.color[1])) * u).rounded()),
                    Int((Double(a.color[2]) + (Double(b.color[2]) - Double(a.color[2])) * u).rounded())
                )
            }
        }
        return (lastStop.color[0], lastStop.color[1], lastStop.color[2])
    }

    /// Compiles the shader, builds the pipeline and renders every bundled preset
    /// offscreen, asserting each produces a non-trivial, varied field. Validates
    /// the runtime-compiled MSL and all colour/warp paths that `swift build`
    /// can't reach. Returns true only if all presets pass.
    static func selfTest() -> Bool {
        let dim = 64
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else {
            log("selftest: no Metal device / pipeline"); return false
        }
        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: dim, height: dim, mipmapped: false)
        td.usage = [.renderTarget, .shaderRead]
        td.storageMode = .shared
        guard let tex = gpu.device.makeTexture(descriptor: td) else { log("selftest: no texture"); return false }

        let presets = PresetStore().presets
        guard !presets.isEmpty else { log("selftest: no presets loaded"); return false }

        var allPass = true
        for preset in presets {
            guard let renderer = Renderer(gpu: gpu, preset: preset) else {
                log("selftest: \(preset.label) renderer init failed"); allPass = false; continue
            }
            let rpd = MTLRenderPassDescriptor()
            rpd.colorAttachments[0].texture = tex
            rpd.colorAttachments[0].loadAction = .clear
            rpd.colorAttachments[0].storeAction = .store
            rpd.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1)
            let cmd = renderer.encode(passDescriptor: rpd, drawableSize: CGSize(width: dim, height: dim), drawable: nil, time: 1.0)
            cmd?.waitUntilCompleted()

            var buf = [UInt8](repeating: 0, count: dim * dim * 4)
            tex.getBytes(&buf, bytesPerRow: dim * 4, from: MTLRegionMake2D(0, 0, dim, dim), mipmapLevel: 0)
            // Varied = any pixel differs from the first in any channel. Robust
            // across colour modes (hsv keeps max(r,g,b)=255 but the hue varies).
            let b0 = buf[0], g0 = buf[1], r0 = buf[2]
            var anyNonBlack = false
            var varied = false
            for i in stride(from: 0, to: buf.count, by: 4) {
                let b = buf[i], g = buf[i + 1], r = buf[i + 2]
                if b != 0 || g != 0 || r != 0 { anyNonBlack = true }
                if b != b0 || g != g0 || r != r0 { varied = true }
            }
            let pass = anyNonBlack && varied
            if !pass { allPass = false }
            log("selftest: \(preset.label) [\(preset.colorMode)] nonBlack=\(anyNonBlack) varied=\(varied) -> \(pass ? "PASS" : "FAIL")")
        }
        if !checkMask(gpu: gpu) { allPass = false }
        log("selftest: \(allPass ? "ALL PASS" : "FAILURES") (\(presets.count) presets + mask)")
        return allPass
    }

    /// Verifies the mask path end-to-end across both axes and both source rules.
    /// Test 1 (opaque -> luminance): a 2x2 checkerboard (top [black,white],
    /// bottom [white,black]) catches an X- or Y-flip. Test 2 (transparency ->
    /// alpha branch): left opaque / right transparent, with invert. Masked-out
    /// pixels must be premultiplied-alpha 0, visible ones 255.
    private static func checkMask(gpu: GPUContext) -> Bool {
        let dim = 64
        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: dim, height: dim, mipmapped: false)
        td.usage = [.renderTarget, .shaderRead]; td.storageMode = .shared
        guard let tex = gpu.device.makeTexture(descriptor: td),
              let renderer = Renderer(gpu: gpu, preset: PresetStore.fallback) else { return false }

        func render(png: String, invert: Bool) -> [UInt8]? {
            renderer.setMask(base64Png: png, invert: invert)
            let rpd = MTLRenderPassDescriptor()
            rpd.colorAttachments[0].texture = tex
            rpd.colorAttachments[0].loadAction = .clear
            rpd.colorAttachments[0].storeAction = .store
            rpd.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)
            renderer.encode(passDescriptor: rpd, drawableSize: CGSize(width: dim, height: dim), drawable: nil, time: 1.0)?.waitUntilCompleted()
            var buf = [UInt8](repeating: 0, count: dim * dim * 4)
            tex.getBytes(&buf, bytesPerRow: dim * 4, from: MTLRegionMake2D(0, 0, dim, dim), mipmapLevel: 0)
            return buf
        }
        func a(_ buf: [UInt8], _ x: Int, _ y: Int) -> Int { Int(buf[(y * dim + x) * 4 + 3]) }

        // Test 1: opaque luminance checkerboard (top black|white, bottom white|black).
        let lum: [UInt8] = [0,0,0,255, 255,255,255,255,  255,255,255,255, 0,0,0,255]
        guard let p1 = pngBase64(rgba: lum, width: 2, height: 2), let b1 = render(png: p1, invert: false) else { return false }
        let tl = a(b1, 4, 4), tr = a(b1, dim - 5, 4), bl = a(b1, 4, dim - 5), br = a(b1, dim - 5, dim - 5)
        let t1 = tl < 10 && tr > 245 && bl > 245 && br < 10

        // Test 2: transparency-driven alpha (left opaque, right transparent) + invert.
        let alp: [UInt8] = [255,255,255,255, 0,0,0,0,  255,255,255,255, 0,0,0,0]
        guard let p2 = pngBase64(rgba: alp, width: 2, height: 2),
              let b2 = render(png: p2, invert: false), let b2i = render(png: p2, invert: true) else { return false }
        let l2 = a(b2, 4, 32), r2 = a(b2, dim - 5, 32), l2i = a(b2i, 4, 32), r2i = a(b2i, dim - 5, 32)
        let t2 = l2 > 245 && r2 < 10 && l2i < 10 && r2i > 245

        let pass = t1 && t2
        log("masktest: lum[TL=\(tl) TR=\(tr) BL=\(bl) BR=\(br)] alpha[L=\(l2) R=\(r2) invL=\(l2i) invR=\(r2i)] -> \(pass ? "PASS" : "FAIL")")
        return pass
    }

    private static func pngBase64(rgba: [UInt8], width: Int, height: Int) -> String? {
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let provider = CGDataProvider(data: Data(rgba) as CFData),
              let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                               bytesPerRow: width * 4, space: cs,
                               bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                               provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { return nil }
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cg, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return (data as Data).base64EncodedString()
    }

    private static func log(_ s: String) { FileHandle.standardError.write(Data((s + "\n").utf8)) }

    /// Renders one preset offscreen and returns the raw BGRA8 bytes. Used by the
    /// `--render` CLI for PNG export and visual-parity checks against the studio.
    static func renderBGRA(gpu: GPUContext, preset: Preset, width: Int, height: Int, time: Double) -> [UInt8]? {
        guard let renderer = Renderer(gpu: gpu, preset: preset) else { return nil }
        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
        td.usage = [.renderTarget, .shaderRead]
        td.storageMode = .shared
        guard let tex = gpu.device.makeTexture(descriptor: td) else { return nil }
        let rpd = MTLRenderPassDescriptor()
        rpd.colorAttachments[0].texture = tex
        rpd.colorAttachments[0].loadAction = .clear
        rpd.colorAttachments[0].storeAction = .store
        rpd.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1)
        let cmd = renderer.encode(passDescriptor: rpd, drawableSize: CGSize(width: width, height: height), drawable: nil, time: time)
        cmd?.waitUntilCompleted()
        var buf = [UInt8](repeating: 0, count: width * height * 4)
        tex.getBytes(&buf, bytesPerRow: width * 4, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
        return buf
    }
}

// The classic Perlin permutation base (from perlin.js). Shifted per seed.
let BASE_PERM: [Int] = [
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
]
