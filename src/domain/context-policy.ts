// Context slicing policies and pure scoring/filtering functions.
// Pure domain — no VS Code or Node imports.

import type { TaskType } from './task.js';
import type { MemoryCategory, MemoryType } from './durable-memory.js';

// ── Surface types ──

export type ContextSurface = 'task_run' | 'chat_steering' | 'chat_kickoff' | 'scratchpad';

// ── State slice policy ──

export interface StateSlicePolicy {
  includeDecisions: boolean;
  includeRisks: boolean;
  includeKnownFiles: boolean;
  includePhaseExitCriteria: boolean;
  scopeFilterKnownFiles: boolean;
  scopeFilterDecisions: boolean;
  scopeFilterRisks: boolean;
}

// ── Memory slice policy ──

export interface MemorySlicePolicy {
  includeCategories: MemoryCategory[] | null;
  excludeCategories: MemoryCategory[] | null;
  maxEntries: number | null;
  relevanceThreshold: number | null;
  relevanceKeywords: string[];

  // Preferred MemCell memory type for this surface.
  // 'episodic' = compact narrative summaries (good for broad context)
  // 'event' = atomic facts (good for precision queries)
  // null = fuse both via RRF (default)
  preferredMemoryType: MemoryType | null;

  // Maximum MemCell results to include alongside flat entries.
  maxMemCellResults: number;
}

// ── Token budget ──

export interface TokenBudget {
  maxSystemPromptTokens: number | null;
  maxMemoryTokens: number | null;
  maxConversationTokens: number | null;
}

// ── Context profile ──

export interface ContextProfile {
  surface: ContextSurface;
  stateSlice: StateSlicePolicy;
  memorySlice: MemorySlicePolicy;
  tokenBudget: TokenBudget;
}

// ── Context manifest ──

export interface TrimmedField {
  field: string;
  reason: 'budget' | 'policy' | 'scope_filter';
  originalCount?: number;
  retainedCount?: number;
}

export interface ContextManifest {
  surface: ContextSurface;
  estimatedTokens: number;
  tokenBudget: number | null;
  trimmedFields: TrimmedField[];
  memoryIncluded: number;
  memoryExcluded: number;
  memoryExcludedReasons: Record<string, number>;
  stateFieldsIncluded: string[];
  stateFieldsExcluded: string[];
  scopeFilterApplied: boolean;
  knownFilesBeforeFilter: number;
  knownFilesAfterFilter: number;
  decisionsBeforeFilter: number;
  decisionsAfterFilter: number;
  risksBeforeFilter: number;
  risksAfterFilter: number;

  // MemCell retrieval diagnostics
  memCellsAvailable: number;
  memCellsIncluded: number;
  memCellRetrievalType: MemoryType | 'fused' | null;
  memCellTopScore: number | null;
}

// ── Stopwords for relevance scoring ──

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'but', 'not', 'no', 'nor',
  'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from', 'as',
  'it', 'its', 'this', 'that', 'these', 'those',
  'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'should', 'can', 'could',
  'all', 'each', 'every', 'any', 'some', 'we', 'our', 'us',
  'if', 'then', 'when', 'while', 'so', 'also',
  'use', 'using', 'used',
  'src', 'test', 'index', 'ts', 'js', 'json',
]);

// ── Pure scoring functions ──

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_/-]/g, ' ')
    .split(/[\s/]+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

export function scoreKeywordRelevance(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const textTokens = new Set(tokenize(text));
  let score = 0;
  for (const kw of keywords) {
    if (textTokens.has(kw)) score++;
  }
  return score;
}

// Filter knownFiles by scope path prefix match.
export function filterByScope(items: string[], scopePaths: string[]): string[] {
  if (scopePaths.length === 0) return items;
  return items.filter(item =>
    scopePaths.some(scope => item.startsWith(scope) || scope.startsWith(item)),
  );
}

// Filter string items (decisions/risks) by keyword overlap with scope paths.
// Returns items that have at least one keyword overlap.
export function filterByScopeKeywords(items: string[], scopePaths: string[]): string[] {
  if (scopePaths.length === 0) return items;
  const keywords = scopePaths.flatMap(p => tokenize(p));
  if (keywords.length === 0) return items;
  return items.filter(item => scoreKeywordRelevance(item, keywords) > 0);
}

// Extract relevance keywords from task goal + scope paths.
export function extractRelevanceKeywords(taskGoal: string, scopePaths: string[]): string[] {
  const goalTokens = tokenize(taskGoal);
  const scopeTokens = scopePaths.flatMap(p => tokenize(p));
  return [...new Set([...goalTokens, ...scopeTokens])];
}

// ── Profile resolver ──

export function resolveContextProfile(
  surface: ContextSurface,
  taskType?: TaskType,
  scopePaths?: string[],
): ContextProfile {
  const hasScopePaths = (scopePaths?.length ?? 0) > 0;

  switch (surface) {
    case 'task_run': {
      if (taskType === 'discovery') {
        return {
          surface,
          stateSlice: {
            includeDecisions: false,
            includeRisks: false,
            includeKnownFiles: true,
            includePhaseExitCriteria: false,
            scopeFilterKnownFiles: hasScopePaths,
            scopeFilterDecisions: false,
            scopeFilterRisks: false,
          },
          memorySlice: {
            includeCategories: null,
            excludeCategories: ['test_convention'],
            maxEntries: null,
            relevanceThreshold: 1,
            relevanceKeywords: [],
            preferredMemoryType: 'episodic',
            maxMemCellResults: 3,
          },
          tokenBudget: { maxSystemPromptTokens: 8_000, maxMemoryTokens: null, maxConversationTokens: null },
        };
      }
      if (taskType === 'validation') {
        return {
          surface,
          stateSlice: {
            includeDecisions: true,
            includeRisks: false,
            includeKnownFiles: true,
            includePhaseExitCriteria: true,
            scopeFilterKnownFiles: hasScopePaths,
            scopeFilterDecisions: false,
            scopeFilterRisks: false,
          },
          memorySlice: {
            includeCategories: null,
            excludeCategories: ['domain_glossary'],
            maxEntries: null,
            relevanceThreshold: 1,
            relevanceKeywords: [],
            preferredMemoryType: 'event',
            maxMemCellResults: 5,
          },
          tokenBudget: { maxSystemPromptTokens: 12_000, maxMemoryTokens: null, maxConversationTokens: null },
        };
      }
      // implementation (default)
      return {
        surface,
        stateSlice: {
          includeDecisions: true,
          includeRisks: true,
          includeKnownFiles: true,
          includePhaseExitCriteria: false,
          scopeFilterKnownFiles: hasScopePaths,
          scopeFilterDecisions: hasScopePaths,
          scopeFilterRisks: hasScopePaths,
        },
        memorySlice: {
          includeCategories: null,
          excludeCategories: null,
          maxEntries: null,
          relevanceThreshold: 1,
          relevanceKeywords: [],
          preferredMemoryType: null,
          maxMemCellResults: 5,
        },
        tokenBudget: { maxSystemPromptTokens: 16_000, maxMemoryTokens: null, maxConversationTokens: null },
      };
    }
    case 'chat_steering':
      return {
        surface,
        stateSlice: {
          includeDecisions: true,
          includeRisks: true,
          includeKnownFiles: true,
          includePhaseExitCriteria: true,
          scopeFilterKnownFiles: false,
          scopeFilterDecisions: false,
          scopeFilterRisks: false,
        },
        memorySlice: {
          includeCategories: null,
          excludeCategories: null,
          maxEntries: 20,
          relevanceThreshold: null,
          relevanceKeywords: [],
          preferredMemoryType: 'episodic',
          maxMemCellResults: 3,
        },
        tokenBudget: { maxSystemPromptTokens: 6_000, maxMemoryTokens: null, maxConversationTokens: 12_000 },
      };
    case 'chat_kickoff':
      return {
        surface,
        stateSlice: {
          includeDecisions: false,
          includeRisks: false,
          includeKnownFiles: false,
          includePhaseExitCriteria: false,
          scopeFilterKnownFiles: false,
          scopeFilterDecisions: false,
          scopeFilterRisks: false,
        },
        memorySlice: {
          includeCategories: null,
          excludeCategories: null,
          maxEntries: null,
          relevanceThreshold: null,
          relevanceKeywords: [],
          preferredMemoryType: null,
          maxMemCellResults: 0,
        },
        tokenBudget: { maxSystemPromptTokens: 2_000, maxMemoryTokens: null, maxConversationTokens: 12_000 },
      };
    case 'scratchpad':
      return {
        surface,
        stateSlice: {
          includeDecisions: false,
          includeRisks: false,
          includeKnownFiles: false,
          includePhaseExitCriteria: false,
          scopeFilterKnownFiles: false,
          scopeFilterDecisions: false,
          scopeFilterRisks: false,
        },
        memorySlice: {
          includeCategories: null,
          excludeCategories: null,
          maxEntries: 15,
          relevanceThreshold: null,
          relevanceKeywords: [],
          preferredMemoryType: 'episodic',
          maxMemCellResults: 3,
        },
        tokenBudget: { maxSystemPromptTokens: 4_000, maxMemoryTokens: null, maxConversationTokens: null },
      };
  }
}

// ── Context diagnostics ──

export function buildContextDiagnostics(manifest: ContextManifest): string {
  const lines: string[] = [];
  lines.push(`Context diagnostics:`);
  lines.push(`  Surface: ${manifest.surface}`);
  lines.push(`  Estimated tokens: ${manifest.estimatedTokens}${manifest.tokenBudget ? ` / ${manifest.tokenBudget} budget` : ''}`);

  if (manifest.stateFieldsIncluded.length > 0) {
    lines.push(`  State fields included: ${manifest.stateFieldsIncluded.join(', ')}`);
  }
  if (manifest.stateFieldsExcluded.length > 0) {
    lines.push(`  State fields excluded: ${manifest.stateFieldsExcluded.join(', ')}`);
  }

  if (manifest.scopeFilterApplied) {
    if (manifest.knownFilesBeforeFilter !== manifest.knownFilesAfterFilter) {
      lines.push(`  Known files: ${manifest.knownFilesAfterFilter}/${manifest.knownFilesBeforeFilter} after scope filter`);
    }
    if (manifest.decisionsBeforeFilter !== manifest.decisionsAfterFilter) {
      lines.push(`  Decisions: ${manifest.decisionsAfterFilter}/${manifest.decisionsBeforeFilter} after scope filter`);
    }
    if (manifest.risksBeforeFilter !== manifest.risksAfterFilter) {
      lines.push(`  Risks: ${manifest.risksAfterFilter}/${manifest.risksBeforeFilter} after scope filter`);
    }
  }

  lines.push(`  Memory: ${manifest.memoryIncluded} included, ${manifest.memoryExcluded} excluded`);
  const reasons = Object.entries(manifest.memoryExcludedReasons);
  if (reasons.length > 0) {
    reasons.forEach(([reason, count]) => {
      lines.push(`    ${count} by ${reason.replace(/_/g, ' ')}`);
    });
  }

  if (manifest.memCellsAvailable > 0) {
    lines.push(`  MemCells: ${manifest.memCellsIncluded}/${manifest.memCellsAvailable} included`);
    if (manifest.memCellRetrievalType) {
      lines.push(`    Retrieval: ${manifest.memCellRetrievalType}`);
    }
    if (manifest.memCellTopScore !== null) {
      lines.push(`    Top score: ${manifest.memCellTopScore.toFixed(3)}`);
    }
  }

  if (manifest.trimmedFields.length > 0) {
    lines.push(`  Trimming applied:`);
    manifest.trimmedFields.forEach(t => {
      let detail = `    ${t.field}: ${t.reason}`;
      if (t.originalCount !== undefined && t.retainedCount !== undefined) {
        detail += ` (${t.retainedCount}/${t.originalCount} retained)`;
      }
      lines.push(detail);
    });
  }

  return lines.join('\n');
}
