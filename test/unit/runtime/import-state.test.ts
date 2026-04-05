import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProjectStore } from '../../../src/storage/store.js';
import { applyImportedInitialState, buildImportedInitialState } from '../../../src/runtime/import-state.js';

let tmpDir: string;
let store: ProjectStore;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'morticus-import-state-'));
  store = new ProjectStore(tmpDir);
  await store.initialize('Import State Test');
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('buildImportedInitialState', () => {
  it('creates a new version based on the prior current state', async () => {
    const baseState = await store.state.getCurrentState();
    const imported = buildImportedInitialState(baseState, 2, {
      goal: 'Imported goal',
      constraints: ['Use TS'],
      nextStep: 'Open review panel',
    });

    expect(imported.version).toBe(2);
    expect(imported.parentVersion).toBe(1);
    expect(imported.goal).toBe('Imported goal');
    expect(imported.constraints).toEqual(['Use TS']);
    expect(imported.nextStep).toBe('Open review panel');
    expect(baseState.goal).toBe('');
    expect(baseState.version).toBe(1);
  });
});

describe('applyImportedInitialState', () => {
  it('preserves v001 and advances the project current state version', async () => {
    const initialState = await store.state.getVersion(1);
    expect(initialState.goal).toBe('');

    const imported = await applyImportedInitialState(store, {
      goal: 'Imported pricing engine',
      phase: 'implementation',
      knownFiles: ['src/ui/commands.ts'],
    });

    const v1 = await store.state.getVersion(1);
    const current = await store.state.getCurrentState();
    const project = await store.getProject();

    expect(v1.goal).toBe('');
    expect(imported.version).toBe(2);
    expect(imported.parentVersion).toBe(1);
    expect(current.version).toBe(2);
    expect(current.goal).toBe('Imported pricing engine');
    expect(project.currentStateVersion).toBe(2);
  });
});
