import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/runtime/llm-provider.js', () => ({
  runLlm: vi.fn(),
}));

import {
  parseExtractionResponse,
  shouldForceSplit,
} from '../../../src/runtime/memory-extractor.js';

describe('shouldForceSplit', () => {
  it('returns true when token count exceeds threshold', () => {
    expect(shouldForceSplit(8192, 10)).toBe(true);
    expect(shouldForceSplit(10000, 10)).toBe(true);
  });

  it('returns true when message count exceeds threshold', () => {
    expect(shouldForceSplit(100, 50)).toBe(true);
    expect(shouldForceSplit(100, 60)).toBe(true);
  });

  it('returns false when both are under threshold', () => {
    expect(shouldForceSplit(8191, 49)).toBe(false);
    expect(shouldForceSplit(1000, 10)).toBe(false);
  });

  it('returns true when both exceed thresholds', () => {
    expect(shouldForceSplit(9000, 60)).toBe(true);
  });
});

describe('parseExtractionResponse', () => {
  it('parses valid extraction response with markers', () => {
    const raw = `Here is the extraction:

---MEMCELL-EXTRACT-START---
{
  "episodicSummary": "The team benchmarked bitboards vs mailbox and chose bitboards.",
  "events": ["Decided to use bitboard representation", "Performance was 3x faster"],
  "relatedDecisions": ["Use bitboard representation for chess engine"]
}
---MEMCELL-EXTRACT-END---

Done.`;

    const result = parseExtractionResponse(raw);
    expect(result.episodicSummary).toBe('The team benchmarked bitboards vs mailbox and chose bitboards.');
    expect(result.events).toEqual([
      'Decided to use bitboard representation',
      'Performance was 3x faster',
    ]);
    expect(result.relatedDecisionIds).toEqual(['Use bitboard representation for chess engine']);
  });

  it('returns empty result when no markers found', () => {
    const result = parseExtractionResponse('No structured output here');
    expect(result.episodicSummary).toBe('');
    expect(result.events).toEqual([]);
    expect(result.relatedDecisionIds).toEqual([]);
  });

  it('returns empty result for malformed JSON', () => {
    const raw = `---MEMCELL-EXTRACT-START---
not valid json
---MEMCELL-EXTRACT-END---`;

    const result = parseExtractionResponse(raw);
    expect(result.episodicSummary).toBe('');
    expect(result.events).toEqual([]);
  });

  it('handles missing fields gracefully', () => {
    const raw = `---MEMCELL-EXTRACT-START---
{
  "episodicSummary": "Summary only"
}
---MEMCELL-EXTRACT-END---`;

    const result = parseExtractionResponse(raw);
    expect(result.episodicSummary).toBe('Summary only');
    expect(result.events).toEqual([]);
    expect(result.relatedDecisionIds).toEqual([]);
  });

  it('filters non-string events', () => {
    const raw = `---MEMCELL-EXTRACT-START---
{
  "episodicSummary": "Summary",
  "events": ["valid", 123, null, "also valid"],
  "relatedDecisions": []
}
---MEMCELL-EXTRACT-END---`;

    const result = parseExtractionResponse(raw);
    expect(result.events).toEqual(['valid', 'also valid']);
  });

  it('handles non-string episodicSummary', () => {
    const raw = `---MEMCELL-EXTRACT-START---
{
  "episodicSummary": 42,
  "events": [],
  "relatedDecisions": []
}
---MEMCELL-EXTRACT-END---`;

    const result = parseExtractionResponse(raw);
    expect(result.episodicSummary).toBe('');
  });

  it('handles only start marker without end', () => {
    const raw = '---MEMCELL-EXTRACT-START--- { "episodicSummary": "test" }';
    const result = parseExtractionResponse(raw);
    expect(result.episodicSummary).toBe('');
  });
});
