import Foundation
import Metal

/// Process-wide Metal state built **once**: the device, command queue, the
/// (runtime-compiled) render pipeline and the gradient sampler. Shared by every
/// on-screen view so a display-arrangement change never recompiles the shader
/// or spins up a second device — it just rebuilds cheap per-preset resources.
final class GPUContext {
    let device: MTLDevice
    let queue: MTLCommandQueue
    let pipeline: MTLRenderPipelineState
    let sampler: MTLSamplerState

    /// `pixelFormat` must match the render targets (MTKView drawable + the
    /// self-test texture both use `.bgra8Unorm`).
    init?(pixelFormat: MTLPixelFormat) {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue() else { return nil }
        do {
            let library = try device.makeLibrary(source: NoiseShader.source, options: nil)
            guard let vfn = library.makeFunction(name: "wallpaper_vertex"),
                  let ffn = library.makeFunction(name: "wallpaper_fragment") else { return nil }
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = vfn
            desc.fragmentFunction = ffn
            desc.colorAttachments[0].pixelFormat = pixelFormat
            self.pipeline = try device.makeRenderPipelineState(descriptor: desc)
        } catch {
            FileHandle.standardError.write(Data("Metal pipeline error: \(error)\n".utf8))
            return nil
        }

        let sd = MTLSamplerDescriptor()
        sd.minFilter = .linear
        sd.magFilter = .linear
        sd.sAddressMode = .clampToEdge
        sd.tAddressMode = .clampToEdge
        guard let sampler = device.makeSamplerState(descriptor: sd) else { return nil }

        self.device = device
        self.queue = queue
        self.sampler = sampler
    }
}
