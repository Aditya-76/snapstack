package com.screenshotbrain.nativemodules

import android.app.Activity
import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Encrypted-backup transport (PRD §6). Export: write the ciphertext to the
 * app files dir and hand it to the OS share sheet (Drive, Files, anything the
 * user owns). Import: ACTION_OPEN_DOCUMENT and read the picked file back.
 * Encryption happens in JS before the bytes reach this module.
 */
class BackupModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "BackupModule"
    private const val IMPORT_REQUEST_CODE = 4713
    private const val MAX_IMPORT_BYTES = 64L * 1024 * 1024
  }

  private var pendingImport: Promise? = null

  private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != IMPORT_REQUEST_CODE) {
        return
      }
      val promise = pendingImport ?: return
      pendingImport = null
      if (resultCode != Activity.RESULT_OK || data?.data == null) {
        promise.resolve(null)
        return
      }
      try {
        val uri = data.data!!
        reactContext.contentResolver.openInputStream(uri)?.use { input ->
          val bytes = input.readBytes()
          if (bytes.size > MAX_IMPORT_BYTES) {
            promise.reject("too_large", "backup file exceeds 64 MB")
            return
          }
          promise.resolve(String(bytes, Charsets.UTF_8))
          return
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("import_failed", e)
      }
    }
  }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun exportFile(fileName: String, content: String, promise: Promise) {
    try {
      val dir = File(reactContext.filesDir, "backups")
      dir.mkdirs()
      val file = File(dir, fileName)
      file.writeText(content, Charsets.UTF_8)

      val uri = FileProvider.getUriForFile(
          reactContext, "${reactContext.packageName}.fileprovider", file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "application/octet-stream"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, "Save backup").apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(chooser)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("export_failed", e)
    }
  }

  @ReactMethod
  fun importFile(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.resolve(null)
      return
    }
    if (pendingImport != null) {
      promise.reject("busy", "an import is already in progress")
      return
    }
    pendingImport = promise
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
      }
      activity.startActivityForResult(intent, IMPORT_REQUEST_CODE)
    } catch (e: Exception) {
      pendingImport = null
      promise.reject("import_failed", e)
    }
  }
}
