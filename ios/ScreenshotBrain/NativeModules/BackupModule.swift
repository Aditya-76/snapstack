import Foundation
import React
import UIKit
import UniformTypeIdentifiers

/// Encrypted-backup transport (PRD §6). Export: temp file → UIActivityViewController
/// (iCloud Drive, Files, anything the user owns). Import: UIDocumentPicker.
/// Encryption happens in JS before the bytes reach this module.
@objc(BackupModule)
class BackupModule: NSObject, UIDocumentPickerDelegate {

  private var pendingImportResolve: RCTPromiseResolveBlock?
  private var pendingImportReject: RCTPromiseRejectBlock?

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(exportFile:content:resolver:rejecter:)
  func exportFile(_ fileName: String, content: String,
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      do {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try content.data(using: .utf8)?.write(to: url, options: .atomic)
        guard let root = RCTPresentedViewController() else {
          reject("no_vc", "no view controller to present from", nil)
          return
        }
        let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        activity.popoverPresentationController?.sourceView = root.view
        root.present(activity, animated: true)
        resolve(true)
      } catch {
        reject("export_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(importFile:rejecter:)
  func importFile(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      guard self.pendingImportResolve == nil else {
        reject("busy", "an import is already in progress", nil)
        return
      }
      guard let root = RCTPresentedViewController() else {
        reject("no_vc", "no view controller to present from", nil)
        return
      }
      self.pendingImportResolve = resolve
      self.pendingImportReject = reject
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.data], asCopy: true)
      picker.delegate = self
      picker.allowsMultipleSelection = false
      root.present(picker, animated: true)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    defer { pendingImportResolve = nil; pendingImportReject = nil }
    guard let url = urls.first else {
      pendingImportResolve?(nil)
      return
    }
    do {
      let content = try String(contentsOf: url, encoding: .utf8)
      pendingImportResolve?(content)
    } catch {
      pendingImportReject?("import_failed", error.localizedDescription, error)
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pendingImportResolve?(nil)
    pendingImportResolve = nil
    pendingImportReject = nil
  }
}
