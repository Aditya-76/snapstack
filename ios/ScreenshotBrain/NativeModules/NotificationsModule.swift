import Foundation
import React
import UserNotifications

/// Local reminder notifications (PRD §4.5) via UNUserNotificationCenter.
@objc(NotificationsModule)
class NotificationsModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(requestPermission:rejecter:)
  func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      resolve(granted)
    }
  }

  @objc(schedule:title:body:fireAt:resolver:rejecter:)
  func schedule(_ id: String, title: String, body: String, fireAt: Double,
                resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default

    let interval = fireAt / 1000.0 - Date().timeIntervalSince1970
    guard interval > 0 else {
      reject("in_past", "fire time is in the past", nil)
      return
    }
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
    let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
    UNUserNotificationCenter.current().add(request) { error in
      if let error = error {
        reject("schedule_failed", error.localizedDescription, error)
      } else {
        resolve(id)
      }
    }
  }

  @objc(cancel:resolver:rejecter:)
  func cancel(_ id: String,
              resolver resolve: @escaping RCTPromiseResolveBlock,
              rejecter reject: @escaping RCTPromiseRejectBlock) {
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
    resolve(nil)
  }
}
