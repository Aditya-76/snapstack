package com.screenshotbrain.nativemodules

import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Manual import via the OS share sheet (PRD §4.2): the manifest declares an
 * ACTION_SEND image/* target; this module surfaces the shared image to JS,
 * which runs it through the normal pipeline. Works for any image — WhatsApp
 * forwards included — not just screenshots.
 */
class ShareImportModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "ShareImportModule"
    /** Set by MainActivity when it is (re)launched with ACTION_SEND. */
    @Volatile var pendingSharedUri: Uri? = null
  }

  private val listener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onNewIntent(intent: Intent) {
      captureFromIntent(intent)
    }
  }

  init {
    reactContext.addActivityEventListener(listener)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun consumePendingSharedImage(promise: Promise) {
    val uri = pendingSharedUri
    pendingSharedUri = null
    if (uri == null) {
      promise.resolve(null)
      return
    }
    try {
      var takenAt = System.currentTimeMillis()
      var width = 0
      var height = 0
      reactContext.contentResolver.query(
          uri,
          arrayOf(MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.WIDTH, MediaStore.Images.Media.HEIGHT),
          null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          if (!cursor.isNull(0)) {
            takenAt = cursor.getLong(0)
          }
          width = cursor.getInt(1)
          height = cursor.getInt(2)
        }
      }
      promise.resolve(Arguments.createMap().apply {
        putString("assetId", uri.toString())
        putDouble("takenAt", takenAt.toDouble())
        putInt("width", width)
        putInt("height", height)
        putString("filePath", "")
      })
    } catch (e: Exception) {
      // Metadata query failed (some providers restrict it) — import anyway.
      promise.resolve(Arguments.createMap().apply {
        putString("assetId", uri.toString())
        putDouble("takenAt", System.currentTimeMillis().toDouble())
        putInt("width", 0)
        putInt("height", 0)
        putString("filePath", "")
      })
    }
  }

  fun captureFromIntent(intent: Intent) {
    if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("image/") == true) {
      @Suppress("DEPRECATION")
      val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      if (uri != null) {
        pendingSharedUri = uri
      }
    }
  }
}
