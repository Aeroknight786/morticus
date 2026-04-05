import { describe, it, expect } from 'vitest';
import {
  tokenize,
  scoreKeywordRelevance,
  filterByScope,
  filterByScopeKeywords,
  extractRelevanceKeywords,
  resolveContextProfile,
  buildContextDiagnostics,
} from '../../../src/domain/context-policy.js';
import type { ContextManifest } from '../../../src/domain/context-policy.js';

describe('tokenize', () => {
  it('lowercases and splits on whitespace/slashes', () => {
    expect(tokenize('Foo Bar/Baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('removes stopwords and short tokens', () => {
    expect(tokenize('the src is a test of it')).toEqual([]);
  });

  it('keeps meaningful tokens', () => {
    expect(tokenize('auth middleware setup')).toEqual(['auth', 'middleware', 'setup']);
  });

  it('handles paths', () => {
    expect(tokenize('src/domain/chat.ts')).toEqual(['domain', 'chat']);
  });
});

describe('scoreKeywordRelevance', () => {
  it('returns 0 for empty keywords', () => {
    expect(scoreKeywordRelevance('some text', [])).toBe(0);
  });

  it('counts matching keywords', () => {
    expect(scoreKeywordRelevance('auth middleware handler', ['auth', 'handler'])).toBe(2);
  });

  it('returns 0 when no keywords match', () => {
    expect(scoreKeywordRelevance('database setup', ['auth', 'handler'])).toBe(0);
  });
});

describe('filterByScope', () => {
  it('returns all items when no scope paths', () => {
    const items = ['src/a.ts', 'src/b.ts'];
    expect(filterByScope(items, [])).toEqual(items);
  });

  it('filters items by path prefix', () => {
    const items = ['src/auth/login.ts', 'src/db/pool.ts', 'src/auth/jwt.ts'];
    expect(filterByScope(items, ['src/auth/'])).toEqual(['src/auth/login.ts', 'src/auth/jwt.ts']);
  });

  it('includes items that are prefixes of scope paths', () => {
    const items = ['src/', 'lib/'];
    expect(filterByScope(items, ['src/auth/'])).toEqual(['src/']);
  });
});

describe('filterByScopeKeywords', () => {
  it('returns all items when no scope paths', () => {
    const items = ['Use JWT for auth', 'Database is Postgres'];
    expect(filterByScopeKeywords(items, [])).toEqual(items);
  });

  it('filters by keyword overlap', () => {
    const items = ['Use JWT for auth', 'Database pool size 10', 'Auth token expiry'];
    expect(filterByScopeKeywords(items, ['src/auth/'])).toEqual([
      'Use JWT for auth',
      'Auth token expiry',
    ]);
  });
});

describe('extractRelevanceKeywords', () => {
  it('combines goal and scope tokens', () => {
    const keywords = extractRelevanceKeywords('Implement auth flow', ['src/auth/']);
    expect(keywords).toContain('implement');
    expect(keywords).toContain('auth');
    expect(keywords).toContain('flow');
  });

  it('deduplicates tokens', () => {
    const keywords = extractRelevanceKeywords('auth handler', ['src/auth/']);
    const authCount = keywords.filter(k => k === 'auth').length;
    expect(authCount).toBe(1);
  });
});

describe('resolveContextProfile', () => {
  it('returns discovery profile for task_run + discovery', () => {
    const profile = resolveContextProfile('task_run', 'discovery', ['src/']);
    expect(profile.surface).toBe('task_run');
    expect(profile.stateSlice.includeDecisions).toBe(false);
    expect(profile.stateSlice.includeRisks).toBe(false);
    expect(profile.stateSlice.includeKnownFiles).toBe(true);
    expect(profile.memorySlice.excludeCategories).toEqual(['test_convention']);
    expect(profile.tokenBudget.maxSystemPromptTokens).toBe(8_000);
  });

  it('returns validation profile for task_run + validation', () => {
    const profile = resolveContextProfile('task_run', 'validation');
    expect(profile.stateSlice.includeDecisions).toBe(true);
    expect(profile.stateSlice.includePhaseExitCriteria).toBe(true);
    expect(profile.memorySlice.excludeCategories).toEqual(['domain_glossary']);
    expect(profile.tokenBudget.maxSystemPromptTokens).toBe(12_000);
  });

  it('returns implementation profile for task_run + implementation', () => {
    const profile = resolveContextProfile('task_run', 'implementation', ['src/auth/']);
    expect(profile.stateSlice.includeDecisions).toBe(true);
    expect(profile.stateSlice.includeRisks).toBe(true);
    expect(profile.stateSlice.scopeFilterKnownFiles).toBe(true);
    expect(profile.stateSlice.scopeFilterDecisions).toBe(true);
    expect(profile.tokenBudget.maxSystemPromptTokens).toBe(16_000);
  });

  it('disables scope filters when no scope paths provided', () => {
    const profile = resolveContextProfile('task_run', 'implementation');
    expect(profile.stateSlice.scopeFilterKnownFiles).toBe(false);
    expect(profile.stateSlice.scopeFilterDecisions).toBe(false);
    expect(profile.stateSlice.scopeFilterRisks).toBe(false);
  });

  it('returns chat_steering profile', () => {
    const profile = resolveContextProfile('chat_steering');
    expect(profile.stateSlice.includeDecisions).toBe(true);
    expect(profile.stateSlice.includePhaseExitCriteria).toBe(true);
    expect(profile.memorySlice.maxEntries).toBe(20);
    expect(profile.tokenBudget.maxConversationTokens).toBe(12_000);
  });

  it('returns chat_kickoff profile with minimal state', () => {
    const profile = resolveContextProfile('chat_kickoff');
    expect(profile.stateSlice.includeDecisions).toBe(false);
    expect(profile.stateSlice.includeKnownFiles).toBe(false);
    expect(profile.tokenBudget.maxSystemPromptTokens).toBe(2_000);
  });

  it('returns scratchpad profile', () => {
    const profile = resolveContextProfile('scratchpad');
    expect(profile.memorySlice.maxEntries).toBe(15);
    expect(profile.tokenBudget.maxSystemPromptTokens).toBe(4_000);
  });

  it('discovery profile prefers episodic MemCells with max 3', () => {
    const profile = resolveContextProfile('task_run', 'discovery');
    expect(profile.memorySlice.preferredMemoryType).toBe('episodic');
    expect(profile.memorySlice.maxMemCellResults).toBe(3);
  });

  it('validation profile prefers event MemCells with max 5', () => {
    const profile = resolveContextProfile('task_run', 'validation');
    expect(profile.memorySlice.preferredMemoryType).toBe('event');
    expect(profile.memorySlice.maxMemCellResults).toBe(5);
  });

  it('implementation profile uses fused MemCells (null) with max 5', () => {
    const profile = resolveContextProfile('task_run', 'implementation');
    expect(profile.memorySlice.preferredMemoryType).toBeNull();
    expect(profile.memorySlice.maxMemCellResults).toBe(5);
  });

  it('chat_steering profile prefers episodic MemCells with max 3', () => {
    const profile = resolveContextProfile('chat_steering');
    expect(profile.memorySlice.preferredMemoryType).toBe('episodic');
    expect(profile.memorySlice.maxMemCellResults).toBe(3);
  });

  it('chat_kickoff profile has 0 maxMemCellResults', () => {
    const profile = resolveContextProfile('chat_kickoff');
    expect(profile.memorySlice.preferredMemoryType).toBeNull();
    expect(profile.memorySlice.maxMemCellResults).toBe(0);
  });

  it('scratchpad profile prefers episodic MemCells with max 3', () => {
    const profile = resolveContextProfile('scratchpad');
    expect(profile.memorySlice.preferredMemoryType).toBe('episodic');
    expect(profile.memorySlice.maxMemCellResults).toBe(3);
  });
});

describe('buildContextDiagnostics', () => {
  it('renders manifest as readable text', () => {
    const manifest: ContextManifest = {
      surface: 'task_run',
      estimatedTokens: 5000,
      tokenBudget: 16000,
      trimmedFields: [],
      memoryIncluded: 8,
      memoryExcluded: 2,
      memoryExcludedReasons: { category_exclude: 2 },
      stateFieldsIncluded: ['goal', 'phase', 'decisions'],
      stateFieldsExcluded: ['risks'],
      scopeFilterApplied: true,
      knownFilesBeforeFilter: 20,
      knownFilesAfterFilter: 5,
      decisionsBeforeFilter: 10,
      decisionsAfterFilter: 10,
      risksBeforeFilter: 3,
      risksAfterFilter: 3,
      memCellsAvailable: 0,
      memCellsIncluded: 0,
      memCellRetrievalType: null,
      memCellTopScore: null,
    };
    const text = buildContextDiagnostics(manifest);
    expect(text).toContain('Surface: task_run');
    expect(text).toContain('5000');
    expect(text).toContain('16000');
    expect(text).toContain('Memory: 8 included, 2 excluded');
    expect(text).toContain('2 by category exclude');
    expect(text).toContain('Known files: 5/20');
  });

  it('includes trimmed fields when present', () => {
    const manifest: ContextManifest = {
      surface: 'task_run',
      estimatedTokens: 20000,
      tokenBudget: 16000,
      trimmedFields: [
        { field: 'knownFiles', reason: 'budget', originalCount: 50, retainedCount: 0 },
      ],
      memoryIncluded: 5,
      memoryExcluded: 0,
      memoryExcludedReasons: {},
      stateFieldsIncluded: ['goal'],
      stateFieldsExcluded: [],
      scopeFilterApplied: false,
      knownFilesBeforeFilter: 50,
      knownFilesAfterFilter: 50,
      decisionsBeforeFilter: 0,
      decisionsAfterFilter: 0,
      risksBeforeFilter: 0,
      risksAfterFilter: 0,
      memCellsAvailable: 0,
      memCellsIncluded: 0,
      memCellRetrievalType: null,
      memCellTopScore: null,
    };
    const text = buildContextDiagnostics(manifest);
    expect(text).toContain('Trimming applied');
    expect(text).toContain('knownFiles: budget');
    expect(text).toContain('0/50 retained');
  });

  it('includes MemCell lines when memCellsAvailable > 0', () => {
    const manifest: ContextManifest = {
      surface: 'task_run',
      estimatedTokens: 5000,
      tokenBudget: 16000,
      trimmedFields: [],
      memoryIncluded: 3,
      memoryExcluded: 0,
      memoryExcludedReasons: {},
      stateFieldsIncluded: ['goal'],
      stateFieldsExcluded: [],
      scopeFilterApplied: false,
      knownFilesBeforeFilter: 0,
      knownFilesAfterFilter: 0,
      decisionsBeforeFilter: 0,
      decisionsAfterFilter: 0,
      risksBeforeFilter: 0,
      risksAfterFilter: 0,
      memCellsAvailable: 10,
      memCellsIncluded: 3,
      memCellRetrievalType: 'episodic',
      memCellTopScore: 2.456,
    };
    const text = buildContextDiagnostics(manifest);
    expect(text).toContain('MemCells: 3/10 included');
    expect(text).toContain('Retrieval: episodic');
    expect(text).toContain('Top score: 2.456');
  });

  it('omits MemCell lines when memCellsAvailable is 0', () => {
    const manifest: ContextManifest = {
      surface: 'task_run',
      estimatedTokens: 5000,
      tokenBudget: null,
      trimmedFields: [],
      memoryIncluded: 3,
      memoryExcluded: 0,
      memoryExcludedReasons: {},
      stateFieldsIncluded: ['goal'],
      stateFieldsExcluded: [],
      scopeFilterApplied: false,
      knownFilesBeforeFilter: 0,
      knownFilesAfterFilter: 0,
      decisionsBeforeFilter: 0,
      decisionsAfterFilter: 0,
      risksBeforeFilter: 0,
      risksAfterFilter: 0,
      memCellsAvailable: 0,
      memCellsIncluded: 0,
      memCellRetrievalType: null,
      memCellTopScore: null,
    };
    const text = buildContextDiagnostics(manifest);
    expect(text).not.toContain('MemCells');
  });

  it('shows fused retrieval type', () => {
    const manifest: ContextManifest = {
      surface: 'task_run',
      estimatedTokens: 5000,
      tokenBudget: null,
      trimmedFields: [],
      memoryIncluded: 3,
      memoryExcluded: 0,
      memoryExcludedReasons: {},
      stateFieldsIncluded: ['goal'],
      stateFieldsExcluded: [],
      scopeFilterApplied: false,
      knownFilesBeforeFilter: 0,
      knownFilesAfterFilter: 0,
      decisionsBeforeFilter: 0,
      decisionsAfterFilter: 0,
      risksBeforeFilter: 0,
      risksAfterFilter: 0,
      memCellsAvailable: 5,
      memCellsIncluded: 2,
      memCellRetrievalType: 'fused',
      memCellTopScore: 1.234,
    };
    const text = buildContextDiagnostics(manifest);
    expect(text).toContain('Retrieval: fused');
  });
});
