package com.screenshotbrain.nativemodules

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Hardware-backed secret storage (PRD §7.7 "DB encrypted at rest").
 *
 * getOrCreateSecret(alias) returns a random 256-bit secret that is generated
 * once, AES-GCM-wrapped by an Android Keystore key (non-exportable), and
 * persisted in private SharedPreferences. The plaintext secret only ever
 * exists in memory; it is used as the SQLCipher passphrase.
 */
class SecureStoreModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "SecureStoreModule"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val WRAP_KEY_ALIAS = "sb_wrap_key"
    private const val PREFS = "secure_store"
    private const val GCM_TAG_BITS = 128
  }

  override fun getName(): String = NAME

  private fun wrapKey(): SecretKey {
    val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (ks.getKey(WRAP_KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
        KeyGenParameterSpec.Builder(
            WRAP_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
    return generator.generateKey()
  }

  @ReactMethod
  fun getOrCreateSecret(alias: String, promise: Promise) {
    try {
      val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val stored = prefs.getString(alias, null)
      if (stored != null) {
        val parts = stored.split(":")
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val cipherText = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, wrapKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        promise.resolve(Base64.encodeToString(cipher.doFinal(cipherText), Base64.NO_WRAP))
        return
      }
      val secret = ByteArray(32).also { SecureRandom().nextBytes(it) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, wrapKey())
      val wrapped = cipher.doFinal(secret)
      prefs.edit()
          .putString(
              alias,
              "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}:${Base64.encodeToString(wrapped, Base64.NO_WRAP)}")
          .apply()
      promise.resolve(Base64.encodeToString(secret, Base64.NO_WRAP))
    } catch (e: Exception) {
      promise.reject("secure_store_failed", e)
    }
  }
}
