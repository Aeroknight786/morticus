import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemCellStore } from '../../../src/storage/memcell-store.js';
import { createMemCell } from '../../../src/domain/durable-memory.js';
import { generateMemCellId } from '../../../src/domain/ids.js';
import type { MemCell } from '../../../src/domain/durable-memory.js';

let tmpDir: string;
let store: MemCellStore;

function makeCell(overrides: Partial<MemCell> = {}): MemCell {
  return {
    ...createMemCell(
      generateMemCellId(),
      'task:task_1',
      'task_completed',
      'raw content',
      100,
    ),
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'morticus-memcell-'));
  const morticusPath = path.join(tmpDir, '.morticus');
  store = new MemCellStore(morticusPath);
  await store.initialize();
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('MemCellStore', () => {
  it('save and get round-trips a MemCell', async () => {
    const cell = makeCell();
    await store.save(cell);

    const loaded = await store.get(cell.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(cell.id);
    expect(loaded!.source).toBe(cell.source);
    expect(loaded!.boundaryReason).toBe('task_completed');
    expect(loaded!.rawContent).toBe('raw content');
  });

  it('get returns null for non-existent id', async () => {
    const result = await store.get(generateMemCellId());
    expect(result).toBeNull();
  });

  it('list returns all cells sorted by timestamp desc', async () => {
    const cell1 = makeCell({ timestamp: '2025-01-01T00:00:00.000Z' });
    const cell2 = makeCell({ timestamp: '2025-01-03T00:00:00.000Z' });
    const cell3 = makeCell({ timestamp: '2025-01-02T00:00:00.000Z' });

    await store.save(cell1);
    await store.save(cell2);
    await store.save(cell3);

    const all = await store.list();
    expect(all).toHaveLength(3);
    expect(all[0].id).toBe(cell2.id);  // newest first
    expect(all[1].id).toBe(cell3.id);
    expect(all[2].id).toBe(cell1.id);
  });

  it('list returns empty array when no cells', async () => {
    const all = await store.list();
    expect(all).toEqual([]);
  });

  it('listBySource filters by source prefix', async () => {
    const taskCell = makeCell({ source: 'task:task_abc' });
    const chatCell = makeCell({ source: 'chat:session_xyz' });
    const importCell = makeCell({ source: 'import:arch_123' });

    await store.save(taskCell);
    await store.save(chatCell);
    await store.save(importCell);

    const taskCells = await store.listBySource('task:');
    expect(taskCells).toHaveLength(1);
    expect(taskCells[0].id).toBe(taskCell.id);

    const chatCells = await store.listBySource('chat:');
    expect(chatCells).toHaveLength(1);
    expect(chatCells[0].id).toBe(chatCell.id);
  });

  it('update patches fields and sets updatedAt', async () => {
    const cell = makeCell();
    await store.save(cell);

    await store.update(cell.id, {
      episodicSummary: 'Extracted summary',
      events: ['fact 1', 'fact 2'],
      extracted: true,
    });

    const updated = await store.get(cell.id);
    expect(updated!.episodicSummary).toBe('Extracted summary');
    expect(updated!.events).toEqual(['fact 1', 'fact 2']);
    expect(updated!.extracted).toBe(true);
    expect(updated!.id).toBe(cell.id); // id unchanged
    expect(updated!.updatedAt).not.toBe(cell.updatedAt);
  });

  it('update is no-op for non-existent id', async () => {
    // Should not throw
    await store.update(generateMemCellId(), { episodicSummary: 'test' });
  });

  it('save overwrites existing cell', async () => {
    const cell = makeCell();
    await store.save(cell);

    const updated = { ...cell, episodicSummary: 'new summary' };
    await store.save(updated);

    const loaded = await store.get(cell.id);
    expect(loaded!.episodicSummary).toBe('new summary');
  });
});
