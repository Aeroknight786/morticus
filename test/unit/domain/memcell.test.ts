import { describe, it, expect } from 'vitest';
import {
  createMemCell,
  type MemCell,
  type BoundaryReason,
  type MemoryType,
} from '../../../src/domain/durable-memory.js';
import { generateMemCellId } from '../../../src/domain/ids.js';
import type { MemCellId } from '../../../src/domain/ids.js';

describe('MemCell domain types', () => {
  it('generateMemCellId produces branded id with mc_ prefix', () => {
    const id = generateMemCellId();
    expect(id).toMatch(/^mc_/);
    // Type system ensures this is a MemCellId
    const _check: MemCellId = id;
    expect(_check).toBe(id);
  });

  it('createMemCell produces a valid MemCell with defaults', () => {
    const id = generateMemCellId();
    const cell = createMemCell(id, 'task:task_123', 'task_completed', 'Some raw content', 100);

    expect(cell.id).toBe(id);
    expect(cell.source).toBe('task:task_123');
    expect(cell.boundaryReason).toBe('task_completed');
    expect(cell.rawContent).toBe('Some raw content');
    expect(cell.tokenCount).toBe(100);
    expect(cell.episodicSummary).toBeNull();
    expect(cell.events).toEqual([]);
    expect(cell.relatedDecisionIds).toEqual([]);
    expect(cell.relatedTaskIds).toEqual([]);
    expect(cell.extracted).toBe(false);
    expect(cell.createdAt).toBeTruthy();
    expect(cell.updatedAt).toBeTruthy();
    expect(cell.timestamp).toBeTruthy();
  });

  it('supports all boundary reasons', () => {
    const reasons: BoundaryReason[] = [
      'task_completed',
      'review_accepted',
      'force_split',
      'topic_shift',
      'scratchpad_exit',
      'import_chunk',
    ];
    for (const reason of reasons) {
      const cell = createMemCell(generateMemCellId(), 'test', reason, 'content', 10);
      expect(cell.boundaryReason).toBe(reason);
    }
  });

  it('MemoryType union covers episodic and event', () => {
    const types: MemoryType[] = ['episodic', 'event'];
    expect(types).toHaveLength(2);
  });

  it('createMemCell sets timestamp to ISO string', () => {
    const cell = createMemCell(generateMemCellId(), 'chat:sess_1', 'force_split', 'text', 50);
    // Should be a valid ISO date
    expect(new Date(cell.timestamp).toISOString()).toBe(cell.timestamp);
  });

  it('unique IDs across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateMemCellId());
    }
    expect(ids.size).toBe(100);
  });
});
