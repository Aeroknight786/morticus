import { describe, it, expect } from 'vitest';
import { buildContextPack, estimateTokens } from '../../../src/compiler/context-pack.js';
import { createInitialState, applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import { createEmptyMemory } from '../../../src/domain/durable-memory.js';
import type { DurableMemory, MemoryEntry } from '../../../src/domain/durable-memory.js';
import { createTask } from '../../../src/domain/task.js';
import { generateTaskId, generateProjectId, generateDeltaId, generateMemoryEntryId } from '../../../src/domain/ids.js';
import type { ContextPackOptions } from '../../../src/domain/task-spec.js';

const projectId = generateProjectId();

function makeTask(goal = 'Test goal') {
  return createTask(
    generateTaskId(), projectId, 'Test', goal, 'implementation',
    { paths: ['src/'], readOnly: false, writePermissions: [] }, 1,
  );
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: generateMemoryEntryId(),
    category: 'coding_standard',
    title: 'Rule',
    content: 'Do the thing',
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
    ...overrides,
  };
}

function makeMemory(entries: MemoryEntry[]): DurableMemory {
  return { ...createEmptyMemory(), entries };
}

describe('buildContextPack — memory deduplication', () => {
  it('memory appears in stablePrefix, not relevantMemoryEntries', () => {
    const memory = makeMemory([makeEntry({ title: 'Use ESLint', content: 'Always lint' })]);
    const pack = buildContextPack(createInitialState(), memory, makeTask());
    expect(pack.stablePrefix).toContain('Use ESLint');
    expect(pack.stablePrefix).toContain('Always lint');
    expect(pack.relevantMemoryEntries).toEqual([]);
  });

  it('relevantMemoryEntries is always empty array', () => {
    const memory = makeMemory([
      makeEntry({ title: 'A' }),
      makeEntry({ title: 'B' }),
    ]);
    const pack = buildContextPack(createInitialState(), memory, makeTask());
    expect(pack.relevantMemoryEntries).toEqual([]);
    expect(pack.stablePrefix).toContain('A');
    expect(pack.stablePrefix).toContain('B');
  });
});

describe('buildContextPack — category filtering', () => {
  const entries = [
    makeEntry({ category: 'coding_standard', title: 'CS1' }),
    makeEntry({ category: 'test_convention', title: 'TC1' }),
    makeEntry({ category: 'architecture_invariant', title: 'AI1' }),
    makeEntry({ category: 'domain_glossary', title: 'DG1' }),
  ];

  it('includeCategories filters to specified categories only', () => {
    const memory = makeMemory(entries);
    const pack = buildContextPack(createInitialState(), memory, makeTask(), {
      includeCategories: ['coding_standard', 'architecture_invariant'],
    });
    expect(pack.stablePrefix).toContain('CS1');
    expect(pack.stablePrefix).toContain('AI1');
    expect(pack.stablePrefix).not.toContain('TC1');
    expect(pack.stablePrefix).not.toContain('DG1');
  });

  it('excludeCategories removes specified categories', () => {
    const memory = makeMemory(entries);
    const pack = buildContextPack(createInitialState(), memory, makeTask(), {
      excludeCategories: ['test_convention'],
    });
    expect(pack.stablePrefix).toContain('CS1');
    expect(pack.stablePrefix).toContain('AI1');
    expect(pack.stablePrefix).toContain('DG1');
    expect(pack.stablePrefix).not.toContain('TC1');
  });

  it('includeCategories + excludeCategories compose correctly', () => {
    const memory = makeMemory(entries);
    const pack = buildContextPack(createInitialState(), memory, makeTask(), {
      includeCategories: ['coding_standard', 'test_convention', 'architecture_invariant'],
      excludeCategories: ['test_convention'],
    });
    expect(pack.stablePrefix).toContain('CS1');
    expect(pack.stablePrefix).toContain('AI1');
    expect(pack.stablePrefix).not.toContain('TC1');
    expect(pack.stablePrefix).not.toContain('DG1');
  });

  it('maxMemoryEntries applies after category filtering', () => {
    const memory = makeMemory(entries);
    const pack = buildContextPack(createInitialState(), memory, makeTask(), {
      excludeCategories: ['domain_glossary'],
      maxMemoryEntries: 2,
    });
    // After excluding DG1, we have CS1, TC1, AI1 — take first 2
    expect(pack.stablePrefix).toContain('CS1');
    expect(pack.stablePrefix).toContain('TC1');
    expect(pack.stablePrefix).not.toContain('AI1');
  });
});

describe('buildContextPack — token budget', () => {
  it('maxTokens null means no trimming', () => {
    const ops = [
      { type: 'set_goal' as const, value: 'Build it' },
      { type: 'add_decision' as const, value: 'Use TypeScript' },
      { type: 'add_risk' as const, value: 'Scope creep' },
      { type: 'add_known_file' as const, path: 'src/main.ts' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const memory = makeMemory([makeEntry({ title: 'Rule1', content: 'content' })]);
    const pack = buildContextPack(state, memory, makeTask(), { maxTokens: null });
    expect(pack.canonicalStateSummary).toContain('Use TypeScript');
    expect(pack.canonicalStateSummary).toContain('Scope creep');
    expect(pack.canonicalStateSummary).toContain('src/main.ts');
    expect(pack.stablePrefix).toContain('Rule1');
  });

  it('trims knownFiles first', () => {
    const ops = [
      { type: 'set_goal' as const, value: 'G' },
      { type: 'add_decision' as const, value: 'D' },
      { type: 'add_risk' as const, value: 'R' },
      { type: 'add_known_file' as const, path: 'a'.repeat(200) },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const task = makeTask('goal');
    const fullPack = buildContextPack(state, createEmptyMemory(), task);
    // Set budget just under full size
    const pack = buildContextPack(state, createEmptyMemory(), task, {
      maxTokens: fullPack.estimatedTokens - 10,
    });
    expect(pack.canonicalStateSummary).not.toContain('a'.repeat(200));
    expect(pack.canonicalStateSummary).toContain('D'); // decisions kept
    expect(pack.canonicalStateSummary).toContain('R'); // risks kept
  });

  it('trims risks after knownFiles', () => {
    const ops = [
      { type: 'set_goal' as const, value: 'G' },
      { type: 'add_decision' as const, value: 'D' },
      { type: 'add_risk' as const, value: 'R'.repeat(200) },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const task = makeTask('goal');
    // Very tight budget
    const pack = buildContextPack(state, createEmptyMemory(), task, { maxTokens: 30 });
    expect(pack.canonicalStateSummary).not.toContain('R'.repeat(200));
  });

  it('trims decisions after risks', () => {
    const ops = [
      { type: 'set_goal' as const, value: 'G' },
      { type: 'add_decision' as const, value: 'D'.repeat(200) },
      { type: 'add_risk' as const, value: 'R'.repeat(200) },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const task = makeTask('goal');
    const pack = buildContextPack(state, createEmptyMemory(), task, { maxTokens: 30 });
    expect(pack.canonicalStateSummary).not.toContain('D'.repeat(200));
    expect(pack.canonicalStateSummary).not.toContain('R'.repeat(200));
  });

  it('trims stablePrefix last', () => {
    const ops = [{ type: 'set_goal' as const, value: 'G' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const memory = makeMemory([makeEntry({ content: 'M'.repeat(500) })]);
    const task = makeTask('goal');
    const pack = buildContextPack(state, memory, task, { maxTokens: 20 });
    expect(pack.stablePrefix).toBe('');
  });

  it('never trims taskGoal, scopeDescription, constraints', () => {
    const ops = [
      { type: 'set_goal' as const, value: 'G' },
      { type: 'add_constraint' as const, value: 'Must keep' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const task = makeTask('Critical goal');
    // Extremely tight budget — should still have taskGoal, scope, constraints
    const pack = buildContextPack(state, createEmptyMemory(), task, { maxTokens: 1 });
    expect(pack.taskGoal).toBe('Critical goal');
    expect(pack.scopeDescription).toContain('src/');
    expect(pack.constraints).toContain('Must keep');
  });
});

describe('buildContextPack — determinism', () => {
  it('same inputs produce same output', () => {
    const state = createInitialState();
    const memory = makeMemory([makeEntry({ title: 'A' })]);
    const task = makeTask();
    const pack1 = buildContextPack(state, memory, task);
    const pack2 = buildContextPack(state, memory, task);
    expect(pack1.stablePrefix).toBe(pack2.stablePrefix);
    expect(pack1.canonicalStateSummary).toBe(pack2.canonicalStateSummary);
    expect(pack1.relevantMemoryEntries).toEqual(pack2.relevantMemoryEntries);
    expect(pack1.estimatedTokens).toBe(pack2.estimatedTokens);
  });
});

describe('buildContextPack — edge cases', () => {
  it('empty memory with all options produces valid pack', () => {
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), makeTask(), {
      includeCategories: ['coding_standard'],
      excludeCategories: ['test_convention'],
      maxTokens: 10000,
      maxMemoryEntries: 5,
    });
    expect(pack.stablePrefix).toBe('');
    expect(pack.relevantMemoryEntries).toEqual([]);
    expect(pack.estimatedTokens).toBeGreaterThan(0);
    expect(pack.taskGoal).toBe('Test goal');
  });
});
