package com.screenshotbrain

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.screenshotbrain.nativemodules.ShareImportModule

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    captureSharedImage(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    captureSharedImage(intent)
  }

  // Share-target import (PRD §4.2): stash the shared image URI for JS to consume.
  private fun captureSharedImage(intent: Intent?) {
    if (intent?.action == Intent.ACTION_SEND && intent.type?.startsWith("image/") == true) {
      @Suppress("DEPRECATION")
      val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      if (uri != null) {
        ShareImportModule.pendingSharedUri = uri
      }
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "ScreenshotBrain"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
