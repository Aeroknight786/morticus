import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemoryStore } from '../../../src/storage/memory-store.js';
import { createEmptyMemory, type MemoryEntry } from '../../../src/domain/durable-memory.js';
import type { MemoryEntryId, TaskId, RunId, DeltaId } from '../../../src/domain/ids.js';

let tmpDir: string;
let store: MemoryStore;

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: ('mem_' + Math.random().toString(36).slice(2, 8)) as MemoryEntryId,
    category: 'architecture_invariant',
    title: 'Test entry',
    content: 'Test content',
    origin: 'user',
    active: true,
    reviewed: true,
    normalizedValue: null,
    sourceTaskId: null,
    sourceRunId: null,
    sourceDeltaId: null,
    sourceOperationType: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'morticus-mem-test-'));
  const morticusPath = path.join(tmpDir, '.morticus');
  store = new MemoryStore(morticusPath);
  await store.initialize(createEmptyMemory());
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('MemoryStore CRUD', () => {
  it('addEntry adds an entry and bumps version', async () => {
    const entry = makeEntry({ title: 'First entry' });
    await store.addEntry(entry);

    const memory = await store.get();
    expect(memory.entries).toHaveLength(1);
    expect(memory.entries[0].title).toBe('First entry');
    expect(memory.version).toBe(2); // started at 1, bumped to 2
  });

  it('addEntry preserves provenance fields', async () => {
    const entry = makeEntry({
      origin: 'auto_extracted',
      active: false,
      reviewed: false,
      normalizedValue: 'Raw decision text',
      sourceTaskId: 'task_1' as TaskId,
      sourceRunId: 'run_1' as RunId,
      sourceDeltaId: 'delta_1' as DeltaId,
      sourceOperationType: 'add_decision',
    });
    await store.addEntry(entry);

    const retrieved = await store.getEntry(entry.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.origin).toBe('auto_extracted');
    expect(retrieved!.active).toBe(false);
    expect(retrieved!.reviewed).toBe(false);
    expect(retrieved!.normalizedValue).toBe('Raw decision text');
    expect(retrieved!.sourceTaskId).toBe('task_1');
    expect(retrieved!.sourceRunId).toBe('run_1');
    expect(retrieved!.sourceDeltaId).toBe('delta_1');
    expect(retrieved!.sourceOperationType).toBe('add_decision');
  });

  it('getEntry returns undefined for non-existent ID', async () => {
    const result = await store.getEntry('mem_nonexistent' as MemoryEntryId);
    expect(result).toBeUndefined();
  });

  it('updateEntry modifies specific fields', async () => {
    const entry = makeEntry({ title: 'Original', active: false });
    await store.addEntry(entry);

    await store.updateEntry(entry.id, { title: 'Updated', active: true });

    const updated = await store.getEntry(entry.id);
    expect(updated!.title).toBe('Updated');
    expect(updated!.active).toBe(true);
    // Content should remain unchanged
    expect(updated!.content).toBe('Test content');
  });

  it('updateEntry bumps version', async () => {
    const entry = makeEntry();
    await store.addEntry(entry);
    const afterAdd = await store.get();
    const versionAfterAdd = afterAdd.version;

    await store.updateEntry(entry.id, { reviewed: true });

    const afterUpdate = await store.get();
    expect(afterUpdate.version).toBe(versionAfterAdd + 1);
  });

  it('updateEntry is a no-op for non-existent ID', async () => {
    const memoryBefore = await store.get();
    await store.updateEntry('mem_nonexistent' as MemoryEntryId, { title: 'Nope' });
    const memoryAfter = await store.get();
    // Version should not change for non-existent update
    expect(memoryAfter.version).toBe(memoryBefore.version);
  });

  it('removeEntry removes the entry and bumps version', async () => {
    const entry1 = makeEntry({ title: 'Keep' });
    const entry2 = makeEntry({ title: 'Remove' });
    await store.addEntry(entry1);
    await store.addEntry(entry2);

    const beforeRemove = await store.get();
    expect(beforeRemove.entries).toHaveLength(2);

    await store.removeEntry(entry2.id);

    const afterRemove = await store.get();
    expect(afterRemove.entries).toHaveLength(1);
    expect(afterRemove.entries[0].title).toBe('Keep');
    expect(afterRemove.version).toBe(beforeRemove.version + 1);
  });

  it('multiple entries can be added and retrieved', async () => {
    await store.addEntry(makeEntry({ title: 'A' }));
    await store.addEntry(makeEntry({ title: 'B' }));
    await store.addEntry(makeEntry({ title: 'C' }));

    const memory = await store.get();
    expect(memory.entries).toHaveLength(3);
    expect(memory.entries.map(e => e.title)).toEqual(['A', 'B', 'C']);
  });
});
