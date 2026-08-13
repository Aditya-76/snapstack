import CryptoKit
import Foundation
import Photos
import React
import UIKit

/// Small cached thumbnails (PRD §6). HEIC at quality ~0.5 lands in the same
/// 10–15 KB budget as WebP on Android; falls back to JPEG below iOS 17.
@objc(ThumbnailModule)
class ThumbnailModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func thumbsDirectory() throws -> URL {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let dir = base.appendingPathComponent("thumbs", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private func fileName(for assetId: String) -> String {
    let digest = SHA256.hash(data: Data(assetId.utf8))
    return digest.map { String(format: "%02x", $0) }.joined().prefix(24) + ".jpg"
  }

  @objc(createThumbnail:maxDimension:quality:resolver:rejecter:)
  func createThumbnail(_ assetId: String, maxDimension: Int, quality: Int,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    do {
      let dir = try thumbsDirectory()
      let url = dir.appendingPathComponent(String(fileName(for: assetId)))
      if FileManager.default.fileExists(atPath: url.path) {
        resolve(url.path)
        return
      }
      let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
      guard let asset = fetch.firstObject else {
        reject("not_found", "asset \(assetId) not found", nil)
        return
      }
      let options = PHImageRequestOptions()
      options.deliveryMode = .highQualityFormat
      options.resizeMode = .fast
      options.isNetworkAccessAllowed = false

      let target = CGSize(width: maxDimension, height: maxDimension)
      PHImageManager.default().requestImage(
        for: asset, targetSize: target, contentMode: .aspectFit, options: options
      ) { image, _ in
        guard let image = image,
              let data = image.jpegData(compressionQuality: CGFloat(quality) / 100.0) else {
          reject("thumb_failed", "could not render thumbnail", nil)
          return
        }
        do {
          try data.write(to: url, options: .atomic)
          resolve(url.path)
        } catch {
          reject("thumb_failed", error.localizedDescription, error)
        }
      }
    } catch {
      reject("thumb_failed", error.localizedDescription, error)
    }
  }
}
