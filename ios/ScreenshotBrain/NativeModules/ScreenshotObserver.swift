import Foundation
import Photos
import React
import UIKit

/// Screenshot ingestion on iOS (PRD §4.2): PHPhotoLibraryChangeObserver while
/// the app is alive; the JS layer sweeps on foreground for anything missed.
/// True always-on gallery watching does not exist on iOS — onboarding copy
/// sets that expectation (§7.1).
@objc(ScreenshotObserver)
class ScreenshotObserver: RCTEventEmitter, PHPhotoLibraryChangeObserver {

  private var fetchResult: PHFetchResult<PHAsset>?
  private var observing = false

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! { ["onNewScreenshot"] }

  private func screenshotFetchOptions(sinceMs: Double) -> PHFetchOptions {
    let options = PHFetchOptions()
    let since = Date(timeIntervalSince1970: sinceMs / 1000.0)
    options.predicate = NSPredicate(
      format: "(mediaSubtype & %d) != 0 AND creationDate >= %@",
      PHAssetMediaSubtype.photoScreenshot.rawValue, since as NSDate)
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    return options
  }

  private func assetToDictionary(_ asset: PHAsset) -> [String: Any] {
    return [
      "assetId": asset.localIdentifier,
      "takenAt": (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000.0,
      "width": asset.pixelWidth,
      "height": asset.pixelHeight,
      "filePath": "",
    ]
  }

  @objc(requestPermission:rejecter:)
  func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
      switch status {
      case .authorized: resolve("granted")
      case .limited: resolve("limited")  // limited-library selection is fine for us (PRD §4.1.2)
      default: resolve("denied")
      }
    }
  }

  @objc(getPermissionStatus:rejecter:)
  func getPermissionStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
    case .authorized: resolve("granted")
    case .limited: resolve("limited")
    case .notDetermined: resolve("undetermined")
    default: resolve("denied")
    }
  }

  @objc(listScreenshots:limit:offset:resolver:rejecter:)
  func listScreenshots(_ sinceMs: Double, limit: Int, offset: Int,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    let result = PHAsset.fetchAssets(with: .image, options: screenshotFetchOptions(sinceMs: sinceMs))
    var assets: [[String: Any]] = []
    let end = min(result.count, offset + limit)
    if offset < end {
      for i in offset..<end {
        assets.append(assetToDictionary(result.object(at: i)))
      }
    }
    resolve(assets)
  }

  @objc(startObserving:rejecter:)
  func startObserving(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if !observing {
      fetchResult = PHAsset.fetchAssets(with: .image, options: screenshotFetchOptions(sinceMs: Date().timeIntervalSince1970 * 1000 - 86_400_000))
      PHPhotoLibrary.shared().register(self)
      observing = true
    }
    resolve(nil)
  }

  @objc(stopObserving:rejecter:)
  func stopObserving(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if observing {
      PHPhotoLibrary.shared().unregisterChangeObserver(self)
      observing = false
    }
    resolve(nil)
  }

  func photoLibraryDidChange(_ changeInstance: PHChange) {
    guard let previous = fetchResult,
          let changes = changeInstance.changeDetails(for: previous) else { return }
    fetchResult = changes.fetchResultAfterChanges
    for asset in changes.insertedObjects where asset.mediaSubtypes.contains(.photoScreenshot) {
      sendEvent(withName: "onNewScreenshot", body: assetToDictionary(asset))
    }
  }

  @objc(assetExists:resolver:rejecter:)
  func assetExists(_ assetId: String,
                   resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    let result = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
    resolve(result.count > 0)
  }

  /// Deep-linking into Photos to a specific asset is not officially supported
  /// (PRD §4.6) — return false so JS shows the in-app full-res viewer instead.
  @objc(openInGallery:resolver:rejecter:)
  func openInGallery(_ assetId: String,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(false)
  }
}
