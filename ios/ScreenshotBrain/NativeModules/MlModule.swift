import Foundation
import React

/// On-device ML host (PRD §5). Mirrors the Android module's contract:
/// owns model-file lifecycle and readiness checks; the JS layer degrades to
/// FTS + hash-embedding search until backends are linked.
/// Backends plug in here: ONNX Runtime (embeddings) / llama.cpp (LLM).
@objc(MlModule)
class MlModule: NSObject {

  // Published with the release; kept empty in source. When empty, download is disabled.
  private static let llmPackURL = ""
  private var downloadTask: URLSessionDownloadTask?
  private var downloadProgress: Double = 0

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func modelsDirectory() throws -> URL {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let dir = base.appendingPathComponent("models", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private func modelExists(_ name: String) -> Bool {
    guard let dir = try? modelsDirectory() else { return false }
    return FileManager.default.fileExists(atPath: dir.appendingPathComponent(name).path)
  }

  /// Device floor: iPhone XR+ (PRD §5). XR has 3 GB but A12; RAM check is the
  /// portable proxy the PRD sets for Android — on iOS we gate on physical memory ≥ 3 GB.
  private func deviceAboveFloor() -> Bool {
    return ProcessInfo.processInfo.physicalMemory >= 3 * 1024 * 1024 * 1024
  }

  @objc(isEmbeddingReady:rejecter:)
  func isEmbeddingReady(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(modelExists("embedding.onnx"))
  }

  @objc(embed:resolver:rejecter:)
  func embed(_ text: String,
             resolver resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard modelExists("embedding.onnx") else {
      reject("not_ready", "embedding model not installed", nil)
      return
    }
    reject("not_wired", "embedding backend not yet linked in this build", nil)
  }

  @objc(isLlmReady:rejecter:)
  func isLlmReady(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(deviceAboveFloor() && modelExists("model.gguf"))
  }

  @objc(complete:maxTokens:resolver:rejecter:)
  func complete(_ prompt: String, maxTokens: Int,
                resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard deviceAboveFloor() else {
      reject("below_floor", "device below the supported floor", nil)
      return
    }
    guard modelExists("model.gguf") else {
      reject("not_ready", "LLM pack not installed", nil)
      return
    }
    reject("not_wired", "llama.cpp backend not yet linked in this build", nil)
  }

  @objc(downloadLlmPack:rejecter:)
  func downloadLlmPack(_ resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard !Self.llmPackURL.isEmpty, let url = URL(string: Self.llmPackURL) else {
      reject("no_url", "LLM pack URL not configured for this build", nil)
      return
    }
    let task = URLSession.shared.downloadTask(with: url) { [weak self] tempURL, _, error in
      guard let self = self else { return }
      if error != nil {
        self.downloadProgress = 0
        return
      }
      if let tempURL = tempURL, let dir = try? self.modelsDirectory() {
        try? FileManager.default.moveItem(at: tempURL, to: dir.appendingPathComponent("model.gguf"))
        self.downloadProgress = 1
      }
    }
    downloadTask = task
    downloadProgress = 0.01
    task.resume()
    resolve(nil)
  }

  @objc(getLlmDownloadProgress:rejecter:)
  func getLlmDownloadProgress(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    if modelExists("model.gguf") {
      resolve(1.0)
      return
    }
    if let task = downloadTask, task.countOfBytesExpectedToReceive > 0 {
      resolve(Double(task.countOfBytesReceived) / Double(task.countOfBytesExpectedToReceive))
      return
    }
    resolve(downloadProgress)
  }
}
