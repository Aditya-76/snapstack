/**
 * Rules-first entity extraction over OCR text (PRD §4.3, §5).
 *
 * India-first: ₹/Rs amounts, dd/mm/yy dates, UPI VPAs and 12-digit UTR refs,
 * 10-digit IRCTC PNRs, +91 phone numbers, coupon codes with expiry.
 * The LLM is a fallback for ambiguous screenshots, not the primary extractor,
 * so these rules aim for high precision.
 */

import { Entity } from '../types';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject overflow like 31 Feb.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function normalizeYear(raw: string | undefined, referenceYear: number): number {
  if (!raw) {
    return referenceYear;
  }
  const y = parseInt(raw, 10);
  return raw.length === 2 ? 2000 + y : y;
}

interface DateMatch {
  raw: string;
  iso: string;
  index: number;
}

/**
 * Find calendar dates in text. Handles: 20/08/2026, 20-08-26, 20 Aug 2026,
 * Aug 20, 2026, 20th August. Day-first is assumed for numeric forms (India).
 * Yearless dates resolve to `referenceYear`.
 */
export function findDates(text: string, referenceYear: number): DateMatch[] {
  const out: DateMatch[] = [];

  // Numeric: dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy
  const numeric = /\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2}|\d{4}))?\b/g;
  for (const m of text.matchAll(numeric)) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = normalizeYear(m[3], referenceYear);
    // Yearless "20/08" needs both parts plausible; with year we trust it more.
    const iso = isoDate(year, month, day);
    if (iso) {
      out.push({ raw: m[0], iso, index: m.index ?? 0 });
    }
  }

  // "20 Aug 2026", "20th August", "20 Aug"
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s*(\d{2,4})?\b/gi;
  for (const m of text.matchAll(dayFirst)) {
    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    const year = normalizeYear(m[3], referenceYear);
    const iso = isoDate(year, month, day);
    if (iso) {
      out.push({ raw: m[0], iso, index: m.index ?? 0 });
    }
  }

  // "Aug 20, 2026", "August 20"
  const monthFirst = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{2,4})?\b/gi;
  for (const m of text.matchAll(monthFirst)) {
    const month = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    const day = parseInt(m[2], 10);
    const year = normalizeYear(m[3], referenceYear);
    const iso = isoDate(year, month, day);
    if (iso && !out.some(d => d.index === (m.index ?? 0))) {
      out.push({ raw: m[0], iso, index: m.index ?? 0 });
    }
  }

  return out;
}

const DUE_CONTEXT = /\b(due|pay\s*by|payable\s*by|last\s*date|expires?\s*(on)?|valid\s*(till|until|upto|up\s*to)|before)\b/i;

const AMOUNT_RE = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)|(?<![\d.])([\d,]{1,12}(?:\.\d{1,2})?)\s*(?:₹|\/-|rupees)/gi;

const UPI_VPA_RE = /\b[a-z0-9][a-z0-9._-]{1,49}@(?:ok(?:axis|hdfcbank|icici|sbi)|ybl|paytm|apl|upi|ibl|axl|oksbi|okicici|okhdfcbank|okaxis|fbl|jupiteraxis|yapl|pthdfc|axisb|barodampay|kotak|hsbc|idfcbank|rbl|sliceaxis|waaxis|wahdfcbank|waicici|wasbi)\b/gi;

// 12-digit UPI UTR / transaction reference numbers.
const UTR_RE = /\b(?:utr|ref(?:erence)?\s*(?:no|number|id)?|txn\s*(?:id|no|ref)?|transaction\s*(?:id|no|ref(?:erence)?\s*(?:no|number|id)?)?)\s*[:#.]?\s*([A-Z0-9]{10,22}|\d{12})\b/gi;

// IRCTC PNR: exactly 10 digits, usually labeled.
const PNR_RE = /\bpnr\s*(?:no|number|status)?\s*[:#.]?\s*(\d{3}[- ]?\d{7}|\d{10})\b/gi;

// Flight booking references: 6-char alphanumeric labeled as PNR/booking ref.
// The label matches case-insensitively; the code itself must be uppercase
// with at least one digit (checked after matching).
const FLIGHT_PNR_RE = /\b(?:booking\s*(?:id|ref(?:erence)?|no)|confirmation\s*(?:no|code|number)|pnr)\s*[:#.]?\s*([A-Za-z0-9]{6})\b/gi;

const PHONE_RE = /(?:\+91[\s-]?|0)?([6-9]\d{4})[\s-]?(\d{5})\b/g;

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

const COUPON_RE = /\b(?:code|coupon|promo(?:\s*code)?|use|apply)\s*[:#]?\s*["']?([A-Z0-9]{4,15})["']?/g;

const TRACKING_RE = /\b(?:tracking\s*(?:id|no|number)|awb\s*(?:no|number)?|consignment\s*(?:no|number)?)\s*[:#.]?\s*([A-Z0-9]{8,20})\b/gi;

// Words that COUPON_RE's generic "use/apply CODE" form must not swallow.
const COUPON_STOPWORDS = new Set([
  'CODE', 'HERE', 'THIS', 'YOUR', 'BELOW', 'ABOVE', 'NOW', 'TODAY', 'THE',
  'OFFER', 'CARD', 'CASH', 'ONLY', 'WITH', 'FROM', 'MORE',
]);

const MERCHANT_HINTS = [
  'swiggy', 'zomato', 'blinkit', 'zepto', 'bigbasket', 'amazon', 'flipkart',
  'myntra', 'ajio', 'meesho', 'nykaa', 'uber', 'ola', 'rapido', 'irctc',
  'makemytrip', 'goibibo', 'ixigo', 'cleartrip', 'redbus', 'bookmyshow',
  'paytm', 'phonepe', 'gpay', 'google pay', 'cred', 'jio', 'airtel', 'vi',
  'bsnl', 'act fibernet', 'tata play', 'netflix', 'hotstar', 'spotify',
  'dominos', 'mcdonald', 'kfc', 'starbucks', 'dmart', 'reliance',
  'indigo', 'air india', 'vistara', 'spicejet', 'akasa',
  'bescom', 'msedcl', 'tneb', 'bses', 'adani electricity', 'torrent power',
];

function dedupe(entities: Entity[]): Entity[] {
  const seen = new Set<string>();
  return entities.filter(e => {
    const key = `${e.type}:${e.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Extract structured entities from OCR text.
 * `now` anchors yearless dates; defaults to the current time.
 */
export function extractEntities(text: string, now: Date = new Date()): Entity[] {
  const entities: Entity[] = [];
  const referenceYear = now.getFullYear();

  // --- Amounts ---
  for (const m of text.matchAll(AMOUNT_RE)) {
    const rawNum = (m[1] ?? m[2] ?? '').replace(/,/g, '');
    const value = parseFloat(rawNum);
    if (!isNaN(value) && value > 0 && value < 100_000_000) {
      entities.push({
        type: 'amount',
        raw: m[0].trim(),
        value: String(value),
        confidence: m[1] ? 0.95 : 0.7,
      });
    }
  }

  // --- Dates, split into due dates vs plain dates by nearby context ---
  for (const d of findDates(text, referenceYear)) {
    const windowStart = Math.max(0, d.index - 40);
    const before = text.slice(windowStart, d.index);
    const isDue = DUE_CONTEXT.test(before);
    entities.push({
      type: isDue ? 'due_date' : 'date',
      raw: d.raw,
      value: d.iso,
      confidence: isDue ? 0.9 : 0.75,
    });
  }

  // --- UPI VPAs ---
  for (const m of text.matchAll(UPI_VPA_RE)) {
    entities.push({ type: 'upi_id', raw: m[0], value: m[0].toLowerCase(), confidence: 0.95 });
  }

  // --- Transaction refs / UTR ---
  for (const m of text.matchAll(UTR_RE)) {
    entities.push({ type: 'transaction_id', raw: m[0].trim(), value: m[1].toUpperCase(), confidence: 0.85 });
  }

  // --- Train PNR ---
  for (const m of text.matchAll(PNR_RE)) {
    entities.push({
      type: 'booking_id',
      raw: m[0].trim(),
      value: m[1].replace(/[- ]/g, ''),
      confidence: 0.95,
    });
  }

  // --- Flight/hotel booking refs ---
  for (const m of text.matchAll(FLIGHT_PNR_RE)) {
    const val = m[1];
    if (val !== val.toUpperCase() || !/\d/.test(val)) {
      continue;
    }
    if (!entities.some(e => e.type === 'booking_id' && e.value === val)) {
      entities.push({ type: 'booking_id', raw: m[0].trim(), value: val, confidence: 0.8 });
    }
  }

  // --- Phone numbers (Indian mobile) ---
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = `${m[1]}${m[2]}`;
    if (digits.length === 10) {
      entities.push({ type: 'phone', raw: m[0].trim(), value: `+91${digits}`, confidence: 0.8 });
    }
  }

  // --- Emails (skip strings already matched as UPI VPAs) ---
  const upiValues = new Set(entities.filter(e => e.type === 'upi_id').map(e => e.value));
  for (const m of text.matchAll(EMAIL_RE)) {
    const v = m[0].toLowerCase();
    if (!upiValues.has(v)) {
      entities.push({ type: 'email', raw: m[0], value: v, confidence: 0.85 });
    }
  }

  // --- Coupon codes (+ expiry from nearby "valid till" dates) ---
  for (const m of text.matchAll(COUPON_RE)) {
    const code = m[1];
    // Require at least one digit or length >= 5 to avoid matching plain words,
    // and skip common UI words.
    if (COUPON_STOPWORDS.has(code) || (!/\d/.test(code) && code.length < 5)) {
      continue;
    }
    entities.push({ type: 'coupon_code', raw: m[0].trim(), value: code, confidence: 0.8 });
    const after = text.slice((m.index ?? 0), (m.index ?? 0) + 120);
    const validTill = /valid\s*(?:till|until|upto|up\s*to)|expires?\s*(?:on)?/i.exec(after);
    if (validTill) {
      const dates = findDates(after.slice(validTill.index), referenceYear);
      if (dates.length > 0) {
        entities.push({ type: 'coupon_expiry', raw: dates[0].raw, value: dates[0].iso, confidence: 0.8 });
      }
    }
  }

  // --- Tracking IDs ---
  for (const m of text.matchAll(TRACKING_RE)) {
    entities.push({ type: 'tracking_id', raw: m[0].trim(), value: m[1].toUpperCase(), confidence: 0.85 });
  }

  // --- Merchant names (hint list; classifier also uses these) ---
  const lower = text.toLowerCase();
  for (const merchant of MERCHANT_HINTS) {
    if (lower.includes(merchant)) {
      entities.push({ type: 'merchant', raw: merchant, value: merchant, confidence: 0.75 });
    }
  }

  return dedupe(entities);
}

export { MERCHANT_HINTS };
