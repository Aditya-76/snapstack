/**
 * Core domain types for Screenshot Brain.
 *
 * Everything here maps 1:1 to the on-device pipeline described in the PRD:
 * OCR → classification → entity extraction → embedding → store → actions.
 */

export type Category =
  | 'payment'
  | 'bill'
  | 'booking'
  | 'id_document'
  | 'address_contact'
  | 'code_coupon'
  | 'chat'
  | 'job_listing'
  | 'meme_other';

export const ALL_CATEGORIES: Category[] = [
  'payment',
  'bill',
  'booking',
  'id_document',
  'address_contact',
  'code_coupon',
  'chat',
  'job_listing',
  'meme_other',
];

export const CATEGORY_LABELS: Record<Category, string> = {
  payment: 'Payments & UPI',
  bill: 'Bills',
  booking: 'Bookings & Tickets',
  id_document: 'IDs & Documents',
  address_contact: 'Addresses & Contacts',
  code_coupon: 'Codes & Coupons',
  chat: 'Chats',
  job_listing: 'Jobs & Listings',
  meme_other: 'Memes & Other',
};

/** Categories excluded from search previews by default (PII sensitivity, PRD §7.7). */
export const SENSITIVE_CATEGORIES: Category[] = ['id_document'];

export type EntityType =
  | 'amount'
  | 'date'
  | 'due_date'
  | 'merchant'
  | 'booking_id'
  | 'phone'
  | 'address'
  | 'coupon_code'
  | 'coupon_expiry'
  | 'upi_id'
  | 'transaction_id'
  | 'email'
  | 'tracking_id';

export interface Entity {
  type: EntityType;
  /** Raw text as it appeared in the OCR output. */
  raw: string;
  /** Normalized value: ISO date for dates, plain number string for amounts, etc. */
  value: string;
  /** 0..1 heuristic confidence. */
  confidence: number;
}

export interface OcrBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrResult {
  text: string;
  boxes: OcrBox[];
  /** BCP-47 tags of recognized languages, best effort. */
  languages: string[];
}

/** A screenshot as stored by us: extracted intelligence + a reference to the gallery asset. */
export interface ScreenshotRecord {
  id: string;
  /** Platform asset reference: MediaStore content URI (Android) / PHAsset localIdentifier (iOS). */
  assetId: string;
  /** Epoch ms when the screenshot was taken (from asset metadata). */
  takenAt: number;
  /** Epoch ms when we indexed it. */
  indexedAt: number;
  ocrText: string;
  category: Category;
  categoryConfidence: number;
  entities: Entity[];
  /** App the screenshot was taken of, inferred best-effort from content. */
  sourceApp: string | null;
  /** Path to our small cached WebP thumbnail (never the original). */
  thumbnailPath: string | null;
  /** True once the gallery original has been deleted; intelligence survives. */
  originalDeleted: boolean;
  /** float32 embedding of the OCR text; null until embedding model has run. */
  embedding: Float32Array | null;
}

export interface SearchFilters {
  categories?: Category[];
  fromDate?: number;
  toDate?: number;
  sourceApp?: string;
  /** Include sensitive categories in results/previews. Default false. */
  includeSensitive?: boolean;
}

export interface SearchResult {
  screenshot: ScreenshotRecord;
  /** Merged relevance score (higher is better). */
  score: number;
  /** Which retrieval legs matched. */
  matchedBy: Array<'keyword' | 'semantic'>;
  /** Snippet of OCR text around the best keyword match, if any. */
  snippet: string | null;
}

export type ReminderStatus = 'suggested' | 'confirmed' | 'dismissed' | 'fired' | 'undone';

export type ActionType =
  | 'due_date_reminder'
  | 'calendar_event'
  | 'copy_code'
  | 'call_number'
  | 'open_address';

export interface ReminderSuggestion {
  id: string;
  screenshotId: string;
  actionType: ActionType;
  /** Human title, e.g. "Broadband bill ₹1,178 due Aug 20". */
  title: string;
  /** Epoch ms when the reminder should fire (for time-based actions). */
  fireAt: number | null;
  status: ReminderStatus;
  /** True if created by automatic mode rather than user confirmation. */
  auto: boolean;
  createdAt: number;
}

export interface ActivityLogEntry {
  id: string;
  at: number;
  kind: 'reminder_auto_created' | 'reminder_confirmed' | 'reminder_dismissed' | 'reminder_undone' | 'screenshot_indexed' | 'backfill_completed';
  message: string;
  screenshotId: string | null;
  reminderId: string | null;
}

export type BackfillWindow = 'last_30_days' | 'last_6_months' | 'all' | 'none';

export interface Settings {
  /** Per-category automatic reminder creation (opt-in, PRD §4.5). */
  autoRemindersByCategory: Partial<Record<Category, boolean>>;
  /** Auto-purge extracted data N days after gallery original deleted. null = keep forever. */
  purgeAfterOriginalDeletedDays: number | null;
  thumbnailQuality: 'normal' | 'low' | 'off';
  appLockEnabled: boolean;
  /** Show sensitive-category previews in search results. */
  showSensitivePreviews: boolean;
  backfillWindow: BackfillWindow;
  /** Whether the optional LLM pack has been downloaded ("Enable Q&A"). */
  llmPackInstalled: boolean;
  onboardingCompleted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoRemindersByCategory: {},
  purgeAfterOriginalDeletedDays: null,
  thumbnailQuality: 'normal',
  appLockEnabled: false,
  showSensitivePreviews: false,
  backfillWindow: 'none',
  llmPackInstalled: false,
  onboardingCompleted: false,
};

export interface QaCitation {
  screenshot: ScreenshotRecord;
  relevance: number;
}

export interface QaAnswer {
  question: string;
  /** Null when the device is below the LLM floor or pack not installed → search-only degrade. */
  answer: string | null;
  citations: QaCitation[];
  degradedToSearch: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: QaCitation[];
  at: number;
}
