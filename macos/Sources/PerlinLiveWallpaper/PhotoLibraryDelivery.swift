import Foundation
import Photos

/// Adds an exported Live Photo pair to the user's Photos library. With iCloud
/// Photos enabled the asset syncs to the iPhone, where it can be set as the
/// lock-screen wallpaper. Requires NSPhotoLibraryAddUsageDescription.
enum PhotoLibraryDelivery {
    enum Result { case added, denied, failed(String) }

    static func add(stillURL: URL, videoURL: URL, completion: @escaping (Result) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized else { completion(.denied); return }
            PHPhotoLibrary.shared().performChanges {
                let req = PHAssetCreationRequest.forAsset()
                let opts = PHAssetResourceCreationOptions()
                req.addResource(with: .photo, fileURL: stillURL, options: opts)
                req.addResource(with: .pairedVideo, fileURL: videoURL, options: opts)
            } completionHandler: { success, error in
                if success { completion(.added) }
                else { completion(.failed(error?.localizedDescription ?? "unknown error")) }
            }
        }
    }
}
