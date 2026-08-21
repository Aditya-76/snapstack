package com.screenshotbrain.nativemodules

import android.Manifest
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import androidx.core.content.ContextCompat

/**
 * Watches MediaStore for new screenshots (PRD §4.2 Android: near-real-time via
 * ContentObserver) and enumerates existing ones for backfill (§4.1.3).
 *
 * Screenshot detection: MediaStore.Images.Media.IS_SCREENSHOT on API 34+,
 * relative-path/bucket "Screenshots" heuristics below that.
 */
class ScreenshotObserverModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "ScreenshotObserver"
    private const val PERMISSION_REQUEST_CODE = 4711
  }

  private var observer: ContentObserver? = null
  private var lastEmittedId: Long = -1
  /** MediaStore queries run off the main thread (camera bursts would jank UI). */
  private var observerThread: HandlerThread? = null

  override fun getName(): String = NAME

  private fun requiredPermission(): String =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        Manifest.permission.READ_MEDIA_IMAGES
      } else {
        Manifest.permission.READ_EXTERNAL_STORAGE
      }

  private fun hasPermission(): Boolean =
      ContextCompat.checkSelfPermission(reactContext, requiredPermission()) ==
          PackageManager.PERMISSION_GRANTED

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    promise.resolve(if (hasPermission()) "granted" else "undetermined")
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
    if (hasPermission()) {
      promise.resolve("granted")
      return
    }
    val activity = currentActivity as? PermissionAwareActivity
    if (activity == null) {
      promise.resolve("denied")
      return
    }
    val listener = PermissionListener { requestCode, _, grantResults ->
      if (requestCode == PERMISSION_REQUEST_CODE) {
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        promise.resolve(if (granted) "granted" else "denied")
        true
      } else {
        false
      }
    }
    activity.requestPermissions(arrayOf(requiredPermission()), PERMISSION_REQUEST_CODE, listener)
  }

  private fun isScreenshotSelection(): Pair<String, Array<String>?> {
    return when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ->
          Pair("${MediaStore.Images.Media.IS_SCREENSHOT} = 1", null)
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
          Pair(
              "(${MediaStore.Images.Media.RELATIVE_PATH} LIKE ? OR ${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} = ?)",
              arrayOf("%Screenshots%", "Screenshots"))
      else ->
          // RELATIVE_PATH doesn't exist before API 29 — fall back to DATA.
          Pair(
              "(${MediaStore.Images.Media.DATA} LIKE ? OR ${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} = ?)",
              arrayOf("%/Screenshots/%", "Screenshots"))
    }
  }

  private fun assetToMap(id: Long, takenAt: Long, width: Int, height: Int, path: String?): WritableMap {
    val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
    return Arguments.createMap().apply {
      putString("assetId", uri.toString())
      putDouble("takenAt", takenAt.toDouble())
      putInt("width", width)
      putInt("height", height)
      putString("filePath", path ?: "")
    }
  }

  @ReactMethod
  fun listScreenshots(sinceMs: Double, limit: Int, offset: Int, promise: Promise) {
    if (!hasPermission()) {
      promise.resolve(Arguments.createArray())
      return
    }
    try {
      val (screenshotClause, screenshotArgs) = isScreenshotSelection()
      val selection = "$screenshotClause AND ${MediaStore.Images.Media.DATE_TAKEN} >= ?"
      val args = (screenshotArgs ?: emptyArray()) + arrayOf(sinceMs.toLong().toString())
      val projection = arrayOf(
          MediaStore.Images.Media._ID,
          MediaStore.Images.Media.DATE_TAKEN,
          MediaStore.Images.Media.WIDTH,
          MediaStore.Images.Media.HEIGHT,
          MediaStore.Images.Media.DATA)
      val result = Arguments.createArray()
      reactContext.contentResolver.query(
          MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
          projection,
          selection,
          args,
          "${MediaStore.Images.Media.DATE_TAKEN} DESC")?.use { cursor ->
        var skipped = 0
        var added = 0
        while (cursor.moveToNext() && added < limit) {
          if (skipped < offset) {
            skipped += 1
            continue
          }
          result.pushMap(
              assetToMap(
                  cursor.getLong(0),
                  cursor.getLong(1),
                  cursor.getInt(2),
                  cursor.getInt(3),
                  cursor.getString(4)))
          added += 1
        }
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("list_failed", e)
    }
  }

  @ReactMethod
  fun startObserving(promise: Promise) {
    if (observer != null) {
      promise.resolve(null)
      return
    }
    // Dedicated thread: onChange fires for every image insert on the device
    // (camera bursts, WhatsApp downloads) and runs a MediaStore query.
    val thread = HandlerThread("screenshot-observer").also { it.start() }
    observerThread = thread
    observer = object : ContentObserver(Handler(thread.looper)) {
      override fun onChange(selfChange: Boolean, uri: Uri?) {
        emitLatestScreenshot()
      }
    }
    reactContext.contentResolver.registerContentObserver(
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, observer!!)
    promise.resolve(null)
  }

  private fun emitLatestScreenshot() {
    if (!hasPermission()) {
      return
    }
    try {
      val (screenshotClause, screenshotArgs) = isScreenshotSelection()
      val projection = arrayOf(
          MediaStore.Images.Media._ID,
          MediaStore.Images.Media.DATE_TAKEN,
          MediaStore.Images.Media.WIDTH,
          MediaStore.Images.Media.HEIGHT,
          MediaStore.Images.Media.DATA)
      reactContext.contentResolver.query(
          MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
          projection,
          screenshotClause,
          screenshotArgs,
          "${MediaStore.Images.Media.DATE_TAKEN} DESC")?.use { cursor ->
        if (cursor.moveToFirst()) {
          val id = cursor.getLong(0)
          if (id == lastEmittedId) {
            return
          }
          lastEmittedId = id
          val map = assetToMap(id, cursor.getLong(1), cursor.getInt(2), cursor.getInt(3), cursor.getString(4))
          reactContext
              .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("onNewScreenshot", map)
        }
      }
    } catch (_: Exception) {
      // MediaStore race; the foreground sweep will catch the asset.
    }
  }

  @ReactMethod
  fun stopObserving(promise: Promise) {
    observer?.let { reactContext.contentResolver.unregisterContentObserver(it) }
    observer = null
    observerThread?.quitSafely()
    observerThread = null
    promise.resolve(null)
  }

  @ReactMethod
  fun assetExists(assetId: String, promise: Promise) {
    // "Unknown" must never read as "deleted": without permission (or on a
    // query failure) reject so the retention sweep skips, instead of
    // mass-marking the library as deleted.
    if (!hasPermission()) {
      promise.reject("no_permission", "photo permission not granted")
      return
    }
    try {
      reactContext.contentResolver.query(
          Uri.parse(assetId), arrayOf(MediaStore.Images.Media._ID), null, null, null)?.use { cursor ->
        promise.resolve(cursor.count > 0)
        return
      }
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("query_failed", e)
    }
  }

  /** ACTION_VIEW with the MediaStore content URI → user's gallery app (PRD §4.6). */
  @ReactMethod
  fun openInGallery(assetId: String, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(assetId), "image/*")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  // Required for NativeEventEmitter (no-ops; RN calls these on subscribe).
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
