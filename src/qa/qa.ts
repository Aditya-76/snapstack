/**
 * Local Q&A over screenshots (PRD §4.4): retrieval-augmented generation with
 * the on-device LLM, citations always shown. Degrades to search-only when the
 * LLM pack isn't installed or the device is below the floor — clearly flagged
 * so the UI can message it (PRD §5 "Device floor").
 */

import { SnapStore } from '../db/store';
import { Ml } from '../native';
import { hybridSearch } from '../search/hybridSearch';
import { CATEGORY_LABELS, QaAnswer, SearchFilters } from '../types';
import { computeAggregate, detectAggregateIntent } from './aggregation';

const TOP_K = 6;
/** Aggregations scan wider than RAG so sums don't miss rows. */
const AGGREGATE_TOP_K = 50;
const MAX_CONTEXT_CHARS_PER_DOC = 700;

export function buildPrompt(question: string, docs: Array<{ index: number; date: string; category: string; text: string }>): string {
  const context = docs
    .map(d => `[${d.index}] (${d.date}, ${d.category})\n${d.text}`)
    .join('\n\n');
  return (
    `You answer questions using only the user's own screenshots below. ` +
    `Cite screenshots by [number]. If the answer isn't in them, say so briefly.\n\n` +
    `Screenshots:\n${context}\n\nQuestion: ${question}\nAnswer:`
  );
}

export async function isQaAvailable(): Promise<boolean> {
  if (!Ml) {
    return false;
  }
  try {
    return await Ml.isLlmReady();
  } catch {
    return false;
  }
}

/**
 * Answer a question with local RAG. Retrieval always runs; generation only
 * when the local LLM is ready.
 */
export async function answerQuestion(
  store: SnapStore,
  question: string,
  filters?: SearchFilters,
  now: Date = new Date(),
): Promise<QaAnswer> {
  // Aggregation questions ("total spent on Swiggy in July") are computed
  // deterministically from extracted amounts — no LLM needed, works in
  // search-only mode too (PRD open question 4).
  const intent = detectAggregateIntent(question, now);
  if (intent) {
    const wide = await hybridSearch(store, question, filters, AGGREGATE_TOP_K);
    const aggregate = computeAggregate(intent, wide);
    if (aggregate) {
      return {
        question,
        answer: aggregate.text,
        citations: aggregate.used.map(rec => ({ screenshot: rec, relevance: 1 })),
        degradedToSearch: false,
      };
    }
  }

  const results = await hybridSearch(store, question, filters, TOP_K);
  const citations = results.map(r => ({ screenshot: r.screenshot, relevance: r.score }));

  const llmReady = await isQaAvailable();
  if (!llmReady || citations.length === 0) {
    return { question, answer: null, citations, degradedToSearch: true };
  }

  const docs = results.map((r, i) => ({
    index: i + 1,
    date: new Date(r.screenshot.takenAt).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    category: CATEGORY_LABELS[r.screenshot.category],
    text: r.screenshot.ocrText.slice(0, MAX_CONTEXT_CHARS_PER_DOC),
  }));

  try {
    const answer = await Ml!.complete(buildPrompt(question, docs), 256);
    return { question, answer: answer.trim(), citations, degradedToSearch: false };
  } catch (e) {
    console.warn('[qa] llm completion failed, degrading to search', e);
    return { question, answer: null, citations, degradedToSearch: true };
  }
}
