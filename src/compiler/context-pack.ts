import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { DurableMemory, MemoryEntry, MemCell, MemoryType } from '../domain/durable-memory.js';
import type { TaskNode } from '../domain/task.js';
import type { ContextPack, ContextPackOptions } from '../domain/task-spec.js';
import type { ContextManifest, TrimmedField } from '../domain/context-policy.js';
import {
  filterByScope,
  filterByScopeKeywords,
  scoreKeywordRelevance,
} from '../domain/context-policy.js';
import { retrieveMemCells } from '../runtime/memory-retrieval.js';

// Context pack compiler.
// Design principle: compile the smallest context that is still sufficient and reliable.
// This is a cost and quality optimization — each run starts fresh from a chosen
// canonical state snapshot, not from accumulated conversation history.
//
// Avoiding: replaying bloated chat history, stale transcript, dead-end explorations,
// repeated setup explanations, irrelevant prior turns.
//
// Structure:
// - stablePrefix: durable memory + project rules. Rarely changes. Isolated cleanly
//   so it can be identified and potentially reused across runs by the provider.
// - variable content: compiled fresh from the current canonical state version.
//
// Memory entries appear in stablePrefix ONLY (not in relevantMemoryEntries)
// to avoid duplication in the final prompt.
//
// Caution: do not truncate what is needed for reliable task execution.
// Bad truncation causes retries and rework, which increases total cost.

const DEFAULT_OPTIONS: ContextPackOptions = {
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
  preferredMemCellType: null,
  maxMemCellResults: 5,
};

export function buildContextPack(
  state: CanonicalProjectState,
  memory: DurableMemory,
  task: TaskNode,
  options: Partial<ContextPackOptions> = {},
  memCells?: MemCell[],
): ContextPack {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Track manifest data as we build
  const stateFieldsIncluded: string[] = [];
  const stateFieldsExcluded: string[] = [];
  const trimmedFields: TrimmedField[] = [];
  let memoryExcluded = 0;
  const memoryExcludedReasons: Record<string, number> = {};

  // Build memory entries with filtering and relevance scoring.
  // When MemCells are available and relevance keywords are set, use BM25/RRF retrieval
  // to supplement flat memory entries with episodic summaries from MemCells.
  const memoryResult = buildMemoryEntries(memory, opts, memCells, task.goal);
  const stablePrefix = buildStablePrefix(memoryResult.entries);
  memoryExcluded = memoryResult.excludedCount;
  Object.assign(memoryExcludedReasons, memoryResult.excludedReasons);

  // Apply scope filtering to state fields
  let decisions = state.decisions;
  let risks = state.risks;
  let knownFiles = state.knownFiles;
  const decisionsBeforeFilter = decisions.length;
  const risksBeforeFilter = risks.length;
  const knownFilesBeforeFilter = knownFiles.length;
  const scopeFilterApplied = opts.scopeFilterKnownFiles || opts.scopeFilterDecisions || opts.scopeFilterRisks;

  if (opts.scopeFilterKnownFiles && opts.scopePaths.length > 0) {
    knownFiles = filterByScope(knownFiles, opts.scopePaths);
  }
  if (opts.scopeFilterDecisions && opts.scopePaths.length > 0) {
    decisions = filterByScopeKeywords(decisions, opts.scopePaths);
  }
  if (opts.scopeFilterRisks && opts.scopePaths.length > 0) {
    risks = filterByScopeKeywords(risks, opts.scopePaths);
  }

  // Build state summary with filtered fields
  const stateSummary = buildStateSummary(state, opts, { decisions, risks, knownFiles });

  // Track included/excluded state fields
  if (state.goal) stateFieldsIncluded.push('goal');
  if (state.phase) stateFieldsIncluded.push('phase');
  if (state.phaseGoal) stateFieldsIncluded.push('phaseGoal');
  stateFieldsIncluded.push('constraints');
  if (opts.includeDecisions) stateFieldsIncluded.push('decisions');
  else stateFieldsExcluded.push('decisions');
  if (opts.includeRisks) stateFieldsIncluded.push('risks');
  else stateFieldsExcluded.push('risks');
  if (opts.includeKnownFiles) stateFieldsIncluded.push('knownFiles');
  else stateFieldsExcluded.push('knownFiles');
  if (opts.includePhaseExitCriteria) stateFieldsIncluded.push('phaseExitCriteria');
  else stateFieldsExcluded.push('phaseExitCriteria');
  if (state.nextStep) stateFieldsIncluded.push('nextStep');

  const scopeDesc = task.scope.readOnly
    ? `Read-only access to: ${task.scope.paths.join(', ') || 'entire project'}`
    : `Read/write access to: ${task.scope.paths.join(', ') || 'entire project'}`;

  let pack: ContextPack = {
    stablePrefix,
    canonicalStateSummary: stateSummary,
    relevantMemoryEntries: [], // Memory lives in stablePrefix — no duplication
    scopeDescription: scopeDesc,
    taskGoal: task.goal,
    constraints: state.constraints,
    estimatedTokens: 0,
    contextManifest: null,
  };
  pack.estimatedTokens = estimateTokens(pack);

  // Apply token budget if set
  if (opts.maxTokens !== null && pack.estimatedTokens > opts.maxTokens) {
    const trimResult = trimToBudget(pack, state, opts, opts.maxTokens, { decisions, risks, knownFiles });
    pack = trimResult.pack;
    trimmedFields.push(...trimResult.trimmedFields);
  }

  // Build manifest
  pack.contextManifest = {
    surface: 'task_run',
    estimatedTokens: pack.estimatedTokens,
    tokenBudget: opts.maxTokens,
    trimmedFields,
    memoryIncluded: memoryResult.entries.length,
    memoryExcluded,
    memoryExcludedReasons,
    stateFieldsIncluded,
    stateFieldsExcluded,
    scopeFilterApplied,
    knownFilesBeforeFilter,
    knownFilesAfterFilter: knownFiles.length,
    decisionsBeforeFilter,
    decisionsAfterFilter: decisions.length,
    risksBeforeFilter,
    risksAfterFilter: risks.length,
    memCellsAvailable: memoryResult.memCellsAvailable,
    memCellsIncluded: memoryResult.memCellsIncluded,
    memCellRetrievalType: memoryResult.memCellRetrievalType,
    memCellTopScore: memoryResult.memCellTopScore,
  };

  return pack;
}

function buildStablePrefix(memoryEntries: string[]): string {
  if (memoryEntries.length === 0) return '';
  return `## Project Rules and Standards\n\n${memoryEntries.join('\n\n')}`;
}

interface MemoryBuildResult {
  entries: string[];
  excludedCount: number;
  excludedReasons: Record<string, number>;
  memCellsAvailable: number;
  memCellsIncluded: number;
  memCellRetrievalType: MemoryType | 'fused' | null;
  memCellTopScore: number | null;
}

function buildMemoryEntries(
  memory: DurableMemory,
  opts: ContextPackOptions,
  memCells?: MemCell[],
  taskGoal?: string,
): MemoryBuildResult {
  let entries: MemoryEntry[] = memory.entries.filter(e => e.active);
  const totalActive = entries.length;
  const excludedReasons: Record<string, number> = {};

  // Category include filter
  if (opts.includeCategories !== null) {
    const before = entries.length;
    entries = entries.filter(e => opts.includeCategories!.includes(e.category));
    const dropped = before - entries.length;
    if (dropped > 0) excludedReasons['category_include'] = dropped;
  }

  // Category exclude filter
  if (opts.excludeCategories !== null) {
    const before = entries.length;
    entries = entries.filter(e => !opts.excludeCategories!.includes(e.category));
    const dropped = before - entries.length;
    if (dropped > 0) excludedReasons['category_exclude'] = dropped;
  }

  // Relevance scoring filter
  if (opts.memoryRelevanceThreshold !== null && opts.relevanceKeywords.length > 0) {
    const before = entries.length;
    entries = entries.filter(e => {
      const text = `${e.title} ${e.content}`;
      return scoreKeywordRelevance(text, opts.relevanceKeywords) >= opts.memoryRelevanceThreshold!;
    });
    const dropped = before - entries.length;
    if (dropped > 0) excludedReasons['relevance_threshold'] = dropped;
  }

  // Count limit (insertion order)
  if (opts.maxMemoryEntries !== null && entries.length > opts.maxMemoryEntries) {
    const dropped = entries.length - opts.maxMemoryEntries;
    entries = entries.slice(0, opts.maxMemoryEntries);
    if (dropped > 0) excludedReasons['max_entries'] = dropped;
  }

  const formatted = entries.map(e => `[${e.category}] ${e.title}: ${e.content}`);

  // MemCell retrieval diagnostics
  let memCellsAvailable = 0;
  let memCellsIncluded = 0;
  let memCellRetrievalType: MemoryType | 'fused' | null = null;
  let memCellTopScore: number | null = null;

  // Supplement with MemCell content via BM25/RRF when available.
  // Uses profile-driven type preferences and max results.
  const maxResults = opts.maxMemCellResults;
  if (memCells && memCells.length > 0 && taskGoal && maxResults > 0) {
    const extractedCount = memCells.filter(c => c.extracted).length;
    memCellsAvailable = extractedCount;

    const preferredType = opts.preferredMemCellType;
    const results = retrieveMemCells(memCells, taskGoal, {
      topK: maxResults,
      memoryType: preferredType ?? undefined,
      recencyBoostDays: 7,
    });

    if (results.length > 0) {
      memCellTopScore = results[0].score;
    }

    for (const { cell } of results) {
      if (preferredType === 'event') {
        // Event mode: include atomic facts
        if (cell.events.length > 0) {
          for (const event of cell.events) {
            formatted.push(`[event] ${event}`);
          }
          memCellsIncluded++;
        }
      } else {
        // Episodic or fused mode: include episodic summaries
        if (cell.episodicSummary) {
          formatted.push(`[episodic] ${cell.episodicSummary}`);
          memCellsIncluded++;
        }
      }
    }

    if (memCellsIncluded > 0) {
      memCellRetrievalType = preferredType ?? 'fused';
    }
  }

  const excludedCount = totalActive - entries.length;
  return {
    entries: formatted,
    excludedCount,
    excludedReasons,
    memCellsAvailable,
    memCellsIncluded,
    memCellRetrievalType,
    memCellTopScore,
  };
}

interface FilteredFields {
  decisions: string[];
  risks: string[];
  knownFiles: string[];
}

export function buildStateSummary(
  state: CanonicalProjectState,
  opts: ContextPackOptions,
  filtered?: FilteredFields,
): string {
  const decisions = filtered?.decisions ?? state.decisions;
  const risks = filtered?.risks ?? state.risks;
  const knownFiles = filtered?.knownFiles ?? state.knownFiles;

  const parts: string[] = [];
  if (state.goal) parts.push(`Goal: ${state.goal}`);
  if (state.phase) parts.push(`Phase: ${state.phase}`);
  if (state.phaseGoal) parts.push(`Phase goal: ${state.phaseGoal}`);
  if (state.constraints.length) {
    parts.push(`Constraints:\n${state.constraints.map(c => `  - ${c}`).join('\n')}`);
  }
  if (opts.includeDecisions && decisions.length) {
    parts.push(`Decisions:\n${decisions.map(d => `  - ${d}`).join('\n')}`);
  }
  if (opts.includeRisks && risks.length) {
    parts.push(`Risks:\n${risks.map(r => `  - ${r}`).join('\n')}`);
  }
  if (opts.includeKnownFiles && knownFiles.length) {
    parts.push(`Known files: ${knownFiles.join(', ')}`);
  }
  if (opts.includePhaseExitCriteria && state.phaseExitCriteria.length) {
    parts.push(`Phase exit criteria:\n${state.phaseExitCriteria.map(c => `  - ${c}`).join('\n')}`);
  }
  if (state.nextStep) parts.push(`Next step: ${state.nextStep}`);
  parts.push(`State version: ${state.version}`);
  return parts.join('\n\n');
}

interface TrimResult {
  pack: ContextPack;
  trimmedFields: TrimmedField[];
}

// Priority-based trimming. Removes lowest-priority content first.
// Deterministic: same inputs → same output. At most 5 iterations.
// Never trims: taskGoal, scopeDescription, constraints (safety-critical).
function trimToBudget(
  pack: ContextPack,
  state: CanonicalProjectState,
  opts: ContextPackOptions,
  maxTokens: number,
  filtered: FilteredFields,
): TrimResult {
  let current = { ...pack };
  const trimmedFields: TrimmedField[] = [];
  const trimOpts: ContextPackOptions = {
    ...opts,
    includeKnownFiles: opts.includeKnownFiles,
    includeRisks: opts.includeRisks,
    includeDecisions: opts.includeDecisions,
    includePhaseExitCriteria: opts.includePhaseExitCriteria,
  };

  // Step 1: drop knownFiles (often large, least critical)
  if (current.estimatedTokens > maxTokens && trimOpts.includeKnownFiles) {
    trimOpts.includeKnownFiles = false;
    current.canonicalStateSummary = buildStateSummary(state, trimOpts, filtered);
    current.estimatedTokens = estimateTokens(current);
    trimmedFields.push({
      field: 'knownFiles',
      reason: 'budget',
      originalCount: filtered.knownFiles.length,
      retainedCount: 0,
    });
  }

  // Step 2: drop phaseExitCriteria
  if (current.estimatedTokens > maxTokens && trimOpts.includePhaseExitCriteria) {
    trimOpts.includePhaseExitCriteria = false;
    current.canonicalStateSummary = buildStateSummary(state, trimOpts, filtered);
    current.estimatedTokens = estimateTokens(current);
    trimmedFields.push({
      field: 'phaseExitCriteria',
      reason: 'budget',
      originalCount: state.phaseExitCriteria.length,
      retainedCount: 0,
    });
  }

  // Step 3: drop risks
  if (current.estimatedTokens > maxTokens && trimOpts.includeRisks) {
    trimOpts.includeRisks = false;
    current.canonicalStateSummary = buildStateSummary(state, trimOpts, filtered);
    current.estimatedTokens = estimateTokens(current);
    trimmedFields.push({
      field: 'risks',
      reason: 'budget',
      originalCount: filtered.risks.length,
      retainedCount: 0,
    });
  }

  // Step 4: drop decisions
  if (current.estimatedTokens > maxTokens && trimOpts.includeDecisions) {
    trimOpts.includeDecisions = false;
    current.canonicalStateSummary = buildStateSummary(state, trimOpts, filtered);
    current.estimatedTokens = estimateTokens(current);
    trimmedFields.push({
      field: 'decisions',
      reason: 'budget',
      originalCount: filtered.decisions.length,
      retainedCount: 0,
    });
  }

  // Step 5: drop memory (stablePrefix) — last resort before irreducible core
  if (current.estimatedTokens > maxTokens) {
    current.stablePrefix = '';
    current.estimatedTokens = estimateTokens(current);
    trimmedFields.push({ field: 'memory', reason: 'budget' });
  }

  return { pack: current, trimmedFields };
}

// Rough token estimate: ~4 characters per token (industry approximation).
// Not billing-accurate. Used for sizing awareness and future cost tracking.
// Track this per-run so we can surface cost visibility without requiring exact counts.
export function estimateTokens(
  pack: Omit<ContextPack, 'estimatedTokens' | 'contextManifest'>,
): number {
  const totalChars =
    pack.stablePrefix.length +
    pack.canonicalStateSummary.length +
    pack.relevantMemoryEntries.join('').length +
    pack.scopeDescription.length +
    pack.taskGoal.length +
    pack.constraints.join('').length;
  return Math.ceil(totalChars / 4);
}
