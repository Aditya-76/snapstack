# Architecture

Everything runs on-device. There is no server, no account, and no network call in the product path (the only network use is the optional, user-initiated LLM pack download).

## Data flow

```
new screenshot (MediaStore observer / PHPhotoLibrary observer / share import / backfill)
        │
        ▼
src/pipeline/pipeline.ts  indexScreenshot()
  1. OCR            native OcrModule (ML Kit / Vision) → text + boxes
  2. Classify       src/pipeline/classifier.ts (keyword scoring, 9 categories)
                    └─ ambiguous? → llmClassify() only if the local LLM is ready
  3. Extract        src/pipeline/entityExtraction.ts (regex, India-first)
  4. Embed          src/pipeline/embeddings.ts (native model → hash fallback)
  5. Store          src/db (SQLite: row + FTS5 + embedding BLOB + thumbnail path)
  6. Actions        src/reminders/engine.ts detectActions() → suggestions
                    └─ auto mode on for category? → confirm + schedule + log
```

## Storage (one SQLite file)

`screenshots` (extracted intelligence + `asset_id` reference — never pixel copies),
`screenshots_fts` (FTS5 external-content, BM25), `reminders`, `activity_log`,
`settings`. Embeddings are float32 BLOBs; semantic search is a brute-force cosine
scan (fast at the 10k-screenshot scale) behind the `listEmbedded()` seam, so
sqlite-vec can replace it without touching callers. `SqliteStore.open()` accepts
an encryption key (SQLCipher path) for at-rest encryption.

The `SnapStore` interface has two implementations: `SqliteStore` (op-sqlite,
production) and `MemoryStore` (pure JS — unit tests and safety fallback).

## Search

`src/search/hybridSearch.ts`: FTS5 keyword leg + cosine semantic leg, merged by
Reciprocal Rank Fusion (rank-based, so no score calibration needed). Sensitive
categories (`id_document`) are filtered out of results unless the user opts in
or explicitly filters for them — enforced in both store implementations.

## Q&A

`src/qa/qa.ts`: retrieval always runs; generation runs only when
`MlModule.isLlmReady()` — device above the 4 GB floor *and* pack downloaded.
The prompt carries top-6 screenshots (dated, categorized) and instructs
citation by index. Failure or absence of the LLM degrades to search-only with
`degradedToSearch: true`, which the chat UI messages honestly.

## Native modules (classic bridge, works under new-arch interop)

| Module | Android | iOS |
|---|---|---|
| ScreenshotObserver | MediaStore ContentObserver, `IS_SCREENSHOT` (API 34+) / path heuristics; ACTION_VIEW open-in-gallery | PHPhotoLibraryChangeObserver; open-in-gallery returns false → in-app viewer (deep links unsupported by iOS) |
| OcrModule | ML Kit Text Recognition v2 (bundled) | Vision `VNRecognizeTextRequest` (accurate, en-IN/hi-IN) |
| ThumbnailModule | 256px WebP into filesDir/thumbs | 256px JPEG into Application Support/thumbs |
| NotificationsModule | AlarmManager + BroadcastReceiver | UNUserNotificationCenter |
| MlModule | model-file lifecycle, RAM floor check, DownloadManager (Wi-Fi only) | same contract, URLSession |

JS side: `src/native/index.ts` — every module is optional; absence produces
typed fallbacks, never crashes. This is also how below-floor devices and unit
tests run.

## Degradation ladder

1. Full: OCR + real embeddings + LLM Q&A.
2. No LLM pack / below floor: OCR + embeddings + hybrid search (Q&A tab explains).
3. No embedding model: OCR + FTS keyword + hash-embedding pseudo-semantic leg.
4. No native modules at all (tests/preview): MemoryStore, empty OCR, UI functional.

## Testing

Pure-TS layers (extraction, classification, search merge, reminder lifecycle,
pipeline orchestration) are dependency-injected and covered by Jest
(`__tests__/`, 40 tests). Native modules follow thin-adapter discipline: no
business logic lives in Kotlin/Swift beyond OS API calls.
