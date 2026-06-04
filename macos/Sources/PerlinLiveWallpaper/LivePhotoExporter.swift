import Foundation
import AVFoundation
import CoreVideo
import CoreMedia
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

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

    // MARK: - HEIC still

    /// Apple maker-note key for the asset identifier that pairs still + video.
    private static let kMakerAppleAssetID = "17"

    /// Renders the still frame and writes it as HEIC carrying `identifier` in the
    /// Apple maker-note dictionary (key 17), matching the .mov's content-id.
    static func writeStill(preset: Preset, options o: LivePhotoExportOptions,
                           identifier: String, stillURL: URL) -> Bool {
        guard let gpu = GPUContext(pixelFormat: .bgra8Unorm) else { return false }
        let time = Double(o.stillFrameIndex) / Double(o.fps)
        guard var bgra = Renderer.renderBGRA(gpu: gpu, preset: preset, width: o.width, height: o.height, time: time) else { return false }
        // BGRA (Metal) -> RGBA (CGImage), swapping B and R in place.
        var i = 0
        while i < bgra.count { bgra.swapAt(i, i + 2); i += 4 }
        guard let cg = cgImage(rgba: bgra, width: o.width, height: o.height) else { return false }

        try? FileManager.default.removeItem(at: stillURL)
        guard let dest = CGImageDestinationCreateWithURL(stillURL as CFURL, UTType.heic.identifier as CFString, 1, nil) else { return false }
        let props: [String: Any] = [
            kCGImagePropertyMakerAppleDictionary as String: [kMakerAppleAssetID: identifier],
        ]
        CGImageDestinationAddImage(dest, cg, props as CFDictionary)
        return CGImageDestinationFinalize(dest)
    }

    private static func cgImage(rgba: [UInt8], width: Int, height: Int) -> CGImage? {
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
        guard let provider = CGDataProvider(data: Data(rgba) as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                       bytesPerRow: width * 4, space: cs, bitmapInfo: info,
                       provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }

    /// Renders a complete pair (still + video) sharing one fresh UUID.
    /// Returns the identifier on success, nil on failure.
    @discardableResult
    static func exportPair(preset: Preset, options o: LivePhotoExportOptions,
                           stillURL: URL, videoURL: URL) -> String? {
        let id = UUID().uuidString
        guard writeStill(preset: preset, options: o, identifier: id, stillURL: stillURL),
              writeVideo(preset: preset, options: o, identifier: id, videoURL: videoURL) else { return nil }
        return id
    }

    /// Re-reads a pair and asserts: the .mov has a top-level content-identifier;
    /// it has a metadata track (the still-image-time track); and the HEIC's
    /// maker-note asset id equals the .mov's content id. Returns true if valid.
    static func verifyPair(stillURL: URL, videoURL: URL) -> Bool {
        let asset = AVURLAsset(url: videoURL)

        // 1) top-level content identifier
        let movID = asset.metadata.first(where: { $0.key as? String == kKeyContentID })?.value as? String
        guard let movID, !movID.isEmpty else { print("verify: no .mov content.identifier"); return false }

        // 2) a metadata track exists (the still-image-time track)
        let hasMetaTrack = !asset.tracks(withMediaType: .metadata).isEmpty
        guard hasMetaTrack else { print("verify: no metadata track"); return false }

        // 3) HEIC maker-note asset id matches
        guard let src = CGImageSourceCreateWithURL(stillURL as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any],
              let maker = props[kCGImagePropertyMakerAppleDictionary as String] as? [String: Any],
              let stillID = maker[kMakerAppleAssetID] as? String else {
            print("verify: no HEIC maker-note asset id"); return false
        }
        guard stillID == movID else { print("verify: id mismatch still=\(stillID) mov=\(movID)"); return false }
        return true
    }

    static func selfTest() -> Bool {
        let store = PresetStore()
        guard let preset = store.presets.first else { print("livephoto selftest: no presets"); return false }
        let tmp = FileManager.default.temporaryDirectory
        let stillURL = tmp.appendingPathComponent("perlin-selftest.heic")
        let videoURL = tmp.appendingPathComponent("perlin-selftest.mov")
        let opts = LivePhotoExportOptions(width: 256, height: 512, duration: 0.6, fps: 10)
        defer { try? FileManager.default.removeItem(at: stillURL); try? FileManager.default.removeItem(at: videoURL) }
        guard exportPair(preset: preset, options: opts, stillURL: stillURL, videoURL: videoURL) != nil else {
            print("livephoto selftest: export failed"); return false
        }
        let ok = verifyPair(stillURL: stillURL, videoURL: videoURL)
        print("livephoto selftest: markers + uuid match -> \(ok ? "PASS" : "FAIL")")
        return ok
    }
}
