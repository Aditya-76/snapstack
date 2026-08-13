# Screenshot Brain

**Your screenshots, finally searchable and actionable — 100% on your device.**

Screenshot Brain indexes the text inside your screenshots (bills, UPI payments, bookings, coupons, IDs, job posts) and makes them searchable, askable, and actionable — without a single byte leaving your phone.

Built with React Native (iOS + Android) + native Kotlin/Swift pipeline modules, per the [product PRD](docs/PRD.md).

## What works

- **Ingestion** — Android: near-real-time MediaStore `ContentObserver` on the Screenshots collection; iOS: `PHPhotoLibraryChangeObserver` + on-open sweeps. Share-target import on Android. Optional backfill (30 days / 6 months / everything) with progress UI.
- **Pipeline (on-device)** — OCR (ML Kit on Android, Vision on iOS) → rules-based classification into 9 categories → regex entity extraction tuned for India (₹ amounts, due dates, UPI VPAs & UTRs, train PNRs, flight booking refs, phones, coupon codes + expiry, tracking IDs) → embedding → SQLite.
- **Storage** — one SQLite file: FTS5 for keyword search, embeddings as BLOBs for semantic search, reminders, activity log, settings. Originals are never copied; only extracted text + a ~256px thumbnail (~15–20 KB per screenshot). Extracted data survives gallery deletion.
- **Search** — hybrid keyword (BM25) + semantic (cosine) merged with Reciprocal Rank Fusion; category/date/source-app filters; sensitive categories (Aadhaar/PAN) hidden from previews by default.
- **Q&A chat** — local RAG: retrieve top-k screenshots → on-device LLM answers with the screenshots shown as citations. Degrades to search-only (clearly messaged) when the optional LLM pack isn't installed or the device is below the 4 GB floor.
- **Reminders & actions** — due dates, booking dates and coupon expiries become one-tap reminder suggestions; per-category fully-automatic mode (opt-in) with an always-visible, undoable Activity log. Quick actions: copy code/PNR, call number, open address.
- **Native notification scheduling** — AlarmManager + BroadcastReceiver (Android), UNUserNotificationCenter (iOS).

## What's stubbed (v1 wiring points)

- **Embedding/LLM inference backends** — the `MlModule` native modules own model-file lifecycle (staged, Wi-Fi-only LLM pack download) and readiness checks, but the ONNX Runtime (MiniLM/BGE-small) and llama.cpp (Qwen/Gemma/Llama 1–2B, 4-bit) sessions are not linked yet. Until then the app runs on FTS + a deterministic hash-embedding fallback, exactly the degrade path used below the device floor.
- **iOS Xcode target registration** — the Swift native modules need a one-time Xcode setup; see [docs/NATIVE_MODULES.md](docs/NATIVE_MODULES.md).
- Encrypted backup/restore to iCloud/Drive, app-lock biometrics, and the iOS share extension are scaffolded in settings/types but not implemented.

## Getting started

```sh
npm install

# Android (device/emulator connected)
npm run android

# iOS
cd ios && bundle install && bundle exec pod install && cd ..
npm run ios
```

## Development

```sh
npm test          # 40 unit tests: extraction, classification, search, reminders, pipeline
npx tsc --noEmit  # typecheck
npm run lint
```

Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Project layout

```
src/
  types/        domain types (categories, entities, records, settings)
  pipeline/     OCR→classify→extract→embed orchestration (pure TS, DI for tests)
  db/           SnapStore interface; SQLite/FTS5 impl + in-memory fallback
  search/       hybrid keyword+semantic search (RRF merge)
  qa/           local RAG Q&A with citations
  reminders/    action detection, suggestion lifecycle, activity log
  capture/      screenshot event subscription + foreground sweeps
  native/       typed JS bridge to the native modules (graceful fallbacks)
  screens/ components/ navigation/ store/ theme/   UI
android/app/src/main/java/com/screenshotbrain/nativemodules/   Kotlin modules
ios/ScreenshotBrain/NativeModules/                             Swift modules
```
