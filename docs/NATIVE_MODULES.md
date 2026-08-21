# Native module setup

## Android

No manual steps. `ScreenshotBrainPackage` is registered in `MainApplication.kt`,
permissions and the reminder receiver are declared in `AndroidManifest.xml`,
and ML Kit comes in through `app/build.gradle`.

## iOS (one-time Xcode step)

The Swift modules in `ios/ScreenshotBrain/NativeModules/` are on disk but must
be added to the Xcode project once (file references aren't scriptable from CI
here):

1. Open `ios/ScreenshotBrain.xcworkspace` (after `pod install`).
2. Right-click the `ScreenshotBrain` group → *Add Files to "ScreenshotBrain"* →
   select the `NativeModules` folder and `ScreenshotBrain-Bridging-Header.h`
   (make sure *ScreenshotBrain* target membership is checked).
3. In the target's Build Settings set **Objective-C Bridging Header** to
   `ScreenshotBrain/ScreenshotBrain-Bridging-Header.h` (skip if Xcode already
   offered to create/use it when adding the Swift files).
4. Build. The modules self-register through `RCT_EXTERN_MODULE` in
   `NativeModules.m`.

`Info.plist` already carries `NSPhotoLibraryUsageDescription`, background
modes, and the `com.screenshotbrain.index` BGTask identifier.

## Wiring the real ML backends

`MlModule` (both platforms) is the single integration point:

- **Embeddings**: bundle a quantized MiniLM/BGE-small ONNX file, add ONNX
  Runtime Mobile, load a session lazily, implement `embed()`. JS already
  normalizes and stores whatever vector it gets.
- **LLM**: point `LLM_PACK_URL` / `llmPackURL` at the published 4-bit GGUF,
  link llama.cpp (or MediaPipe LLM Inference on Android), implement
  `complete()`. JS prompt construction, citations and degrade paths are done.

No JS changes are needed for either — readiness checks flip the app into full
mode automatically.
