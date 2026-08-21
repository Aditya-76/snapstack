# Screenshot Brain — Walkthrough

*What the app can do, screen by screen. Everything below runs 100% on-device: no account, no server, no analytics on your content.*

---

## 1. First launch: onboarding

**Privacy screen.** One screen states the deal: all OCR, classification and answering happens on this phone; photos are never copied or uploaded; free, never monetized with your data.

**Permission screen.** Requests photo access — screenshots-scoped where the OS allows. iOS "limited" selection is supported and explained. If you deny, the app doesn't dead-end: an "Open Settings" shortcut appears, and you can skip and grant later from Settings. Platform copy is honest — Android indexes in near-real-time while the app runs plus a catch-up scan on open; iOS processes new screenshots when you open the app or in background-refresh windows.

**Backfill choice.** Index your existing screenshots: last 30 days, last 6 months, everything, or skip. Indexing runs in the background — you land in the app immediately and a live progress banner ("Indexing your screenshots… 1,240 of 3,180") shows on the Search tab while results stream in underneath.

**Done screen.** Two ways out: start right away (search works out of the box), or also kick off the optional ~400 MB on-device Q&A model download.

## 2. The pipeline (what happens to every screenshot)

Each new or imported screenshot flows through, on-device:

1. **OCR** — ML Kit (Android) / Vision (iOS), including en-IN and hi-IN.
2. **Classification** into 9 categories: Payments & UPI, Bills, Bookings & Tickets, IDs & Documents, Addresses & Contacts, Codes & Coupons, Chats, Jobs & Listings, Memes & Other. Rules first; the local LLM is consulted only for ambiguous cases when installed.
3. **Entity extraction** (India-first, precision-tuned):
   - ₹/Rs/INR amounts · dates, with **due dates** detected from context ("pay by", "valid till")
   - UPI IDs (`name@ybl`, `@paytm`, …) and 12-digit UTR/transaction refs
   - 10-digit train PNRs and 6-char flight/hotel booking refs
   - +91 phone numbers · emails · coupon codes **with expiry** · courier tracking IDs
   - Addresses anchored on 6-digit PIN codes · merchant names (Swiggy, BESCOM, IRCTC, …)
4. **Embedding** for semantic search.
5. **Storage** — ~20–25 KB per screenshot (text + entities + vector + 256px thumbnail). Your photo itself is never copied; we keep a reference to the gallery item.
6. **Action detection** — anything with a future due date, event date or expiry becomes a reminder suggestion.

Ingestion sources: automatic capture (MediaStore observer / PHPhotoLibrary observer), catch-up sweeps from a persisted watermark (closing the app for a week loses nothing), and **share-sheet import** on Android — share any image (WhatsApp forwards included) to Screenshot Brain.

## 3. Search tab

- **Hybrid search**: keyword (SQLite FTS5, BM25) and semantic (vector cosine) legs merged with Reciprocal Rank Fusion — finds "electricity bill" whether the screenshot says "BESCOM" or "power bill".
- Debounced as-you-type, with snippet highlights of where the match occurred.
- **Category chips** with live counts filter the library and searches.
- Screenshot cards show thumbnail, category badge, source app (inferred: PhonePe, Swiggy, IRCTC, …), date, and an "original deleted" tag when the gallery copy is gone.
- **Sensitive handling**: Aadhaar/PAN screenshots are always findable, but their previews show 🔒 "Sensitive document — preview hidden" until you opt in from Settings.

## 4. Ask tab (Q&A chat)

- **Aggregation questions answered deterministically, no LLM needed**: "total spent on Swiggy in July" retrieves matching payment screenshots, sums the extracted amounts, and answers "That adds up to ₹600 across 2 screenshots" — with those screenshots attached as citations. Also: "how many times…", "biggest payment…", "cheapest…", with month windows ("in July", "last month").
- **Free-form questions** ("what's my train PNR for Saturday?") run local RAG: retrieve top screenshots → the on-device LLM answers, citing sources you can tap.
- **Without the model pack**, the tab is still useful: retrieval + aggregation work, and a tappable banner offers the one-time ~400 MB download (Wi-Fi-only, with a confirm dialog). Below the 4 GB device floor the app says so honestly instead of failing.

## 5. Reminders tab

- **Suggested** cards: "Airtel ₹1,178 due 20 Aug — Add / Dismiss". Tap the card body to open the source screenshot and verify before deciding.
- **Scheduled** reminders fire local notifications (9 AM on the due date; coupon expiries remind a day early). Notification permission is requested at the first moment it's actually needed.
- **Automatic mode** (Settings, per category — bills, payments, bookings, coupons): reminders are created without asking. Every automatic action lands in the **Activity log** and is undoable.
- Booking screenshots with future dates also produce calendar-event suggestions.

## 6. Screenshot detail view

- Thumbnail, category, date, source app.
- **Extracted table**: every entity found — amounts, due dates, PNRs, UPI IDs, codes — all selectable.
- **Quick actions**: copy coupon/PNR/tracking ID · call number · open address in maps.
- **Set reminder** — one tap, deduped, with instant Undo.
- **Open original**: Android jumps to your gallery app; iOS opens a full-resolution in-app viewer (iOS doesn't allow deep links into Photos).
- If the original was deleted from the gallery, the intelligence survives — the view says so and everything above still works.

## 7. Settings

- **Privacy**: biometric app lock (re-locks when the app goes to background); sensitive-preview toggle. The database is encrypted at rest (SQLCipher) with a key held in the Android Keystore / iOS Keychain.
- **Automatic reminders** per category.
- **Q&A model**: staged download with size disclosure and progress that survives navigation.
- **Index existing screenshots**: run/repeat any backfill window.
- **Backup & restore**: choose a passphrase → your extracted database (never your photos) is encrypted with PBKDF2 + AES-256 and handed to the share sheet — save to Google Drive, iCloud Drive, anywhere you own. Restore on a new device with the same passphrase; search vectors are recomputed and pending reminders are rescheduled automatically.
- **Storage**: lite mode (no thumbnails, ~10–15 KB saved per screenshot); retention policy for gallery-deleted screenshots (keep forever / purge after 30 or 90 days — purging removes the thumbnail too).

## 8. Safety & correctness guarantees baked in

- **Your index can't be corrupted by permission changes**: deletion detection runs only under full photo access, treats "can't verify" as "skip", and a circuit breaker aborts if an implausible share of the library suddenly "disappears" (e.g. iOS limited-access races).
- **No duplicate indexing**: observer events and sweeps racing on the same screenshot are serialized; re-indexing updates in place and never duplicates reminder suggestions.
- **No stale search results**: out-of-order responses are discarded.
- **Accessible**: WCAG-AA contrast on text and buttons, 44pt touch targets, screen-reader labels on cards, reminders, and tabs.

## 9. What's intentionally deferred

| Item | State |
|---|---|
| Real embedding + LLM inference | Native `MlModule` owns download/lifecycle/floor checks on both platforms; ONNX Runtime and llama.cpp sessions plug in behind two methods (`docs/NATIVE_MODULES.md`). Until then: FTS + hash-embedding fallback — the same path below-floor devices use. |
| Always-on background indexing | Android WorkManager / iOS BGTask are declared, not registered; capture is live-while-open + catch-up sweeps. Onboarding copy matches reality. |
| iOS share extension | Needs a separate Xcode target; Android share import works today. |
| Meme/visual-only search (captioning model) | v1.1 per PRD — low-text images are indexed as Memes & Other. |
| System calendar write for bookings | Calendar suggestions schedule local notifications; EventKit/CalendarContract integration is a small follow-up. |

## 10. Verification status

- **64 Jest tests** across extraction (incl. 7 regression cases from adversarial QA), classification, hybrid search, reminders lifecycle, pipeline idempotency, retention safety, backup round-trip, and aggregation.
- TypeScript strict compile: clean. ESLint: 0 errors.
- Native modules reviewed selector-by-selector (iOS bridge ↔ Swift) and against Android API-level pitfalls (API 24+ enumeration, observer threading, PendingIntent flags).
- Reviewed by three specialist passes — product-vs-PRD, adversarial QA, and UI/UX — with all P0/P1 findings fixed (permission-loss data protection, notification permission flow, share-target wiring, regex false positives, contrast/touch targets, blocking-backfill onboarding).
