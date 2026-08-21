package com.screenshotbrain.nativemodules

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * Small cached thumbnails (PRD §6: 256px WebP, ~10–15 KB). We never copy the
 * original — thumbnails live in the app cache-adjacent files dir so they
 * survive gallery cleanups ("original deleted" is a feature).
 */
class ThumbnailModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "ThumbnailModule"
  }

  override fun getName(): String = NAME

  private fun thumbDir(): File {
    val dir = File(reactContext.filesDir, "thumbs")
    if (!dir.exists()) {
      dir.mkdirs()
    }
    return dir
  }

  private fun fileNameFor(assetId: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(assetId.toByteArray())
    return digest.joinToString("") { "%02x".format(it) }.take(24) + ".webp"
  }

  /** Remove a cached thumbnail (retention purge, PRD §6). Only within thumbs dir. */
  @ReactMethod
  fun deleteThumbnail(path: String, promise: Promise) {
    try {
      val file = File(path).canonicalFile
      val dir = thumbDir().canonicalFile
      if (!file.path.startsWith(dir.path)) {
        promise.reject("outside_thumbs", "refusing to delete outside the thumbs directory")
        return
      }
      if (file.exists()) {
        file.delete()
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("delete_failed", e)
    }
  }

  @ReactMethod
  fun createThumbnail(assetId: String, maxDimension: Int, quality: Int, promise: Promise) {
    try {
      val outFile = File(thumbDir(), fileNameFor(assetId))
      if (outFile.exists()) {
        promise.resolve(outFile.absolutePath)
        return
      }
      val uri = Uri.parse(assetId)
      val resolver = reactContext.contentResolver

      // Two-pass decode: bounds first, then subsampled pixels.
      val boundsOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, boundsOptions) }
      val longest = maxOf(boundsOptions.outWidth, boundsOptions.outHeight)
      if (longest <= 0) {
        promise.reject("thumb_failed", "could not decode $assetId")
        return
      }
      var sample = 1
      while (longest / (sample * 2) >= maxDimension) {
        sample *= 2
      }
      val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sample }
      val bitmap = resolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, decodeOptions)
      }
      if (bitmap == null) {
        promise.reject("thumb_failed", "could not decode $assetId")
        return
      }
      val scale = maxDimension.toFloat() / maxOf(bitmap.width, bitmap.height)
      val scaled = if (scale < 1f) {
        Bitmap.createScaledBitmap(
            bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1),
            (bitmap.height * scale).toInt().coerceAtLeast(1), true)
      } else {
        bitmap
      }
      FileOutputStream(outFile).use { out ->
        val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          Bitmap.CompressFormat.WEBP_LOSSY
        } else {
          @Suppress("DEPRECATION")
          Bitmap.CompressFormat.WEBP
        }
        scaled.compress(format, quality, out)
      }
      if (scaled !== bitmap) {
        bitmap.recycle()
      }
      scaled.recycle()
      promise.resolve(outFile.absolutePath)
    } catch (e: Exception) {
      promise.reject("thumb_failed", e)
    }
  }
}
