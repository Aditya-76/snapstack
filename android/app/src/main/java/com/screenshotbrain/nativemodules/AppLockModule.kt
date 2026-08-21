package com.screenshotbrain.nativemodules

import android.os.Handler
import android.os.Looper
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Biometric app lock (PRD §7.7) via androidx.biometric, with device
 * credential (PIN/pattern) fallback.
 */
class AppLockModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "AppLockModule"
    private const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun isAvailable(promise: Promise) {
    val result = BiometricManager.from(reactContext).canAuthenticate(AUTHENTICATORS)
    promise.resolve(result == BiometricManager.BIOMETRIC_SUCCESS)
  }

  @ReactMethod
  fun authenticate(reason: String, promise: Promise) {
    val activity = currentActivity as? FragmentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    Handler(Looper.getMainLooper()).post {
      var settled = false
      val prompt = BiometricPrompt(
          activity,
          object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
              if (!settled) {
                settled = true
                promise.resolve(true)
              }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
              if (!settled) {
                settled = true
                promise.resolve(false)
              }
            }
          })
      val info = BiometricPrompt.PromptInfo.Builder()
          .setTitle("Screenshot Brain")
          .setSubtitle(reason)
          .setAllowedAuthenticators(AUTHENTICATORS)
          .build()
      prompt.authenticate(info)
    }
  }
}
