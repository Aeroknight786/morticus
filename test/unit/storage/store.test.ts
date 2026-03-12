import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProjectStore } from '../../../src/storage/store.js';
import { createTask, transitionTask } from '../../../src/domain/task.js';
import { generateTaskId } from '../../../src/domain/ids.js';
import { applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import { generateDeltaId } from '../../../src/domain/ids.js';
import type { DeltaOperation } from '../../../src/domain/state-delta.js';

let tmpDir: string;
let store: ProjectStore;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'morticus-test-'));
  store = new ProjectStore(tmpDir);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('ProjectStore', () => {
  it('initializes .morticus directory structure', async () => {
    const project = await store.initialize('Test Project');
    expect(project.name).toBe('Test Project');
    expect(project.currentStateVersion).toBe(1);

    const morticusDir = path.join(tmpDir, '.morticus');
    expect(fs.existsSync(morticusDir)).toBe(true);
    expect(fs.existsSync(path.join(morticusDir, 'project.json'))).toBe(true);
    expect(fs.existsSync(path.join(morticusDir, 'state', 'current.json'))).toBe(true);
    expect(fs.existsSync(path.join(morticusDir, 'state', 'versions', 'v001.json'))).toBe(true);
    expect(fs.existsSync(path.join(morticusDir, 'memory', 'entries.json'))).toBe(true);
  });

  it('throws if already initialized', async () => {
    await store.initialize('Test');
    await expect(store.initialize('Test')).rejects.toThrow('already initialized');
  });

  it('roundtrips project data', async () => {
    await store.initialize('Round Trip');
    const project = await store.getProject();
    expect(project.name).toBe('Round Trip');
    expect(project.settings.defaultProvider).toBe('claude');
  });
});

describe('StateStore roundtrip', () => {
  it('reads initial state', async () => {
    await store.initialize('State Test');
    const state = await store.state.getCurrentState();
    expect(state.version).toBe(1);
    expect(state.goal).toBe('');
  });

  it('saves and reads new state version', async () => {
    await store.initialize('State Version Test');
    const state = await store.state.getCurrentState();
    const deltaId = generateDeltaId();
    const ops: DeltaOperation[] = [
      { type: 'set_goal', value: 'Build something' },
      { type: 'add_constraint', value: 'Keep it simple' },
    ];
    const next = applyDeltaOperations(state, ops, deltaId);
    await store.state.saveVersion(next);

    const loaded = await store.state.getCurrentState();
    expect(loaded.version).toBe(2);
    expect(loaded.goal).toBe('Build something');
    expect(loaded.constraints).toEqual(['Keep it simple']);

    // Old version still accessible
    const v1 = await store.state.getVersion(1);
    expect(v1.goal).toBe('');
  });
});

describe('TaskStore roundtrip', () => {
  it('saves and lists tasks', async () => {
    await store.initialize('Task Test');
    const project = await store.getProject();
    const task = createTask(
      generateTaskId(),
      project.id,
      'Test task',
      'Test goal',
      'discovery',
      { paths: ['src/'], readOnly: true, writePermissions: [] },
      1,
    );
    await store.tasks.save(task);

    const tasks = await store.tasks.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Test task');

    const loaded = await store.tasks.get(task.id);
    expect(loaded.id).toBe(task.id);
  });
});
