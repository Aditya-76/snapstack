package com.screenshotbrain.nativemodules

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * On-device ML host (PRD §5).
 *
 * v1 wiring: this module owns model-file lifecycle (staged download of the
 * optional LLM pack, §7.2) and exposes readiness checks the JS layer already
 * degrades around. The inference backends plug in here:
 *  - embeddings: ONNX Runtime Mobile session over a MiniLM/BGE-small .onnx
 *  - LLM: llama.cpp JNI (or MediaPipe LLM Inference) over a 4-bit .gguf
 * Until a backend is bundled, isEmbeddingReady/isLlmReady report false and the
 * app runs in FTS + hash-embedding mode, exactly as it does below the device
 * floor (4 GB RAM).
 */
class MlModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "MlModule"
    // Published with the release; kept empty in source. When empty, download is disabled.
    private const val LLM_PACK_URL = ""
    private const val LLM_FILE = "llm/model.gguf"
    private const val EMBEDDING_FILE = "models/embedding.onnx"
    private const val MIN_RAM_BYTES = 4L * 1024 * 1024 * 1024
  }

  private var downloadId: Long = -1

  override fun getName(): String = NAME

  private fun modelFile(relative: String): File = File(reactContext.filesDir, relative)

  private fun deviceAboveFloor(): Boolean {
    val memInfo = android.app.ActivityManager.MemoryInfo()
    val activityManager =
        reactContext.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
    activityManager.getMemoryInfo(memInfo)
    return memInfo.totalMem >= MIN_RAM_BYTES
  }

  @ReactMethod
  fun isEmbeddingReady(promise: Promise) {
    promise.resolve(modelFile(EMBEDDING_FILE).exists())
  }

  @ReactMethod
  fun embed(text: String, promise: Promise) {
    // ONNX Runtime session goes here once the model ships in the app bundle.
    if (!modelFile(EMBEDDING_FILE).exists()) {
      promise.reject("not_ready", "embedding model not installed")
      return
    }
    promise.reject("not_wired", "embedding backend not yet linked in this build")
  }

  @ReactMethod
  fun isLlmReady(promise: Promise) {
    promise.resolve(deviceAboveFloor() && modelFile(LLM_FILE).exists())
  }

  @ReactMethod
  fun complete(prompt: String, maxTokens: Int, promise: Promise) {
    if (!deviceAboveFloor()) {
      promise.reject("below_floor", "device below 4 GB RAM floor")
      return
    }
    if (!modelFile(LLM_FILE).exists()) {
      promise.reject("not_ready", "LLM pack not installed")
      return
    }
    promise.reject("not_wired", "llama.cpp backend not yet linked in this build")
  }

  @ReactMethod
  fun downloadLlmPack(promise: Promise) {
    if (LLM_PACK_URL.isEmpty()) {
      promise.reject("no_url", "LLM pack URL not configured for this build")
      return
    }
    try {
      val target = modelFile(LLM_FILE)
      target.parentFile?.mkdirs()
      val request = DownloadManager.Request(Uri.parse(LLM_PACK_URL))
          .setTitle("Screenshot Brain Q&A model")
          .setDestinationUri(Uri.fromFile(target))
          .setAllowedOverMetered(false) // staged download, Wi-Fi only (PRD §7.2)
      val manager = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      downloadId = manager.enqueue(request)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("download_failed", e)
    }
  }

  @ReactMethod
  fun getLlmDownloadProgress(promise: Promise) {
    if (downloadId < 0) {
      promise.resolve(if (modelFile(LLM_FILE).exists()) 1.0 else 0.0)
      return
    }
    try {
      val manager = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      manager.query(DownloadManager.Query().setFilterById(downloadId))?.use { cursor ->
        if (cursor.moveToFirst()) {
          val downloaded =
              cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
          val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
          promise.resolve(if (total > 0) downloaded.toDouble() / total.toDouble() else 0.0)
          return
        }
      }
      promise.resolve(0.0)
    } catch (e: Exception) {
      promise.resolve(0.0)
    }
  }
}
