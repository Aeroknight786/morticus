import { describe, it, expect } from 'vitest';
import { extractKnowledge, deduplicateEntries } from '../../../src/review/knowledge-extractor.js';
import type { DeltaOperation } from '../../../src/domain/state-delta.js';
import type { TaskId, RunId, DeltaId } from '../../../src/domain/ids.js';
import type { MemoryEntry } from '../../../src/domain/durable-memory.js';

const TASK_ID = 'task_test1' as TaskId;
const RUN_ID = 'run_test1' as RunId;
const DELTA_ID = 'delta_test1' as DeltaId;

describe('extractKnowledge', () => {
  it('extracts add_decision operations as memory entries', () => {
    const ops: DeltaOperation[] = [
      { type: 'add_decision', value: 'Use TypeScript branded types for IDs' },
    ];
    const entries = extractKnowledge(ops, 'Setup task', TASK_ID, RUN_ID, DELTA_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('architecture_invariant');
    expect(entries[0].title).toBe('Use TypeScript branded types for IDs');
    expect(entries[0].content).toContain('Use TypeScript branded types for IDs');
    expect(entries[0].content).toContain('Source: task "Setup task"');
    expect(entries[0].normalizedValue).toBe('Use TypeScript branded types for IDs');
  });

  it('sets provenance fields correctly', () => {
    const ops: DeltaOperation[] = [
      { type: 'add_decision', value: 'Some decision' },
    ];
    const entries = extractKnowledge(ops, 'My task', TASK_ID, RUN_ID, DELTA_ID);
    const e = entries[0];

    expect(e.origin).toBe('auto_extracted');
    expect(e.sourceTaskId).toBe(TASK_ID);
    expect(e.sourceRunId).toBe(RUN_ID);
    expect(e.sourceDeltaId).toBe(DELTA_ID);
    expect(e.sourceOperationType).toBe('add_decision');
  });

  it('defaults to active: false and reviewed: false', () => {
    const ops: DeltaOperation[] = [
      { type: 'add_decision', value: 'Decision' },
    ];
    const entries = extractKnowledge(ops, 'Task', TASK_ID, RUN_ID, DELTA_ID);

    expect(entries[0].active).toBe(false);
    expect(entries[0].reviewed).toBe(false);
  });

  it('ignores non-decision operations', () => {
    const ops: DeltaOperation[] = [
      { type: 'add_constraint', value: 'No external deps' },
      { type: 'add_risk', value: 'Timeline risk' },
      { type: 'set_goal', value: 'Build MVP' },
      { type: 'add_known_file', path: 'src/main.ts' },
      { type: 'remove_decision', value: 'Old decision' },
    ];
    const entries = extractKnowledge(ops, 'Task', TASK_ID, RUN_ID, DELTA_ID);

    expect(entries).toHaveLength(0);
  });

  it('extracts multiple decisions from same delta', () => {
    const ops: DeltaOperation[] = [
      { type: 'add_decision', value: 'Decision A' },
      { type: 'add_constraint', value: 'Constraint' },
      { type: 'add_decision', value: 'Decision B' },
    ];
    const entries = extractKnowledge(ops, 'Task', TASK_ID, RUN_ID, DELTA_ID);

    expect(entries).toHaveLength(2);
    expect(entries[0].normalizedValue).toBe('Decision A');
    expect(entries[1].normalizedValue).toBe('Decision B');
  });

  it('truncates long decision titles to 80 chars', () => {
    const longValue = 'A'.repeat(100);
    const ops: DeltaOperation[] = [
      { type: 'add_decision', value: longValue },
    ];
    const entries = extractKnowledge(ops, 'Task', TASK_ID, RUN_ID, DELTA_ID);

    expect(entries[0].title.length).toBeLessThanOrEqual(80);
    expect(entries[0].title).toBe('A'.repeat(77) + '...');
    // Full value preserved in content and normalizedValue
    expect(entries[0].normalizedValue).toBe(longValue);
    expect(entries[0].content).toContain(longValue);
  });

  it('handles null runId', () => {
    const ops: DeltaOperation[] = [
      { type: 'add_decision', value: 'Decision' },
    ];
    const entries = extractKnowledge(ops, 'Task', TASK_ID, null, DELTA_ID);

    expect(entries[0].sourceRunId).toBeNull();
  });

  it('generates unique IDs for each entry', () => {
    const ops: DeltaOperation[] = [
      { type: 'add_decision', value: 'Decision A' },
      { type: 'add_decision', value: 'Decision B' },
    ];
    const entries = extractKnowledge(ops, 'Task', TASK_ID, RUN_ID, DELTA_ID);

    expect(entries[0].id).not.toBe(entries[1].id);
  });
});

describe('deduplicateEntries', () => {
  function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
    return {
      id: 'mem_test' as MemoryEntry['id'],
      category: 'architecture_invariant',
      title: 'Test',
      content: 'Test content',
      origin: 'auto_extracted',
      active: false,
      reviewed: false,
      normalizedValue: 'Test value',
      sourceTaskId: TASK_ID,
      sourceRunId: RUN_ID,
      sourceDeltaId: DELTA_ID,
      sourceOperationType: 'add_decision',
      sourceArchiveId: null,
      memCellId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('filters out candidates that match existing entries on category + normalizedValue', () => {
    const candidates = [makeEntry({ normalizedValue: 'Use branded IDs' })];
    const existing = [makeEntry({ normalizedValue: 'Use branded IDs', content: 'Different attribution text' })];

    const result = deduplicateEntries(candidates, existing);
    expect(result).toHaveLength(0);
  });

  it('keeps candidates that differ in normalizedValue', () => {
    const candidates = [makeEntry({ normalizedValue: 'New decision' })];
    const existing = [makeEntry({ normalizedValue: 'Different decision' })];

    const result = deduplicateEntries(candidates, existing);
    expect(result).toHaveLength(1);
  });

  it('keeps candidates that differ in category even with same normalizedValue', () => {
    const candidates = [makeEntry({ category: 'coding_standard', normalizedValue: 'Same value' })];
    const existing = [makeEntry({ category: 'architecture_invariant', normalizedValue: 'Same value' })];

    const result = deduplicateEntries(candidates, existing);
    expect(result).toHaveLength(1);
  });

  it('keeps entries with null normalizedValue (user-created)', () => {
    const candidates = [makeEntry({ normalizedValue: null })];
    const existing = [makeEntry({ normalizedValue: null })];

    const result = deduplicateEntries(candidates, existing);
    expect(result).toHaveLength(1);
  });

  it('handles empty existing entries', () => {
    const candidates = [
      makeEntry({ normalizedValue: 'A' }),
      makeEntry({ normalizedValue: 'B' }),
    ];
    const result = deduplicateEntries(candidates, []);
    expect(result).toHaveLength(2);
  });

  it('handles empty candidates', () => {
    const existing = [makeEntry({ normalizedValue: 'A' })];
    const result = deduplicateEntries([], existing);
    expect(result).toHaveLength(0);
  });
});
