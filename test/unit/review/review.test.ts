import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildDelta } from '../../../src/review/delta-builder.js';
import { validateDelta } from '../../../src/review/validator.js';
import { applyAcceptedDelta } from '../../../src/review/delta-applier.js';
import { createInitialState, applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import { generateTaskId, generateDeltaId, generateSpecId } from '../../../src/domain/ids.js';
import type { ProposedDelta } from '../../../src/domain/task-run.js';
import type { TaskSpec } from '../../../src/domain/task-spec.js';
import { StateStore } from '../../../src/storage/state-store.js';
import { DeltaStore } from '../../../src/storage/delta-store.js';

describe('delta-builder', () => {
  it('converts ProposedDelta to StateDelta operations', () => {
    const proposed: ProposedDelta = {
      addConstraints: ['Keep it simple'],
      removeConstraints: [],
      addDecisions: ['Use TypeScript'],
      removeDecisions: [],
      addRisks: ['Scope creep'],
      removeRisks: [],
      addKnownFiles: ['src/main.ts'],
      removeKnownFiles: [],
      setGoal: 'Build MVP',
      setPhase: null,
      setNextStep: 'Implement types',
    };
    const taskId = generateTaskId();
    const delta = buildDelta(proposed, taskId, 1);

    expect(delta.taskId).toBe(taskId);
    expect(delta.baseStateVersion).toBe(1);
    expect(delta.operations).toHaveLength(6);
    expect(delta.operations[0]).toEqual({ type: 'add_constraint', value: 'Keep it simple' });
    expect(delta.operations[4]).toEqual({ type: 'set_goal', value: 'Build MVP' });
    expect(delta.status).toBe('proposed');
  });
});

describe('validator', () => {
  const makeSpec = (scopePaths: string[]): TaskSpec => ({
    id: generateSpecId(),
    taskId: generateTaskId(),
    baseStateVersion: 1,
    scopePaths,
    allowedTools: [],
    writePermissions: [],
    testRequirements: [],
    outputSchema: { version: '1.0.0' },
    stopConditions: [],
    mergePolicy: 'require_review',
    contextPack: {
      stablePrefix: '',
      canonicalStateSummary: '',
      relevantMemoryEntries: [],
      scopeDescription: '',
      taskGoal: '',
      constraints: [],
      estimatedTokens: 0,
    },
    compiledAt: new Date().toISOString(),
    compilerVersion: '0.1.0',
  });

  it('detects stale base version', () => {
    const state = applyDeltaOperations(createInitialState(), [], generateDeltaId());
    // state is now v2, but delta says v1
    const proposed: ProposedDelta = {
      addConstraints: ['X'], removeConstraints: [], addDecisions: [],
      removeDecisions: [], addRisks: [], removeRisks: [],
      addKnownFiles: [], removeKnownFiles: [],
      setGoal: null, setPhase: null, setNextStep: null,
    };
    const delta = buildDelta(proposed, generateTaskId(), 1);
    const spec = makeSpec([]);
    const conflicts = validateDelta(delta, state, spec);
    expect(conflicts.some(c => c.type === 'stale_base_version')).toBe(true);
  });

  it('detects scope violation', () => {
    const state = createInitialState();
    const proposed: ProposedDelta = {
      addConstraints: [], removeConstraints: [], addDecisions: [],
      removeDecisions: [], addRisks: [], removeRisks: [],
      addKnownFiles: ['lib/other.ts'], removeKnownFiles: [],
      setGoal: null, setPhase: null, setNextStep: null,
    };
    const delta = buildDelta(proposed, generateTaskId(), 1);
    const spec = makeSpec(['src/']);
    const conflicts = validateDelta(delta, state, spec);
    expect(conflicts.some(c => c.type === 'scope_violation')).toBe(true);
  });

  it('no conflicts when clean', () => {
    const state = createInitialState();
    const proposed: ProposedDelta = {
      addConstraints: ['OK'], removeConstraints: [], addDecisions: [],
      removeDecisions: [], addRisks: [], removeRisks: [],
      addKnownFiles: ['src/foo.ts'], removeKnownFiles: [],
      setGoal: null, setPhase: null, setNextStep: null,
    };
    const delta = buildDelta(proposed, generateTaskId(), 1);
    const spec = makeSpec(['src/']);
    const conflicts = validateDelta(delta, state, spec);
    expect(conflicts).toHaveLength(0);
  });
});

describe('delta-applier', () => {
  let tmpDir: string;
  let stateStore: StateStore;
  let deltaStore: DeltaStore;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'morticus-review-'));
    const morticusPath = path.join(tmpDir, '.morticus');
    stateStore = new StateStore(morticusPath);
    deltaStore = new DeltaStore(morticusPath);
    await stateStore.initialize(createInitialState());
    await deltaStore.initialize();
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('applies delta and persists new state version', async () => {
    const state = await stateStore.getCurrentState();
    const proposed: ProposedDelta = {
      addConstraints: ['No magic'], removeConstraints: [], addDecisions: [],
      removeDecisions: [], addRisks: [], removeRisks: [],
      addKnownFiles: [], removeKnownFiles: [],
      setGoal: 'Ship it', setPhase: null, setNextStep: 'Write tests',
    };
    const delta = buildDelta(proposed, generateTaskId(), state.version);
    const result = await applyAcceptedDelta(delta, state, stateStore, deltaStore);

    expect(result.newState.version).toBe(2);
    expect(result.newState.goal).toBe('Ship it');
    expect(result.newState.constraints).toEqual(['No magic']);

    // Verify persisted
    const loaded = await stateStore.getCurrentState();
    expect(loaded.version).toBe(2);
    expect(loaded.goal).toBe('Ship it');
  });
});
