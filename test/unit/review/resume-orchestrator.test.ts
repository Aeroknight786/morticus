import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProjectStore } from '../../../src/storage/store.js';
import { resumeFromVersion } from '../../../src/review/resume-orchestrator.js';
import { createTask, transitionTask } from '../../../src/domain/task.js';
import { generateTaskId, generateDeltaId, generateCheckpointId } from '../../../src/domain/ids.js';
import { applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import type { StateVersion } from '../../../src/domain/ids.js';

let tmpDir: string;
let store: ProjectStore;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'resume-test-'));
  store = new ProjectStore(tmpDir);
  await store.initialize('Resume Test');
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('resumeFromVersion', () => {
  it('repoints current version to target', async () => {
    // Create v2
    const v1 = await store.state.getCurrentState();
    const v2 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'Goal A' }], generateDeltaId());
    await store.state.saveVersion(v2);

    // Resume to v1
    await resumeFromVersion(store, 1 as StateVersion);
    const current = await store.state.getCurrentVersion();
    expect(current).toBe(1);
  });

  it('archives active tasks and leaves terminal tasks unchanged', async () => {
    const project = await store.getProject();

    // Create a draft task (active)
    const draft = createTask(generateTaskId(), project.id, 'Draft', 'goal', 'discovery', { paths: [], readOnly: true, writePermissions: [] }, 1 as StateVersion);
    await store.tasks.save(draft);

    // Create a running task (active)
    const ready = createTask(generateTaskId(), project.id, 'Running', 'goal', 'implementation', { paths: [], readOnly: false, writePermissions: [] }, 1 as StateVersion);
    const readyTask = transitionTask(ready, 'ready');
    const runningTask = transitionTask(readyTask, 'running');
    await store.tasks.save(runningTask);

    // Create a merged task (terminal — should NOT be archived)
    const merged = createTask(generateTaskId(), project.id, 'Merged', 'goal', 'discovery', { paths: [], readOnly: true, writePermissions: [] }, 1 as StateVersion);
    const mergedReady = transitionTask(merged, 'ready');
    const mergedRunning = transitionTask(mergedReady, 'running');
    const mergedAwait = transitionTask(mergedRunning, 'awaiting_completion');
    const mergedNorm = transitionTask(mergedAwait, 'normalizing_output');
    const mergedReview = transitionTask(mergedNorm, 'awaiting_review');
    const mergedDone = transitionTask(mergedReview, 'merged');
    await store.tasks.save(mergedDone);

    const result = await resumeFromVersion(store, 1 as StateVersion);

    // Both active tasks should be archived
    expect(result.archivedTaskIds).toHaveLength(2);
    expect(result.archivedTaskIds).toContain(draft.id);
    expect(result.archivedTaskIds).toContain(runningTask.id);

    // Verify tasks on disk
    const allTasks = await store.tasks.list();
    for (const t of allTasks) {
      if (t.id === draft.id || t.id === runningTask.id) {
        expect(t.status).toBe('archived');
      }
      if (t.id === mergedDone.id) {
        expect(t.status).toBe('merged');
      }
    }
  });

  it('returns correct resumedToVersion', async () => {
    const result = await resumeFromVersion(store, 1 as StateVersion);
    expect(result.resumedToVersion).toBe(1);
  });

  it('throws when target version does not exist', async () => {
    await expect(resumeFromVersion(store, 99 as StateVersion)).rejects.toThrow();
  });

  it('returns empty archivedTaskIds when no active tasks exist', async () => {
    const result = await resumeFromVersion(store, 1 as StateVersion);
    expect(result.archivedTaskIds).toEqual([]);
  });
});

// These tests exercise the integrated resume→continue flow, including
// version collision prevention and parentVersion correctness across non-linear history.
describe('resume → continue → version semantics', () => {
  // Helper: save a new state version using getNextVersion (mimics delta-applier)
  async function applyAndSave(baseVersion: StateVersion, goal: string) {
    const base = await store.state.getVersion(baseVersion);
    const newState = applyDeltaOperations(base, [{ type: 'set_goal', value: goal }], generateDeltaId());
    const safeVersion = await store.state.getNextVersion();
    const versionedState = { ...newState, version: safeVersion };
    await store.state.saveVersion(versionedState);
    return versionedState;
  }

  it('resume from older version → accept delta → no version collision, correct parentVersion', async () => {
    // Build linear history: v1 → v2 → v3
    const v1 = await store.state.getCurrentState();
    const v2 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'A' }], generateDeltaId());
    await store.state.saveVersion(v2);
    const v3 = applyDeltaOperations(v2, [{ type: 'set_phase', value: 'B' }], generateDeltaId());
    await store.state.saveVersion(v3);

    // Resume to v1
    await resumeFromVersion(store, 1 as StateVersion);
    expect(await store.state.getCurrentVersion()).toBe(1);

    // Apply a delta from v1 — should get v4 (not v2), parentVersion=1
    const v4 = await applyAndSave(1 as StateVersion, 'C');
    expect(v4.version).toBe(4);
    expect(v4.parentVersion).toBe(1);
    expect(v4.goal).toBe('C');

    // All versions coexist on disk
    expect((await store.state.getVersion(2)).goal).toBe('A');
    expect((await store.state.getVersion(3)).phase).toBe('B');
    expect((await store.state.getVersion(4)).goal).toBe('C');
  });

  it('multiple sequential resumes maintain coherent state', async () => {
    // Build: v1 → v2 → v3
    const v1 = await store.state.getCurrentState();
    const v2 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'A' }], generateDeltaId());
    await store.state.saveVersion(v2);
    const v3 = applyDeltaOperations(v2, [{ type: 'set_goal', value: 'B' }], generateDeltaId());
    await store.state.saveVersion(v3);

    // Resume to v2
    await resumeFromVersion(store, 2 as StateVersion);
    expect(await store.state.getCurrentVersion()).toBe(2);

    // Continue from v2 → v4 (parentVersion=2)
    const v4 = await applyAndSave(2 as StateVersion, 'C');
    expect(v4.version).toBe(4);
    expect(v4.parentVersion).toBe(2);

    // Resume again to v1
    await resumeFromVersion(store, 1 as StateVersion);
    expect(await store.state.getCurrentVersion()).toBe(1);

    // Continue from v1 → v5 (parentVersion=1)
    const v5 = await applyAndSave(1 as StateVersion, 'D');
    expect(v5.version).toBe(5);
    expect(v5.parentVersion).toBe(1);

    // All five versions exist with correct lineage
    const versions = await store.state.listVersions();
    expect(versions).toHaveLength(5);
    expect(versions.map(v => v.parentVersion)).toEqual([null, 1, 2, 2, 1]);
  });

  it('current version pointer stays coherent after repeated resumes', async () => {
    const v1 = await store.state.getCurrentState();
    const v2 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'X' }], generateDeltaId());
    await store.state.saveVersion(v2);

    // Resume back and forth
    await resumeFromVersion(store, 1 as StateVersion);
    expect(await store.state.getCurrentVersion()).toBe(1);
    expect((await store.state.getCurrentState()).goal).toBe('');

    await resumeFromVersion(store, 2 as StateVersion);
    expect(await store.state.getCurrentVersion()).toBe(2);
    expect((await store.state.getCurrentState()).goal).toBe('X');

    await resumeFromVersion(store, 1 as StateVersion);
    expect(await store.state.getCurrentVersion()).toBe(1);
  });

  it('getNextVersion returns correct value after resume', async () => {
    const v1 = await store.state.getCurrentState();
    const v2 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'A' }], generateDeltaId());
    await store.state.saveVersion(v2);
    const v3 = applyDeltaOperations(v2, [{ type: 'set_goal', value: 'B' }], generateDeltaId());
    await store.state.saveVersion(v3);

    // Resume to v1 — getNextVersion must still return 4, not 2
    await resumeFromVersion(store, 1 as StateVersion);
    expect(await store.state.getNextVersion()).toBe(4);
  });
});

describe('checkpoint persistence across resume', () => {
  it('checkpoint created before resume is still visible after resume', async () => {
    const v1 = await store.state.getCurrentState();
    const v2 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'A' }], generateDeltaId());
    await store.state.saveVersion(v2);

    // Checkpoint v2
    await store.checkpoints.add({
      id: generateCheckpointId(),
      version: 2 as StateVersion,
      label: 'Before experiment',
      createdAt: new Date().toISOString(),
    });

    // Resume to v1
    await resumeFromVersion(store, 1 as StateVersion);

    // Checkpoint still exists
    const checkpoints = await store.checkpoints.list();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].label).toBe('Before experiment');
    expect(checkpoints[0].version).toBe(2);
  });

  it('checkpoint created after resume branch continues works correctly', async () => {
    const v1 = await store.state.getCurrentState();
    const v2 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'A' }], generateDeltaId());
    await store.state.saveVersion(v2);

    // Resume to v1
    await resumeFromVersion(store, 1 as StateVersion);

    // Continue from v1 → v3
    const v3base = await store.state.getVersion(1 as StateVersion);
    const v3 = applyDeltaOperations(v3base, [{ type: 'set_goal', value: 'B' }], generateDeltaId());
    const safeV = await store.state.getNextVersion();
    const v3versioned = { ...v3, version: safeV };
    await store.state.saveVersion(v3versioned);

    // Checkpoint the new version
    await store.checkpoints.add({
      id: generateCheckpointId(),
      version: v3versioned.version,
      label: 'After resume',
      createdAt: new Date().toISOString(),
    });

    const checkpoints = await store.checkpoints.list();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].version).toBe(3);
    expect(checkpoints[0].label).toBe('After resume');
  });
});
