import Foundation
import React
import Security

/// Keychain-backed secret storage (PRD §7.7 "DB encrypted at rest").
/// getOrCreateSecret(alias) returns a random 256-bit secret persisted in the
/// iOS Keychain (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly — never
/// synced off-device). Used as the SQLCipher passphrase.
@objc(SecureStoreModule)
class SecureStoreModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func query(for alias: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.screenshotbrain.securestore",
      kSecAttrAccount as String: alias,
    ]
  }

  @objc(getOrCreateSecret:resolver:rejecter:)
  func getOrCreateSecret(_ alias: String,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    var readQuery = query(for: alias)
    readQuery[kSecReturnData as String] = true
    readQuery[kSecMatchLimit as String] = kSecMatchLimitOne

    var existing: CFTypeRef?
    let readStatus = SecItemCopyMatching(readQuery as CFDictionary, &existing)
    if readStatus == errSecSuccess, let data = existing as? Data {
      resolve(data.base64EncodedString())
      return
    }

    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      reject("secure_store_failed", "could not generate random bytes", nil)
      return
    }
    let secret = Data(bytes)

    var addQuery = query(for: alias)
    addQuery[kSecValueData as String] = secret
    addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      reject("secure_store_failed", "keychain add failed: \(addStatus)", nil)
      return
    }
    resolve(secret.base64EncodedString())
  }
}
