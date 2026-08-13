package com.screenshotbrain.nativemodules

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Local reminder notifications (PRD §4.5). AlarmManager (inexact, battery
 * friendly) fires a BroadcastReceiver that posts the notification. Everything
 * stays on-device — no push infrastructure.
 */
class NotificationsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "NotificationsModule"
    const val CHANNEL_ID = "reminders"
  }

  override fun getName(): String = NAME

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_DEFAULT).apply {
              description = "Bill due dates, bookings and coupon expiries found in your screenshots"
            })
      }
    }
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
    ensureChannel()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve(true)
      return
    }
    val granted = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    if (granted) {
      promise.resolve(true)
      return
    }
    currentActivity?.let {
      ActivityCompat.requestPermissions(it, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4712)
    }
    promise.resolve(false)
  }

  private fun pendingIntentFor(id: String, title: String, body: String): PendingIntent {
    val intent = Intent(reactContext, ReminderReceiver::class.java).apply {
      putExtra("id", id)
      putExtra("title", title)
      putExtra("body", body)
    }
    return PendingIntent.getBroadcast(
        reactContext,
        id.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  @ReactMethod
  fun schedule(id: String, title: String, body: String, fireAt: Double, promise: Promise) {
    try {
      ensureChannel()
      val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.setAndAllowWhileIdle(
          AlarmManager.RTC_WAKEUP, fireAt.toLong(), pendingIntentFor(id, title, body))
      promise.resolve(id)
    } catch (e: Exception) {
      promise.reject("schedule_failed", e)
    }
  }

  @ReactMethod
  fun cancel(id: String, promise: Promise) {
    try {
      val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.cancel(pendingIntentFor(id, "", ""))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("cancel_failed", e)
    }
  }
}

class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: return
    val title = intent.getStringExtra("title") ?: "Reminder"
    val body = intent.getStringExtra("body") ?: ""
    val notification = NotificationCompat.Builder(context, NotificationsModule.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .build()
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(id.hashCode(), notification)
  }
}
