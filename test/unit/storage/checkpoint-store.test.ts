import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CheckpointStore } from '../../../src/storage/checkpoint-store.js';
import { generateCheckpointId } from '../../../src/domain/ids.js';
import type { Checkpoint } from '../../../src/domain/checkpoint.js';
import type { StateVersion } from '../../../src/domain/ids.js';

describe('CheckpointStore', () => {
  let tmpDir: string;
  let store: CheckpointStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-test-'));
    store = new CheckpointStore(path.join(tmpDir, 'checkpoints.json'));
  });

  function makeCheckpoint(version: number, label: string): Checkpoint {
    return {
      id: generateCheckpointId(),
      version: version as StateVersion,
      label,
      createdAt: new Date().toISOString(),
    };
  }

  it('list returns empty array when no file exists', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('add persists checkpoint and list returns it', async () => {
    const ckpt = makeCheckpoint(3, 'Before refactor');
    await store.add(ckpt);
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('Before refactor');
    expect(all[0].version).toBe(3);
  });

  it('add accumulates multiple checkpoints', async () => {
    await store.add(makeCheckpoint(1, 'Initial'));
    await store.add(makeCheckpoint(5, 'Milestone'));
    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it('remove deletes by id', async () => {
    const ckpt1 = makeCheckpoint(1, 'Keep');
    const ckpt2 = makeCheckpoint(2, 'Remove');
    await store.add(ckpt1);
    await store.add(ckpt2);
    await store.remove(ckpt2.id);
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('Keep');
  });

  it('remove is a no-op for non-existent id', async () => {
    const ckpt = makeCheckpoint(1, 'Keep');
    await store.add(ckpt);
    await store.remove(generateCheckpointId());
    expect(await store.list()).toHaveLength(1);
  });
});
