import { describe, it, expect } from 'vitest';
import { buildContextPack, buildStateSummary, estimateTokens } from '../../../src/compiler/context-pack.js';
import { createInitialState, applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import { createEmptyMemory, createMemCell } from '../../../src/domain/durable-memory.js';
import type { DurableMemory, MemoryEntry, MemCell } from '../../../src/domain/durable-memory.js';
import { createTask } from '../../../src/domain/task.js';
import { generateTaskId, generateProjectId, generateDeltaId, generateMemoryEntryId, generateMemCellId } from '../../../src/domain/ids.js';
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
    sourceArchiveId: null,
    memCellId: null,
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

describe('buildContextPack — scope filtering', () => {
  it('scopeFilterKnownFiles filters by path prefix', () => {
    const ops = [
      { type: 'add_known_file' as const, path: 'src/auth/login.ts' },
      { type: 'add_known_file' as const, path: 'src/db/pool.ts' },
      { type: 'add_known_file' as const, path: 'src/auth/jwt.ts' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const pack = buildContextPack(state, createEmptyMemory(), makeTask(), {
      scopeFilterKnownFiles: true,
      scopePaths: ['src/auth/'],
    });
    expect(pack.canonicalStateSummary).toContain('login.ts');
    expect(pack.canonicalStateSummary).toContain('jwt.ts');
    expect(pack.canonicalStateSummary).not.toContain('pool.ts');
  });

  it('scopeFilterDecisions filters by keyword overlap', () => {
    const ops = [
      { type: 'add_decision' as const, value: 'Use JWT for auth tokens' },
      { type: 'add_decision' as const, value: 'PostgreSQL for database storage' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const pack = buildContextPack(state, createEmptyMemory(), makeTask(), {
      scopeFilterDecisions: true,
      scopePaths: ['src/auth/'],
    });
    expect(pack.canonicalStateSummary).toContain('JWT');
    expect(pack.canonicalStateSummary).not.toContain('PostgreSQL');
  });

  it('scopeFilterRisks filters by keyword overlap', () => {
    const ops = [
      { type: 'add_risk' as const, value: 'Auth token leakage risk' },
      { type: 'add_risk' as const, value: 'Database migration failures' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const pack = buildContextPack(state, createEmptyMemory(), makeTask(), {
      scopeFilterRisks: true,
      scopePaths: ['src/auth/'],
    });
    expect(pack.canonicalStateSummary).toContain('token leakage');
    expect(pack.canonicalStateSummary).not.toContain('migration');
  });
});

describe('buildContextPack — relevance scoring', () => {
  it('memoryRelevanceThreshold filters entries by keyword match', () => {
    const entries = [
      makeEntry({ title: 'Auth middleware rules', content: 'JWT token handling' }),
      makeEntry({ title: 'Database conventions', content: 'Use connection pooling' }),
    ];
    const memory = makeMemory(entries);
    const pack = buildContextPack(createInitialState(), memory, makeTask('Implement auth flow'), {
      memoryRelevanceThreshold: 1,
      relevanceKeywords: ['auth', 'middleware'],
    });
    expect(pack.stablePrefix).toContain('Auth middleware');
    expect(pack.stablePrefix).not.toContain('Database');
  });

  it('null threshold skips relevance filtering', () => {
    const entries = [
      makeEntry({ title: 'Auth rules', content: 'token' }),
      makeEntry({ title: 'DB rules', content: 'pool' }),
    ];
    const memory = makeMemory(entries);
    const pack = buildContextPack(createInitialState(), memory, makeTask(), {
      memoryRelevanceThreshold: null,
      relevanceKeywords: ['auth'],
    });
    expect(pack.stablePrefix).toContain('Auth');
    expect(pack.stablePrefix).toContain('DB');
  });
});

describe('buildContextPack — manifest', () => {
  it('produces a contextManifest', () => {
    const ops = [
      { type: 'set_goal' as const, value: 'Build app' },
      { type: 'add_decision' as const, value: 'Use TS' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const pack = buildContextPack(state, createEmptyMemory(), makeTask());
    expect(pack.contextManifest).not.toBeNull();
    expect(pack.contextManifest!.surface).toBe('task_run');
    expect(pack.contextManifest!.estimatedTokens).toBe(pack.estimatedTokens);
  });

  it('manifest tracks memory exclusion reasons', () => {
    const entries = [
      makeEntry({ category: 'coding_standard', title: 'CS1' }),
      makeEntry({ category: 'test_convention', title: 'TC1' }),
    ];
    const memory = makeMemory(entries);
    const pack = buildContextPack(createInitialState(), memory, makeTask(), {
      excludeCategories: ['test_convention'],
    });
    expect(pack.contextManifest!.memoryIncluded).toBe(1);
    expect(pack.contextManifest!.memoryExcluded).toBe(1);
    expect(pack.contextManifest!.memoryExcludedReasons['category_exclude']).toBe(1);
  });

  it('manifest tracks scope filter counts', () => {
    const ops = [
      { type: 'add_known_file' as const, path: 'src/auth/a.ts' },
      { type: 'add_known_file' as const, path: 'src/db/b.ts' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const pack = buildContextPack(state, createEmptyMemory(), makeTask(), {
      scopeFilterKnownFiles: true,
      scopePaths: ['src/auth/'],
    });
    expect(pack.contextManifest!.scopeFilterApplied).toBe(true);
    expect(pack.contextManifest!.knownFilesBeforeFilter).toBe(2);
    expect(pack.contextManifest!.knownFilesAfterFilter).toBe(1);
  });

  it('manifest tracks included/excluded state fields', () => {
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), makeTask(), {
      includeDecisions: false,
      includeRisks: true,
    });
    expect(pack.contextManifest!.stateFieldsIncluded).toContain('risks');
    expect(pack.contextManifest!.stateFieldsExcluded).toContain('decisions');
  });
});

describe('buildStateSummary — phaseExitCriteria', () => {
  const DEFAULT_OPTS: ContextPackOptions = {
    includeRisks: true,
    includeDecisions: true,
    includeKnownFiles: true,
    includePhaseExitCriteria: false,
    maxMemoryEntries: null,
    includeCategories: null,
    excludeCategories: null,
    maxTokens: null,
    memoryRelevanceThreshold: null,
    relevanceKeywords: [],
    scopeFilterKnownFiles: false,
    scopePaths: [],
    scopeFilterDecisions: false,
    scopeFilterRisks: false,
  };

  it('includes phaseExitCriteria when option is true', () => {
    const ops = [
      { type: 'add_phase_exit_criterion' as const, value: 'All tests pass' },
      { type: 'add_phase_exit_criterion' as const, value: 'Code reviewed' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const summary = buildStateSummary(state, { ...DEFAULT_OPTS, includePhaseExitCriteria: true });
    expect(summary).toContain('Phase exit criteria');
    expect(summary).toContain('All tests pass');
    expect(summary).toContain('Code reviewed');
  });

  it('excludes phaseExitCriteria when option is false', () => {
    const ops = [
      { type: 'add_phase_exit_criterion' as const, value: 'All tests pass' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const summary = buildStateSummary(state, { ...DEFAULT_OPTS, includePhaseExitCriteria: false });
    expect(summary).not.toContain('Phase exit criteria');
    expect(summary).not.toContain('All tests pass');
  });
});

// ── MemCell-aware context pack tests ──

function makeExtractedCell(overrides: Partial<MemCell> = {}): MemCell {
  return {
    ...createMemCell(generateMemCellId(), 'test', 'task_completed', 'raw content', 100),
    extracted: true,
    episodicSummary: 'default episodic summary',
    events: ['default atomic event'],
    ...overrides,
  };
}

describe('buildContextPack — MemCell manifest fields', () => {
  it('sets memCellsAvailable to 0 when no MemCells provided', () => {
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), makeTask());
    expect(pack.contextManifest!.memCellsAvailable).toBe(0);
    expect(pack.contextManifest!.memCellsIncluded).toBe(0);
    expect(pack.contextManifest!.memCellRetrievalType).toBeNull();
    expect(pack.contextManifest!.memCellTopScore).toBeNull();
  });

  it('populates manifest MemCell fields when MemCells are provided', () => {
    const cells = [
      makeExtractedCell({
        episodicSummary: 'Explored auth middleware design patterns',
        events: ['Decided on JWT tokens for auth'],
      }),
      makeExtractedCell({
        episodicSummary: 'Set up database connection pooling',
        events: ['Configured pg pool with max 20 connections'],
      }),
    ];
    const task = makeTask('Implement auth middleware');
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), task, {
      preferredMemCellType: 'episodic',
      maxMemCellResults: 5,
    }, cells);
    expect(pack.contextManifest!.memCellsAvailable).toBe(2);
    expect(pack.contextManifest!.memCellsIncluded).toBeGreaterThan(0);
    expect(pack.contextManifest!.memCellRetrievalType).toBe('episodic');
    expect(pack.contextManifest!.memCellTopScore).toBeGreaterThan(0);
  });

  it('episodic type includes episodic summaries in stablePrefix', () => {
    const cells = [
      makeExtractedCell({
        episodicSummary: 'Explored auth middleware design patterns',
      }),
    ];
    const task = makeTask('Implement auth middleware');
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), task, {
      preferredMemCellType: 'episodic',
      maxMemCellResults: 5,
    }, cells);
    expect(pack.stablePrefix).toContain('[episodic]');
    expect(pack.stablePrefix).toContain('auth middleware design patterns');
  });

  it('event type includes atomic events in stablePrefix', () => {
    const cells = [
      makeExtractedCell({
        episodicSummary: 'General auth discussion',
        events: ['Decided on JWT tokens for auth', 'Auth middleware must validate tokens'],
      }),
    ];
    const task = makeTask('Implement auth middleware');
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), task, {
      preferredMemCellType: 'event',
      maxMemCellResults: 5,
    }, cells);
    expect(pack.stablePrefix).toContain('[event]');
    expect(pack.stablePrefix).toContain('JWT tokens');
  });

  it('null preferredMemCellType uses fused retrieval', () => {
    const cells = [
      makeExtractedCell({
        episodicSummary: 'Explored auth token validation approaches',
        events: ['JWT chosen over session tokens'],
      }),
    ];
    const task = makeTask('Implement auth token validation');
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), task, {
      preferredMemCellType: null,
      maxMemCellResults: 5,
    }, cells);
    // Fused mode returns episodic summaries
    expect(pack.stablePrefix).toContain('[episodic]');
    if (pack.contextManifest!.memCellsIncluded > 0) {
      expect(pack.contextManifest!.memCellRetrievalType).toBe('fused');
    }
  });

  it('respects maxMemCellResults limit', () => {
    const cells = Array.from({ length: 10 }, (_, i) => makeExtractedCell({
      episodicSummary: `Auth task ${i} explored middleware patterns`,
    }));
    const task = makeTask('Implement auth middleware');
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), task, {
      preferredMemCellType: 'episodic',
      maxMemCellResults: 2,
    }, cells);
    expect(pack.contextManifest!.memCellsIncluded).toBeLessThanOrEqual(2);
  });

  it('MemCell supplement text appears in stablePrefix alongside flat entries', () => {
    const cells = [
      makeExtractedCell({
        episodicSummary: 'Auth middleware design pattern exploration',
      }),
    ];
    const task = makeTask('Implement auth middleware');
    const pack = buildContextPack(
      createInitialState(),
      makeMemory([makeEntry({ title: 'Existing rule', content: 'existing' })]),
      task,
      { preferredMemCellType: 'episodic', maxMemCellResults: 5 },
      cells,
    );
    expect(pack.stablePrefix).toContain('Auth middleware design pattern');
    expect(pack.stablePrefix).toContain('Existing rule');
  });

  it('maxMemCellResults 0 skips MemCell retrieval', () => {
    const cells = [
      makeExtractedCell({
        episodicSummary: 'Should not appear in context',
      }),
    ];
    const task = makeTask('Implement auth');
    const pack = buildContextPack(createInitialState(), createEmptyMemory(), task, {
      maxMemCellResults: 0,
    }, cells);
    expect(pack.contextManifest!.memCellsAvailable).toBe(0);
    expect(pack.contextManifest!.memCellsIncluded).toBe(0);
    expect(pack.stablePrefix).not.toContain('Should not appear');
  });
});
