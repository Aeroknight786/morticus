// BM25 + Reciprocal Rank Fusion retrieval for MemCells.
// Pure TypeScript, no LLM calls, no external dependencies.
// Adapted from EverMemOS (Apache 2.0) — see THIRD_PARTY_NOTICES.md.

import type { MemCell, MemoryType } from '../domain/durable-memory.js';

// ── Stopwords ──

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'but', 'not', 'no', 'nor',
  'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from', 'as',
  'it', 'its', 'this', 'that', 'these', 'those',
  'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'should', 'can', 'could',
  'all', 'each', 'every', 'any', 'some', 'we', 'our', 'us',
  'if', 'then', 'when', 'while', 'so', 'also',
  'use', 'using', 'used',
]);

// ── Tokenizer ──

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_/-]/g, ' ')
    .split(/[\s/]+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

// ── BM25 Index ──

export interface BM25Index {
  documents: Map<string, string[]>;  // id → tokens
  avgDocLength: number;
  docCount: number;
  // term → set of doc ids containing that term
  invertedIndex: Map<string, Set<string>>;
}

export function buildBM25Index(documents: Array<{ id: string; text: string }>): BM25Index {
  const docMap = new Map<string, string[]>();
  const invertedIndex = new Map<string, Set<string>>();
  let totalLength = 0;

  for (const doc of documents) {
    const tokens = tokenize(doc.text);
    docMap.set(doc.id, tokens);
    totalLength += tokens.length;

    for (const token of new Set(tokens)) {
      let docSet = invertedIndex.get(token);
      if (!docSet) {
        docSet = new Set();
        invertedIndex.set(token, docSet);
      }
      docSet.add(doc.id);
    }
  }

  return {
    documents: docMap,
    avgDocLength: documents.length > 0 ? totalLength / documents.length : 0,
    docCount: documents.length,
    invertedIndex,
  };
}

// Standard BM25Okapi: k1=1.5, b=0.75
const K1 = 1.5;
const B = 0.75;

export function scoreBM25(
  index: BM25Index,
  query: string,
  topK: number,
): Array<{ id: string; score: number }> {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scores = new Map<string, number>();

  for (const term of queryTokens) {
    const docsWithTerm = index.invertedIndex.get(term);
    if (!docsWithTerm) continue;

    const df = docsWithTerm.size;
    // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((index.docCount - df + 0.5) / (df + 0.5) + 1);

    for (const docId of docsWithTerm) {
      const docTokens = index.documents.get(docId)!;
      const docLength = docTokens.length;

      // Term frequency in this document
      let tf = 0;
      for (const t of docTokens) {
        if (t === term) tf++;
      }

      // BM25 score component for this term
      const numerator = tf * (K1 + 1);
      const denominator = tf + K1 * (1 - B + B * (docLength / index.avgDocLength));
      const termScore = idf * (numerator / denominator);

      scores.set(docId, (scores.get(docId) ?? 0) + termScore);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── Reciprocal Rank Fusion (from EverMemOS, Apache 2.0) ──

const RRF_K = 60;

export function rrfFusion(
  ...rankedLists: Array<Array<{ id: string; score: number }>>
): Array<{ id: string; score: number }> {
  const fused = new Map<string, number>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const { id } = list[rank];
      fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
    }
  }

  return [...fused.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// ── Combined MemCell retrieval ──

export interface RetrievalOptions {
  topK?: number;
  memoryType?: MemoryType;
  minScore?: number;
  recencyBoostDays?: number;  // MemCells newer than this get a boost (default: 7)
}

// Apply recency boost to scored results. Deterministic: based on cell timestamp vs now.
function applyRecencyBoost(
  results: Array<{ id: string; score: number }>,
  cellMap: Map<string, MemCell>,
  recencyBoostDays: number,
): Array<{ id: string; score: number }> {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const boostWindowMs = recencyBoostDays * oneDayMs;

  return results
    .map(r => {
      const cell = cellMap.get(r.id);
      if (!cell) return r;
      const ageMs = now - new Date(cell.timestamp).getTime();
      let multiplier = 1.0;
      if (ageMs <= oneDayMs) {
        multiplier = 1.5;
      } else if (ageMs <= boostWindowMs) {
        multiplier = 1.2;
      }
      return { id: r.id, score: r.score * multiplier };
    })
    .sort((a, b) => b.score - a.score);
}

export function retrieveMemCells(
  cells: MemCell[],
  query: string,
  options: RetrievalOptions = {},
): Array<{ cell: MemCell; score: number }> {
  const { topK = 10, memoryType, minScore = 0, recencyBoostDays } = options;

  // Filter to extracted cells only
  const extracted = cells.filter(c => c.extracted);
  if (extracted.length === 0) return [];

  const cellMap = new Map<string, MemCell>(extracted.map(c => [c.id, c]));

  // Build separate indices for episodic and event content
  const episodicDocs: Array<{ id: string; text: string }> = [];
  const eventDocs: Array<{ id: string; text: string }> = [];

  for (const cell of extracted) {
    if (cell.episodicSummary) {
      episodicDocs.push({ id: cell.id, text: cell.episodicSummary });
    }
    if (cell.events.length > 0) {
      eventDocs.push({ id: cell.id, text: cell.events.join(' ') });
    }
  }

  // Helper: optionally apply recency boost then convert to final shape
  function finalize(scored: Array<{ id: string; score: number }>): Array<{ cell: MemCell; score: number }> {
    let boosted = scored;
    if (recencyBoostDays !== undefined) {
      boosted = applyRecencyBoost(scored, cellMap, recencyBoostDays);
    }
    return boosted
      .filter(r => r.score >= minScore)
      .map(r => ({ cell: cellMap.get(r.id)!, score: r.score }));
  }

  // Type-filtered retrieval
  if (memoryType === 'episodic') {
    const index = buildBM25Index(episodicDocs);
    return finalize(scoreBM25(index, query, topK));
  }

  if (memoryType === 'event') {
    const index = buildBM25Index(eventDocs);
    return finalize(scoreBM25(index, query, topK));
  }

  // Default: fuse episodic + event rankings via RRF
  const episodicIndex = buildBM25Index(episodicDocs);
  const eventIndex = buildBM25Index(eventDocs);

  const episodicRanking = scoreBM25(episodicIndex, query, topK * 2);
  const eventRanking = scoreBM25(eventIndex, query, topK * 2);

  const fused = rrfFusion(episodicRanking, eventRanking);

  return finalize(fused.slice(0, topK));
}
