/**
 * Multi-screenshot aggregation answers (PRD §10 open question 4, resolved:
 * ship it in v1 for sum/count/min/max over amounts — it needs no LLM, so it
 * works even in search-only mode and is deterministic).
 *
 * "total spent on Swiggy in July" → retrieve → filter by date window →
 * sum the primary amount entity of each payment/bill screenshot.
 */

import { ScreenshotRecord, SearchResult } from '../types';

export type AggregateKind = 'sum' | 'count' | 'max' | 'min';

export interface AggregateIntent {
  kind: AggregateKind;
  /** Month window if the question names one ("in July"), else null. */
  monthWindow: { fromDate: number; toDate: number } | null;
}

const SUM_RE = /\b(total|how\s+much\s+(did\s+i|have\s+i|i've)?\s*(spen[dt]|paid?|pay)|sum\s+of|altogether|overall\s+spend)\b/i;
const COUNT_RE = /\b(how\s+many|count\s+of|number\s+of\s+(times|orders|payments|bills))\b/i;
const MAX_RE = /\b(biggest|largest|highest|most\s+expensive|maximum)\b/i;
const MIN_RE = /\b(smallest|lowest|cheapest|minimum)\b/i;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Detect an aggregation question. Returns null for ordinary retrieval
 * questions ("what's my PNR").
 */
export function detectAggregateIntent(question: string, now: Date = new Date()): AggregateIntent | null {
  let kind: AggregateKind | null = null;
  if (SUM_RE.test(question)) {
    kind = 'sum';
  } else if (COUNT_RE.test(question)) {
    kind = 'count';
  } else if (MAX_RE.test(question)) {
    kind = 'max';
  } else if (MIN_RE.test(question)) {
    kind = 'min';
  }
  if (!kind) {
    return null;
  }

  let monthWindow: AggregateIntent['monthWindow'] = null;
  const lower = question.toLowerCase();
  for (let m = 0; m < MONTHS.length; m++) {
    const name = MONTHS[m];
    if (lower.includes(name) || new RegExp(`\\b${name.slice(0, 3)}\\b`).test(lower)) {
      // Most recent occurrence of that month (this year if passed, else last year).
      let year = now.getFullYear();
      if (m > now.getMonth()) {
        year -= 1;
      }
      const from = new Date(year, m, 1).getTime();
      const to = new Date(year, m + 1, 1).getTime() - 1;
      monthWindow = { fromDate: from, toDate: to };
      break;
    }
  }
  if (lower.includes('this month')) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    monthWindow = { fromDate: from, toDate: now.getTime() };
  } else if (lower.includes('last month')) {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const to = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1;
    monthWindow = { fromDate: from, toDate: to };
  }

  return { kind, monthWindow };
}

/** The primary money amount of a screenshot: the largest extracted amount. */
export function primaryAmount(record: ScreenshotRecord): number | null {
  const amounts = record.entities
    .filter(e => e.type === 'amount')
    .map(e => parseFloat(e.value))
    .filter(v => !isNaN(v));
  if (amounts.length === 0) {
    return null;
  }
  return Math.max(...amounts);
}

export interface AggregateAnswer {
  text: string;
  used: ScreenshotRecord[];
}

const MONEY_CATEGORIES = new Set(['payment', 'bill', 'booking']);

function formatInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Compute an aggregate answer over retrieved results. Returns null when the
 * matching screenshots carry no usable amounts (caller falls through to the
 * normal RAG/citation path).
 */
export function computeAggregate(intent: AggregateIntent, results: SearchResult[]): AggregateAnswer | null {
  let records = results.map(r => r.screenshot);
  if (intent.monthWindow) {
    records = records.filter(
      rec => rec.takenAt >= intent.monthWindow!.fromDate && rec.takenAt <= intent.monthWindow!.toDate,
    );
  }
  const money = records
    .filter(rec => MONEY_CATEGORIES.has(rec.category))
    .map(rec => ({ rec, amount: primaryAmount(rec) }))
    .filter((x): x is { rec: ScreenshotRecord; amount: number } => x.amount != null);

  if (intent.kind === 'count') {
    const used = money.length > 0 ? money.map(m => m.rec) : records;
    if (used.length === 0) {
      return null;
    }
    return {
      text: `I found ${used.length} matching screenshot${used.length === 1 ? '' : 's'}.`,
      used,
    };
  }

  if (money.length === 0) {
    return null;
  }

  if (intent.kind === 'sum') {
    const total = money.reduce((acc, m) => acc + m.amount, 0);
    return {
      text: `That adds up to ${formatInr(total)} across ${money.length} screenshot${money.length === 1 ? '' : 's'}.`,
      used: money.map(m => m.rec),
    };
  }

  const sorted = [...money].sort((a, b) => b.amount - a.amount);
  const pick = intent.kind === 'max' ? sorted[0] : sorted[sorted.length - 1];
  return {
    text: `${intent.kind === 'max' ? 'The largest' : 'The smallest'} was ${formatInr(pick.amount)}.`,
    used: [pick.rec],
  };
}
