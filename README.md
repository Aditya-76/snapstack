# Screenshot Brain

**Your screenshots, finally searchable and actionable — 100% on your device.**

Screenshot Brain indexes the text inside your screenshots (bills, UPI payments, bookings, coupons, IDs, job posts) and makes them searchable, askable, and actionable — without a single byte leaving your phone.

Built with React Native (iOS + Android) + native Kotlin/Swift pipeline modules, per the [product PRD](docs/PRD.md). Full feature tour: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).

## What works

- **Ingestion** — Android: near-real-time MediaStore `ContentObserver` (background thread) while the app runs, plus a paginated catch-up sweep from a persisted watermark on every open; iOS: `PHPhotoLibraryChangeObserver` + on-open sweeps. Android share-target import for any image. Optional backfill (30 days / 6 months / everything) that runs in the background with a live progress banner.
- **Pipeline (on-device)** — OCR (ML Kit / Vision) → rules-based classification into 9 categories → regex entity extraction tuned for India (₹ amounts, due dates with context, UPI VPAs & UTRs, train/flight PNRs, phones, coupon codes + expiry, PIN-code-anchored addresses, tracking IDs) → embedding → SQLite.
- **Storage** — one SQLite file, encrypted at rest (SQLCipher; key held in Android Keystore / iOS Keychain): FTS5 keyword index, embeddings as BLOBs, reminders, activity log, settings. Originals are never copied. Extracted data survives gallery deletion (marked, never silently lost), with an opt-in purge policy (30/90 days) that also removes thumbnails.
- **Search** — hybrid keyword (BM25) + semantic (cosine) merged with Reciprocal Rank Fusion; category filters; stale-result protection. Sensitive categories (Aadhaar/PAN) stay findable but previews are masked by default.
- **Q&A chat** — local RAG with screenshots as citations; deterministic aggregation ("total spent on Swiggy in July" → sums extracted amounts) that works even without the LLM; honest degrade messaging when the model pack isn't installed.
- **Reminders & actions** — due dates, bookings and coupon expiries become one-tap reminders (notification permission requested at first use); per-category automatic mode (opt-in) with an undoable Activity log; quick actions: copy code/PNR/tracking, call number, open address in maps.
- **Privacy & data ownership** — biometric app lock (re-arms on background); encrypted backup (PBKDF2 + AES-256, passphrase you choose) exported via the share sheet to Drive/iCloud/anywhere, restorable on a new device with embeddings recomputed.
- **iOS full-res in-app viewer** (Photos deep links are unsupported by iOS); Android opens the original in the gallery via `ACTION_VIEW`.

## What's stubbed (v1 wiring points)

- **Embedding/LLM inference backends** — the `MlModule` native modules own model-file lifecycle (staged, Wi-Fi-only LLM pack download, device-floor checks), but the ONNX Runtime (MiniLM/BGE-small) and llama.cpp (1–2B, 4-bit) sessions are not linked. Until then the app runs on FTS + a deterministic hash-embedding fallback — the same degrade path used below the 4 GB device floor. Wiring guide: [docs/NATIVE_MODULES.md](docs/NATIVE_MODULES.md).
- **iOS Xcode target registration** — the Swift native modules need a one-time Xcode setup (same doc).
- **True background indexing** — Android WorkManager job and iOS BGTask registration are declared but not implemented; capture currently runs while the app is alive plus catch-up sweeps on open. Onboarding copy reflects this honestly.
- iOS share extension (separate Xcode target) — Android share import works today.

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
npm test          # 64 unit tests: extraction, classification, search, reminders, pipeline, retention, backup, aggregation
npx tsc --noEmit  # typecheck
npm run lint
```

Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Project layout

```
src/
  types/        domain types (categories, entities, records, settings)
  pipeline/     OCR→classify→extract→embed orchestration (pure TS, DI for tests)
  db/           SnapStore interface; encrypted SQLite/FTS5 impl + in-memory fallback
  search/       hybrid keyword+semantic search (RRF merge)
  qa/           local RAG Q&A with citations + deterministic aggregation
  reminders/    action detection, suggestion lifecycle, activity log
  capture/      screenshot events, catch-up sweeps, share import, retention scheduling
  maintenance/  deleted-original detection + purge policy
  backup/       encrypted export/import of the extracted database
  native/       typed JS bridge to the native modules (graceful fallbacks)
  screens/ components/ navigation/ store/ theme/   UI
android/app/src/main/java/com/screenshotbrain/nativemodules/   Kotlin modules
ios/ScreenshotBrain/NativeModules/                             Swift modules
```
