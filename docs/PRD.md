# PRD: Screenshot Brain
**Version:** 0.1 (Draft) · **Owner:** Aditya · **Date:** Aug 2026
**One-liner:** Your screenshots, finally searchable and actionable — 100% on your device.

---

## 1. Problem

People screenshot everything — bills, UPI payment confirmations, bookings, addresses, memes, discount codes, job posts — and never find them again. The photo gallery is a write-only database. Existing solutions (Google Photos search, Apple Photos) do basic OCR keyword search, ship data to the cloud, and do nothing *actionable* with what's inside a screenshot.

**Target user (v1):** India-first. The Indian smartphone user's gallery is dense with UPI confirmations, electricity/broadband bills, train/flight/movie bookings, Aadhaar/PAN snaps, WhatsApp forwards of documents, and rent receipts. High screenshot volume + high privacy sensitivity (financial + identity data) = strongest fit for a local-only product.

## 2. Positioning & Principles

1. **Privacy is the product.** All OCR, embedding, classification, and LLM inference run on-device. No accounts, no servers, no analytics on content. This is the moat against Google Photos and cloud AI gallery apps.
2. **Actionable, not just searchable.** A screenshot of a bill should become a payment reminder. A booking should become a calendar suggestion.
3. **Free forever (v1).** Build trust and distribution first; monetization explored later (likely power-user features), never via data.
4. **Storage-frugal.** The app must not balloon. We store extracted intelligence, not pixel copies.

## 3. Decisions Locked

| Decision | Choice |
|---|---|
| Platforms | iOS + Android simultaneously, React Native + native modules |
| Processing | 100% on-device (OCR, embeddings, LLM) |
| Ingestion | Auto-detect new screenshots + manual import (share sheet / picker) |
| Scope (v1) | Search + auto-categorize + Q&A chat + reminders/actions |
| Originals | Never copied. Store extracted data + reference/deep link to the gallery item |
| Reminders | Auto-suggest with confirm (default) + fully-automatic mode (opt-in per category) |
| Sync/backup | User-owned: iCloud (iOS) / Google Drive (Android) backup of the extracted database only |
| Monetization | Free forever for v1 |

## 4. Core User Flows

### 4.1 Onboarding
1. Explain the privacy model in one screen ("Nothing ever leaves your phone").
2. Request photo library access — **screenshots-only scope where possible** (iOS limited-library selection; Android `READ_MEDIA_IMAGES` + filter to Screenshots folder/MediaStore `is_screenshot` heuristics).
3. Optional: backfill scan of existing screenshots (user chooses: last 30 days / 6 months / all). Runs as a background job with progress UI; throttled to charge + Wi-Fi-idle by default to protect battery.
4. Model download step (~200–500 MB bundle for OCR + embedding + small LLM) with clear size disclosure. Ship OCR + embeddings in the app binary if size allows; LLM as post-install download.

### 4.2 Continuous capture
- **Android:** WorkManager job triggered by MediaStore `ContentObserver` on new images in Screenshots directories. Near-real-time.
- **iOS:** `PHPhotoLibraryChangeObserver` while app is alive + background app refresh + processing on app open. (iOS will not give true always-on gallery watching; set expectation that new screenshots are processed on next app open or background refresh window.)
- **Manual import:** Share sheet extension (iOS) / share target (Android) — works for any image, including WhatsApp images that aren't technically screenshots.

### 4.3 Pipeline (per screenshot)
1. **OCR** → full text + layout boxes.
2. **Classification** → category (Payment/UPI, Bill, Booking/Ticket, ID/Document, Address/Contact, Code/Coupon, Chat, Job/Listing, Meme/Other) via lightweight classifier over OCR text (rules + small model; LLM fallback for ambiguous).
3. **Entity extraction** → amounts, dates, due dates, merchant names, PNR/booking IDs, phone numbers, addresses, coupon codes + expiry.
4. **Embedding** → text embedding of OCR content + generated caption for image-only screenshots (memes) via a tiny vision captioner (v1.1 if size-prohibitive; v1 can index memes as "low-text image" with basic visual tags).
5. **Store** → SQLite row + vector; link to gallery asset ID.
6. **Action detection** → if due date / event date / expiry found → create reminder suggestion (or auto-create if user enabled auto mode for that category).

### 4.4 Search & Q&A
- **Search tab:** hybrid search — keyword (SQLite FTS5) + semantic (sqlite-vec) merged. Filters by category, date, app-source (inferable from screenshot content/status bar heuristics — best effort).
- **Q&A chat:** local RAG. Query → retrieve top-k screenshots → local LLM answers with the screenshots shown as citations. Examples: "how much was my electricity bill last month?", "what's my train PNR for Saturday?", "find that Swiggy coupon".
- Tapping any result opens detail view: extracted data, actions (copy code, add reminder, open original in gallery).

### 4.5 Reminders & actions
- **Suggested (default):** notification/in-app card — "Broadband bill ₹1,178 due Aug 20. Add reminder?" One tap confirms → local notification (+ optional system calendar/reminders integration).
- **Automatic (opt-in, per category):** e.g., "auto-create reminders for all bill due dates." Always visible in an Activity log with undo.
- Action types v1: due-date reminder, event on calendar, copy coupon/PNR/tracking ID, call number, open address in maps.

### 4.6 Opening the original
- We never copy the image. Detail view shows a thumbnail (small cached thumb, see §6) and an **"Open in Gallery"** action:
  - **Android:** `ACTION_VIEW` with the MediaStore content URI → opens in user's gallery app. Reliable.
  - **iOS:** `PHAsset` re-fetched by `localIdentifier`, displayed full-res **inside our app**; deep-linking into the Photos app to a specific asset is not officially supported (best effort via `photos://` is fragile — do not commit to it). In-app viewer is the contract.
- **Deleted originals:** extracted data + thumbnail survive; UI marks "original deleted." This is a feature (the intelligence outlives gallery cleanups), not a bug.

## 5. On-Device ML Stack

| Component | Choice | Notes |
|---|---|---|
| OCR | iOS: Vision framework (free, excellent, incl. Indic scripts improving). Android: ML Kit Text Recognition v2 (on-device) | Both are OS-provided → near-zero size cost |
| Embeddings | BGE-small / MiniLM class (~25–40 MB quantized), via ONNX Runtime Mobile | Multilingual variant for Hinglish/Indic content |
| LLM | Qwen2.5-1.5B / Gemma 2B / Llama 3.2 1B class, 4-bit quantized via llama.cpp (or MediaPipe LLM Inference on Android) | Used for Q&A + ambiguous classification + entity extraction fallback. Structured extraction primarily via rules/regex + small models to keep LLM calls rare |
| Vector store | sqlite-vec inside the main SQLite DB | One file, easy backup |
| RN bridge | Native modules (Kotlin/Swift) exposing pipeline; JSI for hot paths | Same bridge pattern as NotificationListenerService work |

**Device floor:** 4 GB RAM Android / iPhone XR+. Below floor: everything works except LLM Q&A (degrade to search-only, clearly messaged).

## 6. Storage Budget (anti-bloat contract)

Per screenshot stored by us:
- OCR text: ~1–3 KB
- Entities + metadata: ~0.5 KB
- Embedding (384-dim float16): ~0.75 KB (quantize to int8 → ~0.4 KB)
- Thumbnail (256px WebP): ~10–15 KB

**≈ 15–20 KB per screenshot → 10,000 screenshots ≈ 150–200 MB total**, plus fixed model cost (~300–500 MB). Growth is linear and slow; app data at 10k screenshots is smaller than one day of WhatsApp media.

Retention policies (Settings): auto-purge extracted data for screenshots deleted from gallery after N days (default: keep); thumbnail quality toggle; "lite mode" (no thumbnails).

Backup = the SQLite file (encrypted with a local key) to iCloud Drive / Google Drive, user-triggered or scheduled. Restoring on a new device restores intelligence; originals live in the user's own photo backup.

## 7. Platform Constraints & Risks

1. **iOS background processing** is the biggest UX gap vs Android — screenshots are processed on open/refresh, not instantly. Mitigate with fast on-open processing (<2s per screenshot) and honest onboarding copy.
2. **Model size vs install friction.** 500 MB download will hurt conversion in India. Mitigate: staged download (search works with OCR+embeddings ~50 MB; LLM optional add-on "Enable Q&A").
3. **OCR quality on Indic scripts / Hinglish.** Vision + ML Kit handle Latin well; Devanagari support is decent and improving. v1 targets English/Hinglish UI content (most Indian app screenshots are English-UI anyway); Indic-first OCR is a v2 investment.
4. **Battery/thermals** during backfill of large galleries. Charge-only default, chunked jobs, thermal-state checks.
5. **Play Store / App Store review:** clean story — standard photo permission, no accessibility, no overlays. Low risk. Photos "limited access" on iOS must be handled gracefully.
6. **False-positive auto-reminders** erode trust fast → auto mode is opt-in per category, always logged, always undoable.
7. **PII sensitivity:** we will index Aadhaar/PAN screenshots. DB encrypted at rest (SQLCipher), optional app lock (biometric), and a "sensitive" category that's excluded from search previews by default.

## 8. Success Metrics (v1)

- Activation: % of installs completing permission + first index (target >60%)
- Core magic: % of WAU performing ≥1 successful search/Q&A per week (target >40%)
- Action rate: reminder suggestions accepted (target >30% accept; <5% dismissed-as-wrong)
- Retention: D30 > 20%
- Perf: p90 per-screenshot pipeline < 4s on mid-range Android; Q&A first token < 3s
- Storage promise: app data < 25 KB/screenshot p90

## 9. Release Plan

- **M1 (weeks 1–4):** RN shell, native pipeline spike (OCR→SQLite→FTS search), Android ContentObserver + iOS change observer, backfill job.
- **M2 (weeks 5–8):** Embeddings + hybrid search, categories, entity extraction (rules-first), detail view + open-in-gallery, share-sheet import.
- **M3 (weeks 9–12):** Reminders (suggest + auto), LLM download + Q&A chat with citations, encrypted backup/restore, app lock.
- **Beta:** TestFlight + Play internal track (existing Apple Dev experience applies), 50–100 India-based testers, measure pipeline perf on Redmi/Realme mid-rangers.

## 10. Open Questions

1. Meme/visual-only search in v1 (needs captioning model, +size) or v1.1?
2. WhatsApp Images folder auto-ingest as opt-in ingest source (huge value in India, but noisy)?
3. Hinglish embedding model eval — multilingual MiniLM vs BGE-m3-small: needs a quick benchmark on real screenshot OCR text.
4. Should Q&A support multi-screenshot aggregation math ("total spent on Swiggy in July") in v1, or ship retrieval-only answers first?
5. Name/branding — "Screenshot Brain" is descriptive; check trademark space.
