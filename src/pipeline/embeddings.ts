/**
 * Text embeddings (PRD §5: BGE-small / MiniLM class via ONNX Runtime Mobile).
 *
 * The real model runs natively (MlModule.embed). When it is unavailable —
 * model still downloading, tests, below-floor device — we fall back to a
 * deterministic hashed bag-of-words projection. The fallback is not semantic,
 * but it keeps cosine math, storage, and ranking code exercised end-to-end,
 * and FTS keyword search still carries relevance.
 */

import { Ml } from '../native';

export const EMBEDDING_DIM = 384;

/** FNV-1a 32-bit hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic bag-of-hashed-ngrams embedding used as fallback. */
export function hashEmbed(text: string, dim: number = EMBEDDING_DIM): Float32Array {
  const vec = new Float32Array(dim);
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(t => t.length > 1);
  for (const token of tokens) {
    const h1 = fnv1a(token);
    const h2 = fnv1a(`s#${token}`);
    // Signed feature hashing: index from h1, sign from h2.
    vec[h1 % dim] += (h2 & 1) === 0 ? 1 : -1;
    // Character trigrams give partial matching for Hinglish/UI tokens.
    for (let i = 0; i + 3 <= token.length; i++) {
      const tri = token.slice(i, i + 3);
      const t1 = fnv1a(`t#${tri}`);
      const t2 = fnv1a(`u#${tri}`);
      vec[t1 % dim] += ((t2 & 1) === 0 ? 1 : -1) * 0.3;
    }
  }
  return l2Normalize(vec);
}

export function l2Normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vec;
  }
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Embed text with the native model when ready, hashed fallback otherwise. */
export async function embedText(text: string): Promise<Float32Array> {
  if (Ml) {
    try {
      if (await Ml.isEmbeddingReady()) {
        const vec = await Ml.embed(text);
        return l2Normalize(Float32Array.from(vec));
      }
    } catch (e) {
      console.warn('[embeddings] native embed failed, using hash fallback', e);
    }
  }
  return hashEmbed(text);
}
