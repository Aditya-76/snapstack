/**
 * Hybrid search (PRD §4.4): keyword (FTS5/BM25) + semantic (embedding cosine),
 * merged with Reciprocal Rank Fusion. RRF is rank-based, so the two legs'
 * incomparable score scales don't need calibration.
 */

import { SnapStore } from '../db/store';
import { cosineSimilarity, embedText } from '../pipeline/embeddings';
import { ScreenshotRecord, SearchFilters, SearchResult } from '../types';

const RRF_K = 60;
/** Semantic hits below this cosine are noise, not matches. */
const MIN_SEMANTIC_SIMILARITY = 0.15;

interface RankedLeg {
  id: string;
  rank: number; // 0-based
}

export function rrfMerge(
  keyword: RankedLeg[],
  semantic: RankedLeg[],
): Array<{ id: string; score: number; matchedBy: Array<'keyword' | 'semantic'> }> {
  const scores = new Map<string, { score: number; matchedBy: Array<'keyword' | 'semantic'> }>();

  for (const hit of keyword) {
    const entry = scores.get(hit.id) ?? { score: 0, matchedBy: [] };
    entry.score += 1 / (RRF_K + hit.rank + 1);
    entry.matchedBy.push('keyword');
    scores.set(hit.id, entry);
  }
  for (const hit of semantic) {
    const entry = scores.get(hit.id) ?? { score: 0, matchedBy: [] };
    entry.score += 1 / (RRF_K + hit.rank + 1);
    entry.matchedBy.push('semantic');
    scores.set(hit.id, entry);
  }

  return [...scores.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.score - a.score);
}

export async function hybridSearch(
  store: SnapStore,
  query: string,
  filters?: SearchFilters,
  limit: number = 30,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  // Leg 1: keyword.
  const keywordHits = await store.keywordSearch(trimmed, filters, limit * 2);

  // Leg 2: semantic brute-force over embedded records.
  const queryVec = await embedText(trimmed);
  const embedded = await store.listEmbedded(filters);
  const semanticHits = embedded
    .map(rec => ({ rec, sim: rec.embedding ? cosineSimilarity(queryVec, rec.embedding) : 0 }))
    .filter(h => h.sim >= MIN_SEMANTIC_SIMILARITY)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit * 2);

  const merged = rrfMerge(
    keywordHits.map((h, i) => ({ id: h.screenshotId, rank: i })),
    semanticHits.map((h, i) => ({ id: h.rec.id, rank: i })),
  ).slice(0, limit);

  const snippetById = new Map(keywordHits.map(h => [h.screenshotId, h.snippet]));
  const recordById = new Map<string, ScreenshotRecord>(semanticHits.map(h => [h.rec.id, h.rec]));

  const results: SearchResult[] = [];
  for (const m of merged) {
    const record = recordById.get(m.id) ?? (await store.getScreenshot(m.id));
    if (!record) {
      continue;
    }
    results.push({
      screenshot: record,
      score: m.score,
      matchedBy: [...new Set(m.matchedBy)],
      snippet: snippetById.get(m.id) ?? null,
    });
  }
  return results;
}
