import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RunStore } from '../../../src/storage/run-store.js';
import { createTaskRun } from '../../../src/domain/task-run.js';
import type { RunId, TaskId } from '../../../src/domain/ids.js';

let tmpDir: string;
let store: RunStore;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'morticus-run-test-'));
  const morticusPath = path.join(tmpDir, '.morticus');
  store = new RunStore(morticusPath);
  await store.initialize();
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('RunStore', () => {
  it('save and get a run', async () => {
    const run = createTaskRun('run_1' as RunId, 'task_1' as TaskId, 'claude');
    await store.save(run);

    const retrieved = await store.get('run_1' as RunId);
    expect(retrieved.id).toBe('run_1');
    expect(retrieved.taskId).toBe('task_1');
    expect(retrieved.status).toBe('pending');
  });

  it('list returns all saved runs', async () => {
    const run1 = createTaskRun('run_1' as RunId, 'task_1' as TaskId, 'claude');
    const run2 = createTaskRun('run_2' as RunId, 'task_2' as TaskId, 'claude');
    await store.save(run1);
    await store.save(run2);

    const runs = await store.list();
    expect(runs).toHaveLength(2);
    const ids = runs.map(r => r.id);
    expect(ids).toContain('run_1');
    expect(ids).toContain('run_2');
  });

  it('list returns empty array when no runs exist', async () => {
    const runs = await store.list();
    expect(runs).toEqual([]);
  });

  it('saveRawOutput and getRawOutput roundtrip', async () => {
    const run = createTaskRun('run_1' as RunId, 'task_1' as TaskId, 'claude');
    await store.save(run);
    await store.saveRawOutput('run_1' as RunId, 'Hello from Claude');

    const raw = await store.getRawOutput('run_1' as RunId);
    expect(raw).toBe('Hello from Claude');
  });

  it('getRawOutput returns null when no output exists', async () => {
    const run = createTaskRun('run_1' as RunId, 'task_1' as TaskId, 'claude');
    await store.save(run);

    const raw = await store.getRawOutput('run_1' as RunId);
    expect(raw).toBeNull();
  });

  it('saveNormalizedOutput and getNormalizedOutput roundtrip', async () => {
    const run = createTaskRun('run_1' as RunId, 'task_1' as TaskId, 'claude');
    await store.save(run);

    const normalized = {
      summary: 'Completed task',
      inspectedFiles: ['a.ts'],
      modifiedFiles: [],
      proposedDelta: {
        addConstraints: [], removeConstraints: [],
        addDecisions: [], removeDecisions: [],
        addRisks: [], removeRisks: [],
        addKnownFiles: [], removeKnownFiles: [],
        setGoal: null, setPhase: null, setNextStep: null,
      },
      evidenceRefs: [],
      confidence: 0.9,
      completionReason: 'task_goal_met' as const,
      unresolvedIssues: [],
    };
    await store.saveNormalizedOutput('run_1' as RunId, normalized);

    const retrieved = await store.getNormalizedOutput('run_1' as RunId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.summary).toBe('Completed task');
    expect(retrieved!.confidence).toBe(0.9);
  });

  it('getNormalizedOutput returns null when no output exists', async () => {
    const run = createTaskRun('run_1' as RunId, 'task_1' as TaskId, 'claude');
    await store.save(run);

    const normalized = await store.getNormalizedOutput('run_1' as RunId);
    expect(normalized).toBeNull();
  });

  it('save overwrites existing run data', async () => {
    const run = createTaskRun('run_1' as RunId, 'task_1' as TaskId, 'claude');
    await store.save(run);

    const updated = { ...run, status: 'completed' as const, endedAt: new Date().toISOString() };
    await store.save(updated);

    const retrieved = await store.get('run_1' as RunId);
    expect(retrieved.status).toBe('completed');
  });
});
