import { describe, it, expect } from 'vitest';
import { resolveTaskSpec } from '../../../src/compiler/spec-resolver.js';
import { createInitialState, applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import { createEmptyMemory, createMemCell } from '../../../src/domain/durable-memory.js';
import type { DurableMemory, MemoryEntry, MemCell } from '../../../src/domain/durable-memory.js';
import { createTask } from '../../../src/domain/task.js';
import { generateTaskId, generateProjectId, generateDeltaId, generateMemoryEntryId, generateMemCellId } from '../../../src/domain/ids.js';

describe('resolveTaskSpec', () => {
  const projectId = generateProjectId();

  it('discovery task gets read-only policy', () => {
    const state = createInitialState();
    const memory = createEmptyMemory();
    const task = createTask(
      generateTaskId(), projectId, 'Trace auth',
      'Find auth middleware', 'discovery',
      { paths: ['src/server/'], readOnly: true, writePermissions: [] }, 1,
    );

    const spec = resolveTaskSpec(task, state, memory);
    expect(spec.taskId).toBe(task.id);
    expect(spec.baseStateVersion).toBe(1);
    expect(spec.writePermissions).toEqual([]);
    expect(spec.allowedTools).toContain('read');
    expect(spec.allowedTools).toContain('grep');
    expect(spec.allowedTools).not.toContain('write');
    expect(spec.mergePolicy).toBe('require_review');
    expect(spec.compilerVersion).toBe('0.1.0');
  });

  it('implementation task gets write permissions', () => {
    const state = createInitialState();
    const memory = createEmptyMemory();
    const task = createTask(
      generateTaskId(), projectId, 'Add OAuth',
      'Implement OAuth callback', 'implementation',
      { paths: ['src/'], readOnly: false, writePermissions: ['create_files', 'modify_files'] }, 1,
    );

    const spec = resolveTaskSpec(task, state, memory);
    expect(spec.writePermissions).toContain('create_files');
    expect(spec.writePermissions).toContain('modify_files');
    expect(spec.allowedTools).toContain('write');
    expect(spec.allowedTools).toContain('edit');
  });

  it('context pack includes state summary', () => {
    const ops = [
      { type: 'set_goal' as const, value: 'Add SSO' },
      { type: 'add_constraint' as const, value: 'Preserve middleware' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const memory = createEmptyMemory();
    const task = createTask(
      generateTaskId(), projectId, 'Test',
      'Test goal', 'discovery',
      { paths: ['src/'], readOnly: true, writePermissions: [] },
      state.version,
    );

    const spec = resolveTaskSpec(task, state, memory);
    expect(spec.contextPack.canonicalStateSummary).toContain('Add SSO');
    expect(spec.contextPack.constraints).toContain('Preserve middleware');
    expect(spec.contextPack.taskGoal).toBe('Test goal');
    expect(spec.contextPack.scopeDescription).toContain('Read-only');
  });

  it('discovery task omits decisions and risks by default', () => {
    const ops = [
      { type: 'add_decision' as const, value: 'Use feature flags' },
      { type: 'add_risk' as const, value: 'Auth bypass' },
      { type: 'set_goal' as const, value: 'Explore codebase' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const memory = createEmptyMemory();
    const task = createTask(
      generateTaskId(), projectId, 'Explore',
      'Find file layout', 'discovery',
      { paths: ['src/'], readOnly: true, writePermissions: [] },
      state.version,
    );

    const spec = resolveTaskSpec(task, state, memory);
    // Discovery tasks default to minimal context — decisions and risks omitted
    expect(spec.contextPack.canonicalStateSummary).not.toContain('Use feature flags');
    expect(spec.contextPack.canonicalStateSummary).not.toContain('Auth bypass');
    expect(spec.contextPack.canonicalStateSummary).toContain('Explore codebase');
  });

  it('context pack includes estimated token count', () => {
    const state = createInitialState();
    const memory = createEmptyMemory();
    const task = createTask(
      generateTaskId(), projectId, 'Token test',
      'Some goal', 'implementation',
      { paths: ['src/'], readOnly: false, writePermissions: [] },
      state.version,
    );

    const spec = resolveTaskSpec(task, state, memory);
    expect(typeof spec.contextPack.estimatedTokens).toBe('number');
    expect(spec.contextPack.estimatedTokens).toBeGreaterThan(0);
  });

  it('stable prefix is empty when no memory entries', () => {
    const state = createInitialState();
    const memory = createEmptyMemory();
    const task = createTask(
      generateTaskId(), projectId, 'No memory',
      'Test', 'discovery',
      { paths: [], readOnly: true, writePermissions: [] }, 1,
    );
    const spec = resolveTaskSpec(task, state, memory);
    expect(spec.contextPack.stablePrefix).toBe('');
  });

  it('discovery task excludes test_convention memory category', () => {
    const state = createInitialState();
    const now = new Date().toISOString();
    const makeEntry = (category: MemoryEntry['category'], title: string): MemoryEntry => ({
      id: generateMemoryEntryId(),
      category,
      title,
      content: `${title} content`,
      createdAt: now,
      updatedAt: now,
      active: true,
      origin: 'user',
      sourceTaskId: null,
      sourceRunId: null,
      sourceDeltaId: null,
      sourceOperationType: null,
      reviewed: true,
      normalizedValue: null,
      sourceArchiveId: null,
      memCellId: null,
    });
    const memory: DurableMemory = {
      ...createEmptyMemory(),
      entries: [
        makeEntry('coding_standard', 'CS'),
        makeEntry('test_convention', 'TC'),
        makeEntry('architecture_invariant', 'AI'),
      ],
    };
    const task = createTask(
      generateTaskId(), projectId, 'Explore',
      'Find things', 'discovery',
      { paths: ['src/'], readOnly: true, writePermissions: [] }, 1,
    );
    const spec = resolveTaskSpec(task, state, memory, { memoryRelevanceThreshold: null });
    expect(spec.contextPack.stablePrefix).toContain('CS');
    expect(spec.contextPack.stablePrefix).toContain('AI');
    expect(spec.contextPack.stablePrefix).not.toContain('TC');
  });

  it('validation task excludes domain_glossary memory category', () => {
    const state = createInitialState();
    const now = new Date().toISOString();
    const makeEntry = (category: MemoryEntry['category'], title: string): MemoryEntry => ({
      id: generateMemoryEntryId(),
      category,
      title,
      content: `${title} content`,
      createdAt: now,
      updatedAt: now,
      active: true,
      origin: 'user',
      sourceTaskId: null,
      sourceRunId: null,
      sourceDeltaId: null,
      sourceOperationType: null,
      reviewed: true,
      normalizedValue: null,
      sourceArchiveId: null,
      memCellId: null,
    });
    const memory: DurableMemory = {
      ...createEmptyMemory(),
      entries: [
        makeEntry('coding_standard', 'CS'),
        makeEntry('domain_glossary', 'DG'),
      ],
    };
    const task = createTask(
      generateTaskId(), projectId, 'Validate',
      'Run checks', 'validation',
      { paths: ['src/'], readOnly: true, writePermissions: [] }, 1,
    );
    const spec = resolveTaskSpec(task, state, memory, { memoryRelevanceThreshold: null });
    expect(spec.contextPack.stablePrefix).toContain('CS');
    expect(spec.contextPack.stablePrefix).not.toContain('DG');
  });

  it('threads MemCells to context pack when provided', () => {
    const state = createInitialState();
    const memory = createEmptyMemory();
    const cell: MemCell = {
      ...createMemCell(generateMemCellId(), 'test', 'task_completed', 'raw', 100),
      extracted: true,
      episodicSummary: 'Auth middleware exploration results',
      events: ['JWT chosen for auth tokens'],
    };
    const task = createTask(
      generateTaskId(), projectId, 'Auth work',
      'Implement auth middleware', 'implementation',
      { paths: ['src/auth/'], readOnly: false, writePermissions: [] }, 1,
    );
    const spec = resolveTaskSpec(task, state, memory, {}, [cell]);
    expect(spec.contextPack.contextManifest!.memCellsAvailable).toBe(1);
    expect(spec.contextPack.stablePrefix).toContain('Auth middleware exploration');
  });

  it('works unchanged without MemCells (backward compat)', () => {
    const state = createInitialState();
    const memory = createEmptyMemory();
    const task = createTask(
      generateTaskId(), projectId, 'Basic',
      'Test goal', 'discovery',
      { paths: [], readOnly: true, writePermissions: [] }, 1,
    );
    const spec = resolveTaskSpec(task, state, memory);
    expect(spec.contextPack.contextManifest!.memCellsAvailable).toBe(0);
    expect(spec.contextPack.contextManifest!.memCellsIncluded).toBe(0);
  });
});
