/**
 * Rules-based screenshot classifier (PRD §4.3 step 2).
 *
 * Lightweight keyword/pattern scoring over OCR text. The on-device LLM is only
 * consulted for ambiguous cases (low margin between top two categories) —
 * see pipeline.ts. Categories follow the PRD taxonomy.
 */

import { Category } from '../types';

interface CategorySignals {
  category: Category;
  /** Strong patterns worth 3 points each. */
  strong: RegExp[];
  /** Weak patterns worth 1 point each. */
  weak: RegExp[];
}

const SIGNALS: CategorySignals[] = [
  {
    category: 'payment',
    strong: [
      /\bupi\b/i,
      /\b(payment\s+(successful|received|complete|done)|paid\s+successfully|money\s+sent)\b/i,
      /\butr\b/i,
      /\b(phonepe|google\s*pay|gpay|paytm|bhim|cred)\b/i,
      /[a-z0-9._-]+@(?:ybl|paytm|ok[a-z]+|upi|apl|ibl|axl)\b/i,
    ],
    weak: [/\btransaction\s*(id|no)?\b/i, /\bdebited|credited\b/i, /₹|\brs\.?\s*\d/i, /\bto\s*:?\s*mobile\b/i],
  },
  {
    category: 'bill',
    strong: [
      /\b(bill\s*(amount|due|date|no|number)|amount\s*(due|payable)|due\s*date|pay\s*by)\b/i,
      /\b(electricity|broadband|postpaid|water\s*bill|gas\s*bill|dth|fastag\s*recharge)\b/i,
      /\b(bescom|msedcl|tneb|bses|adani\s*electricity|torrent\s*power|act\s*fibernet|airtel|jio\s*fiber)\b/i,
    ],
    weak: [/\binvoice\b/i, /\bunits\s*consumed\b/i, /\bbilling\s*period\b/i, /\brent\s*receipt\b/i],
  },
  {
    category: 'booking',
    strong: [
      /\bpnr\b/i,
      /\b(booking\s*(id|confirmed|ref)|e-?ticket|boarding\s*pass|check-?in|seat\s*(no|number)?\s*[A-Z]?\d)\b/i,
      /\b(irctc|makemytrip|goibibo|ixigo|redbus|bookmyshow|cleartrip)\b/i,
      /\b(departure|arrival)\b.*\b(gate|terminal|platform)\b/i,
    ],
    weak: [/\b(train|flight|bus|movie|show|hotel)\b/i, /\bcoach\s*[A-Z]\d\b/i, /\btravell?er\b/i, /\bscreen\s*\d\b/i],
  },
  {
    category: 'id_document',
    strong: [
      /\baadhaar|आधार\b/i,
      /\b\d{4}\s\d{4}\s\d{4}\b/,
      /\b(permanent\s*account\s*number|income\s*tax\s*department)\b/i,
      /\b[A-Z]{5}\d{4}[A-Z]\b/,
      /\b(passport\s*no|driving\s*licen[cs]e|voter\s*id|epic\s*no)\b/i,
    ],
    weak: [/\bgovernment\s*of\s*india\b/i, /\bdate\s*of\s*birth|dob\b/i, /\bfather'?s\s*name\b/i, /\buidai\b/i],
  },
  {
    category: 'address_contact',
    strong: [
      /\b(shipping|delivery|billing)\s*address\b/i,
      /\bpin\s*(code)?\s*[:-]?\s*\d{6}\b/i,
      /\bcontact\s*(no|number|details)\b/i,
    ],
    weak: [/\b(street|road|nagar|layout|sector|apartment|flat\s*no|floor)\b/i, /\blandmark\b/i, /\bnear\b/i],
  },
  {
    category: 'code_coupon',
    strong: [
      /\b(coupon|promo\s*code|discount\s*code|voucher)\b/i,
      /\b(use\s*code|apply\s*code)\b/i,
      /\bflat\s*\d+%?\s*off\b/i,
    ],
    weak: [/\b\d+%\s*off\b/i, /\bvalid\s*(till|until)\b/i, /\bmin(imum)?\s*order\b/i, /\bcashback\b/i],
  },
  {
    category: 'chat',
    strong: [
      /\b(last\s*seen|online|typing\.{0,3})\b/i,
      /\btoday\b.*\b\d{1,2}:\d{2}\s*(am|pm)\b/i,
      /\bforwarded\b/i,
    ],
    weak: [/\bwhatsapp|telegram|signal|instagram|dm\b/i, /\breply\b/i, /✓✓|✔✔/],
  },
  {
    category: 'job_listing',
    strong: [
      /\b(job\s*(opening|post|description)|we'?re\s*hiring|vacancy|walk-?in\s*interview)\b/i,
      /\b(ctc|lpa|salary\s*range|stipend)\b/i,
      /\b(apply\s*(now|here|before)|send\s*(your\s*)?(cv|resume))\b/i,
    ],
    weak: [/\b(experience|fresher|qualification|linkedin|naukri|remote|work\s*from\s*home)\b/i, /\bper\s*annum\b/i],
  },
];

export interface ClassificationResult {
  category: Category;
  confidence: number;
  /** True when the score margin is too thin to trust — LLM fallback candidate. */
  ambiguous: boolean;
  scores: Partial<Record<Category, number>>;
}

/** Below this many total points we call the screenshot a meme/other. */
const MIN_SCORE = 3;
/** Margin (top1 - top2) under which we flag ambiguity. */
const AMBIGUITY_MARGIN = 2;

export function classify(ocrText: string): ClassificationResult {
  const scores: Partial<Record<Category, number>> = {};

  for (const sig of SIGNALS) {
    let score = 0;
    for (const re of sig.strong) {
      if (re.test(ocrText)) {
        score += 3;
      }
    }
    for (const re of sig.weak) {
      if (re.test(ocrText)) {
        score += 1;
      }
    }
    if (score > 0) {
      scores[sig.category] = score;
    }
  }

  const ranked = (Object.entries(scores) as Array<[Category, number]>).sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0 || ranked[0][1] < MIN_SCORE) {
    // Little/no text or no signals: low-text image → meme/other (PRD §4.3 step 4).
    return {
      category: 'meme_other',
      confidence: ocrText.trim().length < 40 ? 0.8 : 0.5,
      ambiguous: ocrText.trim().length >= 40,
      scores,
    };
  }

  const [top, topScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  const margin = topScore - second;
  const confidence = Math.min(0.98, 0.5 + topScore * 0.06 + margin * 0.04);

  return {
    category: top,
    confidence,
    ambiguous: margin < AMBIGUITY_MARGIN,
    scores,
  };
}

/**
 * Best-effort source-app inference from screenshot content (PRD §4.4 filters).
 */
const APP_SIGNATURES: Array<[RegExp, string]> = [
  [/\bphonepe\b/i, 'PhonePe'],
  [/\bgoogle\s*pay|gpay\b/i, 'Google Pay'],
  [/\bpaytm\b/i, 'Paytm'],
  [/\bwhatsapp\b/i, 'WhatsApp'],
  [/\bswiggy\b/i, 'Swiggy'],
  [/\bzomato\b/i, 'Zomato'],
  [/\bamazon\b/i, 'Amazon'],
  [/\bflipkart\b/i, 'Flipkart'],
  [/\birctc\b/i, 'IRCTC'],
  [/\bmakemytrip\b/i, 'MakeMyTrip'],
  [/\bbookmyshow\b/i, 'BookMyShow'],
  [/\binstagram\b/i, 'Instagram'],
  [/\blinkedin\b/i, 'LinkedIn'],
  [/\bcred\b/i, 'CRED'],
  [/\bzepto\b/i, 'Zepto'],
  [/\bblinkit\b/i, 'Blinkit'],
];

export function inferSourceApp(ocrText: string): string | null {
  for (const [re, app] of APP_SIGNATURES) {
    if (re.test(ocrText)) {
      return app;
    }
  }
  return null;
}
