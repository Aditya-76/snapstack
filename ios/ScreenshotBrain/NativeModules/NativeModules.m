// Objective-C bridge declarations for the Swift native modules.
// Method signatures must mirror the @objc selectors in the .swift files.

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(ScreenshotObserver, RCTEventEmitter)
RCT_EXTERN_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getPermissionStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(listScreenshots:(double)sinceMs limit:(NSInteger)limit offset:(NSInteger)offset
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startObserving:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopObserving:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(assetExists:(NSString *)assetId
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(openInGallery:(NSString *)assetId
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_MODULE(OcrModule, NSObject)
RCT_EXTERN_METHOD(recognize:(NSString *)assetId
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_MODULE(ThumbnailModule, NSObject)
RCT_EXTERN_METHOD(createThumbnail:(NSString *)assetId maxDimension:(NSInteger)maxDimension quality:(NSInteger)quality
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getFullImage:(NSString *)assetId
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(deleteThumbnail:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_MODULE(BackupModule, NSObject)
RCT_EXTERN_METHOD(exportFile:(NSString *)fileName content:(NSString *)content
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(importFile:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_MODULE(AppLockModule, NSObject)
RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(authenticate:(NSString *)reason
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_MODULE(SecureStoreModule, NSObject)
RCT_EXTERN_METHOD(getOrCreateSecret:(NSString *)alias
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_MODULE(NotificationsModule, NSObject)
RCT_EXTERN_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(schedule:(NSString *)id title:(NSString *)title body:(NSString *)body fireAt:(double)fireAt
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancel:(NSString *)id
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_MODULE(MlModule, NSObject)
RCT_EXTERN_METHOD(isEmbeddingReady:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(embed:(NSString *)text
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isLlmReady:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(complete:(NSString *)prompt maxTokens:(NSInteger)maxTokens
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(downloadLlmPack:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getLlmDownloadProgress:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
