import Foundation
import LocalAuthentication
import React

/// Biometric app lock (PRD §7.7). Face ID / Touch ID with device-passcode
/// fallback via LAPolicy.deviceOwnerAuthentication.
@objc(AppLockModule)
class AppLockModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(isAvailable:rejecter:)
  func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    let context = LAContext()
    var error: NSError?
    let ok = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    resolve(ok)
  }

  @objc(authenticate:resolver:rejecter:)
  func authenticate(_ reason: String,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
    let context = LAContext()
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
      resolve(success)
    }
  }
}
