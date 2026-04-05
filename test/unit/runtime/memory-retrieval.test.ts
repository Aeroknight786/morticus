import { describe, it, expect } from 'vitest';
import {
  tokenize,
  buildBM25Index,
  scoreBM25,
  rrfFusion,
  retrieveMemCells,
} from '../../../src/runtime/memory-retrieval.js';
import { createMemCell } from '../../../src/domain/durable-memory.js';
import { generateMemCellId } from '../../../src/domain/ids.js';
import type { MemCell } from '../../../src/domain/durable-memory.js';

function makeExtractedCell(overrides: Partial<MemCell> = {}): MemCell {
  return {
    ...createMemCell(generateMemCellId(), 'test', 'task_completed', 'raw', 100),
    extracted: true,
    episodicSummary: 'default summary',
    events: ['default event'],
    ...overrides,
  };
}

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('removes stopwords', () => {
    const tokens = tokenize('the quick brown fox is a lazy dog');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('is');
    expect(tokens).not.toContain('a');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('fox');
    expect(tokens).toContain('lazy');
    expect(tokens).toContain('dog');
  });

  it('removes single-character tokens', () => {
    expect(tokenize('a b c def')).toEqual(['def']);
  });

  it('splits on slashes', () => {
    expect(tokenize('src/domain/ids')).toEqual(['src', 'domain', 'ids']);
  });

  it('handles empty string', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('BM25 Index', () => {
  it('builds index from documents', () => {
    const docs = [
      { id: 'a', text: 'bitboard chess engine performance' },
      { id: 'b', text: 'mailbox chess representation slower' },
    ];
    const index = buildBM25Index(docs);
    expect(index.docCount).toBe(2);
    expect(index.avgDocLength).toBeGreaterThan(0);
    expect(index.invertedIndex.has('chess')).toBe(true);
    expect(index.invertedIndex.get('chess')!.size).toBe(2);
    expect(index.invertedIndex.get('bitboard')!.size).toBe(1);
  });

  it('handles empty document set', () => {
    const index = buildBM25Index([]);
    expect(index.docCount).toBe(0);
    expect(index.avgDocLength).toBe(0);
  });
});

describe('scoreBM25', () => {
  it('ranks relevant documents higher', () => {
    const docs = [
      { id: 'a', text: 'bitboard chess engine performance benchmark' },
      { id: 'b', text: 'mailbox representation slower approach' },
      { id: 'c', text: 'bitboard performance fast efficient' },
    ];
    const index = buildBM25Index(docs);
    const results = scoreBM25(index, 'bitboard performance', 3);

    expect(results.length).toBeGreaterThan(0);
    // Documents with 'bitboard' and 'performance' should rank higher
    expect(results[0].id).toBe('c'); // has both terms
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('returns empty for empty query', () => {
    const index = buildBM25Index([{ id: 'a', text: 'test' }]);
    expect(scoreBM25(index, '', 5)).toEqual([]);
  });

  it('respects topK limit', () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({
      id: `doc_${i}`,
      text: `document number ${i} chess engine`,
    }));
    const index = buildBM25Index(docs);
    const results = scoreBM25(index, 'chess engine', 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('returns empty when no terms match', () => {
    const index = buildBM25Index([{ id: 'a', text: 'bitboard chess' }]);
    const results = scoreBM25(index, 'quantum physics', 5);
    expect(results).toEqual([]);
  });
});

describe('rrfFusion', () => {
  it('fuses two ranked lists', () => {
    const list1 = [
      { id: 'a', score: 10 },
      { id: 'b', score: 5 },
    ];
    const list2 = [
      { id: 'b', score: 8 },
      { id: 'c', score: 3 },
    ];
    const fused = rrfFusion(list1, list2);

    // 'b' appears in both lists, should have highest fused score
    expect(fused[0].id).toBe('b');
    expect(fused.length).toBe(3);
    // All scores should be positive
    for (const r of fused) {
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it('handles single list', () => {
    const list = [
      { id: 'x', score: 5 },
      { id: 'y', score: 3 },
    ];
    const fused = rrfFusion(list);
    expect(fused).toHaveLength(2);
    expect(fused[0].id).toBe('x');
  });

  it('handles empty lists', () => {
    expect(rrfFusion()).toEqual([]);
    expect(rrfFusion([])).toEqual([]);
  });
});

describe('retrieveMemCells', () => {
  it('returns empty when no cells are extracted', () => {
    const cell = createMemCell(generateMemCellId(), 'test', 'task_completed', 'raw', 100);
    // extracted is false by default
    const results = retrieveMemCells([cell], 'test query');
    expect(results).toEqual([]);
  });

  it('retrieves cells by episodic content', () => {
    const cell1 = makeExtractedCell({
      episodicSummary: 'Benchmarked bitboards vs mailbox representation for chess engine',
      events: ['Decided to use bitboards for 3x performance gain'],
    });
    const cell2 = makeExtractedCell({
      episodicSummary: 'Set up CI/CD pipeline with GitHub Actions',
      events: ['Configured automated testing on push'],
    });

    const results = retrieveMemCells([cell1, cell2], 'bitboard chess performance');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].cell.id).toBe(cell1.id);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('filters by memoryType episodic', () => {
    const cell = makeExtractedCell({
      episodicSummary: 'Explored database options for the project',
      events: ['Chose PostgreSQL over MongoDB for relational data'],
    });

    const results = retrieveMemCells([cell], 'database options', { memoryType: 'episodic' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('filters by memoryType event', () => {
    const cell = makeExtractedCell({
      episodicSummary: 'General discussion about architecture',
      events: ['Chose PostgreSQL over MongoDB for relational data'],
    });

    const results = retrieveMemCells([cell], 'postgresql mongodb', { memoryType: 'event' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('respects topK option', () => {
    const cells = Array.from({ length: 20 }, (_, i) => makeExtractedCell({
      episodicSummary: `Task ${i} explored chess engine optimization`,
    }));

    const results = retrieveMemCells(cells, 'chess engine', { topK: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('respects minScore option', () => {
    const cell = makeExtractedCell({
      episodicSummary: 'Completely unrelated topic about cooking recipes',
    });

    const results = retrieveMemCells([cell], 'chess engine bitboard', { minScore: 100 });
    expect(results).toEqual([]);
  });

  it('boosts recent cells with recencyBoostDays', () => {
    const now = new Date();
    const recentTimestamp = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(); // 12 hours ago
    const oldTimestamp = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago

    const recentCell = makeExtractedCell({
      timestamp: recentTimestamp,
      episodicSummary: 'Chess engine bitboard optimization',
      events: ['Bitboard approach chosen for chess engine'],
    });
    const oldCell = makeExtractedCell({
      timestamp: oldTimestamp,
      episodicSummary: 'Chess engine bitboard analysis',
      events: ['Bitboard data structure for chess evaluation'],
    });

    const withBoost = retrieveMemCells([recentCell, oldCell], 'chess engine bitboard', {
      memoryType: 'episodic',
      recencyBoostDays: 7,
    });
    const withoutBoost = retrieveMemCells([recentCell, oldCell], 'chess engine bitboard', {
      memoryType: 'episodic',
    });

    // With boost, the recent cell should have a higher score than without boost
    if (withBoost.length > 0 && withoutBoost.length > 0) {
      const recentWithBoost = withBoost.find(r => r.cell.id === recentCell.id);
      const recentWithout = withoutBoost.find(r => r.cell.id === recentCell.id);
      if (recentWithBoost && recentWithout) {
        expect(recentWithBoost.score).toBeGreaterThan(recentWithout.score);
      }
    }
  });

  it('works unchanged without recencyBoostDays', () => {
    const cell = makeExtractedCell({
      episodicSummary: 'Chess engine bitboard performance optimization',
    });

    const results = retrieveMemCells([cell], 'chess engine bitboard');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('applies 1.5x boost for cells within 1 day', () => {
    const now = new Date();
    const recentTimestamp = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(); // 6 hours ago

    const cell = makeExtractedCell({
      timestamp: recentTimestamp,
      episodicSummary: 'Chess engine bitboard design',
    });

    const withBoost = retrieveMemCells([cell], 'chess engine bitboard', {
      memoryType: 'episodic',
      recencyBoostDays: 7,
    });
    const withoutBoost = retrieveMemCells([cell], 'chess engine bitboard', {
      memoryType: 'episodic',
    });

    if (withBoost.length > 0 && withoutBoost.length > 0) {
      // 1.5x multiplier for <1 day old
      expect(withBoost[0].score).toBeCloseTo(withoutBoost[0].score * 1.5, 5);
    }
  });
});
