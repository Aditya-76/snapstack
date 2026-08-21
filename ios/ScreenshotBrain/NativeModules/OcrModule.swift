import Foundation
import Photos
import React
import Vision

/// On-device OCR via the Vision framework (PRD §5: OS-provided, free,
/// near-zero size cost).
@objc(OcrModule)
class OcrModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(recognize:resolver:rejecter:)
  func recognize(_ assetId: String,
                 resolver resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
    guard let asset = fetch.firstObject else {
      reject("not_found", "asset \(assetId) not found", nil)
      return
    }
    let options = PHImageRequestOptions()
    options.isSynchronous = false
    options.deliveryMode = .highQualityFormat
    options.isNetworkAccessAllowed = false  // strictly on-device; no iCloud fetch

    PHImageManager.default().requestImage(
      for: asset,
      targetSize: PHImageManagerMaximumSize,
      contentMode: .aspectFit,
      options: options
    ) { image, _ in
      guard let cgImage = image?.cgImage else {
        reject("decode_failed", "could not load image for \(assetId)", nil)
        return
      }
      let request = VNRecognizeTextRequest { request, error in
        if let error = error {
          reject("ocr_failed", error.localizedDescription, error)
          return
        }
        let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
        var lines: [String] = []
        var boxes: [[String: Any]] = []
        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        for observation in observations {
          guard let candidate = observation.topCandidates(1).first else { continue }
          lines.append(candidate.string)
          // Vision uses a bottom-left normalized coordinate space.
          let box = observation.boundingBox
          boxes.append([
            "text": candidate.string,
            "x": Int(box.minX * width),
            "y": Int((1 - box.maxY) * height),
            "width": Int(box.width * width),
            "height": Int(box.height * height),
          ])
        }
        resolve([
          "text": lines.joined(separator: "\n"),
          "boxes": boxes,
          "languages": [],
        ])
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      request.recognitionLanguages = ["en-IN", "en-US", "hi-IN"]

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        } catch {
          reject("ocr_failed", error.localizedDescription, error)
        }
      }
    }
  }
}
