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

        // Top-level movie identifier (pairs the .mov with the HEIC still).
        writer.metadata = [contentIdentifierItem(identifier)]

        // still-image-time timed-metadata track.
        guard let stillDesc = stillTimeFormatDescription() else { return false }
        let metaInput = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: stillDesc)
        metaInput.expectsMediaDataInRealTime = false
        let metaAdaptor = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metaInput)
        guard writer.canAdd(metaInput) else { return false }
        writer.add(metaInput)

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

        // One metadata sample at the still frame's time, one frame long.
        let stillStart = CMTime(value: Int64(o.stillFrameIndex), timescale: Int32(o.fps))
        let stillRange = CMTimeRange(start: stillStart, duration: CMTime(value: 1, timescale: Int32(o.fps)))
        let group = AVTimedMetadataGroup(items: [stillImageTimeItem()], timeRange: stillRange)
        if metaAdaptor.append(group) == false { ok = false }
        metaInput.markAsFinished()

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

    // MARK: - Live Photo metadata (mdta keyspace)

    private static let kKeyContentID = "com.apple.quicktime.content.identifier"
    private static let kKeyStillTime = "com.apple.quicktime.still-image-time"
    private static let kKeySpaceMdta = "mdta"

    /// Top-level movie metadata item binding this .mov to its still by UUID.
    private static func contentIdentifierItem(_ id: String) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.key = kKeyContentID as NSString
        item.keySpace = AVMetadataKeySpace(rawValue: kKeySpaceMdta)
        item.value = id as NSString
        item.dataType = "com.apple.metadata.datatype.UTF-8"
        return item
    }

    /// The single timed sample whose *timestamp* marks the still frame. The
    /// int8 value is a placeholder (0); the timestamp carries the meaning.
    private static func stillImageTimeItem() -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.key = kKeyStillTime as NSString
        item.keySpace = AVMetadataKeySpace(rawValue: kKeySpaceMdta)
        item.value = 0 as NSNumber
        item.dataType = "com.apple.metadata.datatype.int8"
        return item
    }

    /// Boxed-metadata format description for the still-image-time track.
    private static func stillTimeFormatDescription() -> CMFormatDescription? {
        let spec: [String: Any] = [
            kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier as String: "\(kKeySpaceMdta)/\(kKeyStillTime)",
            kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType as String: "com.apple.metadata.datatype.int8",
        ]
        var desc: CMFormatDescription?
        CMMetadataFormatDescriptionCreateWithMetadataSpecifications(
            allocator: kCFAllocatorDefault,
            metadataType: kCMMetadataFormatType_Boxed,
            metadataSpecifications: [spec] as CFArray,
            formatDescriptionOut: &desc)
        return desc
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
