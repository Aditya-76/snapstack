package com.screenshotbrain.nativemodules

import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * On-device OCR via ML Kit Text Recognition v2 (PRD §5: OS-provided,
 * near-zero size cost). Latin script covers v1's English/Hinglish target;
 * Devanagari is a v2 swap of the recognizer options.
 */
class OcrModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "OcrModule"
  }

  private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

  override fun getName(): String = NAME

  @ReactMethod
  fun recognize(assetId: String, promise: Promise) {
    try {
      val image = InputImage.fromFilePath(reactContext, Uri.parse(assetId))
      recognizer.process(image)
          .addOnSuccessListener { visionText ->
            val boxes = Arguments.createArray()
            for (block in visionText.textBlocks) {
              for (line in block.lines) {
                val frame = line.boundingBox
                boxes.pushMap(Arguments.createMap().apply {
                  putString("text", line.text)
                  putInt("x", frame?.left ?: 0)
                  putInt("y", frame?.top ?: 0)
                  putInt("width", frame?.width() ?: 0)
                  putInt("height", frame?.height() ?: 0)
                })
              }
            }
            val languages = Arguments.createArray()
            visionText.textBlocks.mapNotNull { it.recognizedLanguage }.distinct().forEach {
              if (it.isNotEmpty() && it != "und") {
                languages.pushString(it)
              }
            }
            promise.resolve(Arguments.createMap().apply {
              putString("text", visionText.text)
              putArray("boxes", boxes)
              putArray("languages", languages)
            })
          }
          .addOnFailureListener { e -> promise.reject("ocr_failed", e) }
    } catch (e: Exception) {
      promise.reject("ocr_failed", e)
    }
  }
}
