import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/runtime/llm-provider.js', () => ({
  runLlm: vi.fn(),
}));

import { parseScratchpadHandoffResponse } from '../../../src/runtime/scratchpad-adapter.js';

const HANDOFF_START = '---MORTICUS-SCRATCHPAD-HANDOFF-START---';
const HANDOFF_END = '---MORTICUS-SCRATCHPAD-HANDOFF-END---';

describe('parseScratchpadHandoffResponse', () => {
  it('parses a well-formed handoff response', () => {
    const json = JSON.stringify({
      summary: 'Explored caching strategies',
      keyFindings: ['Redis is best for this workload'],
      unresolvedQuestions: ['Cache invalidation policy?'],
    });
    const raw = `Some preamble text.\n\n${HANDOFF_START}\n${json}\n${HANDOFF_END}\n\nSome epilogue.`;
    const result = parseScratchpadHandoffResponse(raw);
    expect(result.summary).toBe('Explored caching strategies');
    expect(result.keyFindings).toEqual(['Redis is best for this workload']);
    expect(result.unresolvedQuestions).toEqual(['Cache invalidation policy?']);
  });

  it('returns minimal handoff when markers are missing', () => {
    const raw = 'Claude just responded with plain text, no markers here.';
    const result = parseScratchpadHandoffResponse(raw);
    expect(result.summary).toBe(raw.trim());
    expect(result.keyFindings).toEqual([]);
    expect(result.unresolvedQuestions).toEqual([]);
  });

  it('returns fallback when JSON between markers is malformed', () => {
    const raw = `${HANDOFF_START}\n{this is not valid json}\n${HANDOFF_END}`;
    const result = parseScratchpadHandoffResponse(raw);
    expect(result.summary).toBe('Failed to parse handoff. Raw output preserved in scratchpad.');
    expect(result.keyFindings).toEqual([]);
  });

  it('truncates summary from raw response when no markers (max 500 chars)', () => {
    const longText = 'A'.repeat(600);
    const result = parseScratchpadHandoffResponse(longText);
    expect(result.summary).toHaveLength(500);
  });

  it('handles empty raw response', () => {
    const result = parseScratchpadHandoffResponse('');
    expect(result.summary).toBe('Scratchpad session ended without structured handoff.');
    expect(result.keyFindings).toEqual([]);
  });

  it('parses handoff with candidateTask and candidateDelta', () => {
    const json = JSON.stringify({
      summary: 'Full handoff',
      keyFindings: ['Finding 1'],
      unresolvedQuestions: [],
      candidateTask: {
        title: 'Implement caching',
        goal: 'Add Redis caching layer',
        taskType: 'implementation',
        scopePaths: ['src/cache/'],
      },
      candidateDelta: {
        operations: [{ type: 'add_decision', value: 'Use Redis for caching' }],
        rationale: 'Decided during exploration',
      },
    });
    const raw = `${HANDOFF_START}\n${json}\n${HANDOFF_END}`;
    const result = parseScratchpadHandoffResponse(raw);
    expect(result.candidateTask).toBeDefined();
    expect(result.candidateTask!.title).toBe('Implement caching');
    expect(result.candidateDelta).toBeDefined();
    expect(result.candidateDelta!.operations).toHaveLength(1);
  });
});
