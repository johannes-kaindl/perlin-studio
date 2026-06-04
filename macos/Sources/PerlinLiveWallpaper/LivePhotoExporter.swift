import Foundation
import AVFoundation
import CoreVideo
import CoreMedia

/// Builds an Apple Live Photo pair (HEIC still + paired QuickTime .mov) from a
/// Perlin preset. The .mov carries the two markers Photos needs to treat it as a
/// Live Photo's motion (added in a later step): a top-level
/// `com.apple.quicktime.content.identifier` and a `still-image-time` timed-
/// metadata track. Frames are rendered offscreen via Renderer.renderBGRA.
enum LivePhotoExporter {

    /// Renders `preset` to a video file at `videoURL`. Returns true on success.
    /// (Metadata markers + still are layered on in later tasks.)
    static func writeVideo(preset: Preset, options o: LivePhotoExportOptions,
                           identifier: String, videoURL: URL) -> Bool {
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else { return false }
        try? FileManager.default.removeItem(at: videoURL)

        guard let writer = try? AVAssetWriter(outputURL: videoURL, fileType: .mov) else { return false }

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: o.width,
            AVVideoHeightKey: o.height,
        ]
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = false
        let pbAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: o.width,
            kCVPixelBufferHeightKey as String: o.height,
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput,
                                                           sourcePixelBufferAttributes: pbAttrs)
        guard writer.canAdd(videoInput) else { return false }
        writer.add(videoInput)

        guard writer.startWriting() else { return false }
        writer.startSession(atSourceTime: .zero)

        let queue = DispatchQueue(label: "page.codeberg.jkaindl.livephoto.video")
        let done = DispatchSemaphore(value: 0)
        var index = 0
        var ok = true

        videoInput.requestMediaDataWhenReady(on: queue) {
            while videoInput.isReadyForMoreMediaData {
                if index >= o.frameCount {
                    videoInput.markAsFinished()
                    done.signal()
                    return
                }
                let time = Double(index) / Double(o.fps)
                guard let bgra = Renderer.renderBGRA(gpu: gpu, preset: preset,
                                                     width: o.width, height: o.height, time: time),
                      let pool = adaptor.pixelBufferPool,
                      let pb = Self.pixelBuffer(from: bgra, width: o.width, height: o.height, pool: pool) else {
                    ok = false; videoInput.markAsFinished(); done.signal(); return
                }
                let pts = CMTime(value: Int64(index), timescale: Int32(o.fps))
                if !adaptor.append(pb, withPresentationTime: pts) { ok = false }
                index += 1
            }
        }
        done.wait()

        let finished = DispatchSemaphore(value: 0)
        writer.finishWriting { finished.signal() }
        finished.wait()
        return ok && writer.status == .completed
    }

    /// Wraps raw BGRA bytes (top-row-first, 4 bytes/px, as Renderer.renderBGRA
    /// returns) into a CVPixelBuffer from `pool`. kCVPixelFormatType_32BGRA byte
    /// order matches Metal's bgra8Unorm exactly, so this is a straight copy.
    static func pixelBuffer(from bgra: [UInt8], width: Int, height: Int,
                            pool: CVPixelBufferPool) -> CVPixelBuffer? {
        var pbOut: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pbOut) == kCVReturnSuccess,
              let pb = pbOut else { return nil }
        CVPixelBufferLockBaseAddress(pb, [])
        defer { CVPixelBufferUnlockBaseAddress(pb, []) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let dstStride = CVPixelBufferGetBytesPerRow(pb)
        let srcStride = width * 4
        bgra.withUnsafeBytes { src in
            for row in 0..<height {
                memcpy(base.advanced(by: row * dstStride),
                       src.baseAddress!.advanced(by: row * srcStride),
                       srcStride)
            }
        }
        return pb
    }

    /// Temporary smoke test (replaced by the full pair check in Task 5).
    static func selfTest() -> Bool {
        let store = PresetStore()
        guard let preset = store.presets.first else { print("livephoto selftest: no presets"); return false }
        let tmp = FileManager.default.temporaryDirectory
        let videoURL = tmp.appendingPathComponent("perlin-selftest.mov")
        let opts = LivePhotoExportOptions(width: 256, height: 512, duration: 0.5, fps: 10)
        let ok = writeVideo(preset: preset, options: opts, identifier: UUID().uuidString, videoURL: videoURL)
        guard ok else { print("livephoto selftest: writeVideo failed"); return false }
        let asset = AVURLAsset(url: videoURL)
        let dur = CMTimeGetSeconds(asset.duration)
        let pass = dur > 0.3 && dur < 0.8
        print("livephoto selftest: video dur=\(dur)s -> \(pass ? "PASS" : "FAIL")")
        try? FileManager.default.removeItem(at: videoURL)
        return pass
    }
}
