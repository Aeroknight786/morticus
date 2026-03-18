import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { DurableMemory, MemoryEntry } from '../domain/durable-memory.js';
import type { TaskNode } from '../domain/task.js';
import type { ContextPack, ContextPackOptions } from '../domain/task-spec.js';

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
  maxMemoryEntries: null,
  includeCategories: null,
  excludeCategories: null,
  maxTokens: null,
};

export function buildContextPack(
  state: CanonicalProjectState,
  memory: DurableMemory,
  task: TaskNode,
  options: Partial<ContextPackOptions> = {},
): ContextPack {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Build memory entries ONCE — they go into stablePrefix only.
  const memoryEntries = buildMemoryEntries(memory, opts);
  const stablePrefix = buildStablePrefix(memoryEntries);

  // Variable per-run content: compiled from the current state snapshot.
  const stateSummary = buildStateSummary(state, opts);

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
  };
  pack.estimatedTokens = estimateTokens(pack);

  // Apply token budget if set
  if (opts.maxTokens !== null && pack.estimatedTokens > opts.maxTokens) {
    pack = trimToBudget(pack, state, opts.maxTokens);
  }

  return pack;
}

function buildStablePrefix(memoryEntries: string[]): string {
  if (memoryEntries.length === 0) return '';
  return `## Project Rules and Standards\n\n${memoryEntries.join('\n\n')}`;
}

function buildMemoryEntries(memory: DurableMemory, opts: ContextPackOptions): string[] {
  let entries: MemoryEntry[] = memory.entries.filter(e => e.active);

  // Category include filter
  if (opts.includeCategories !== null) {
    entries = entries.filter(e => opts.includeCategories!.includes(e.category));
  }

  // Category exclude filter
  if (opts.excludeCategories !== null) {
    entries = entries.filter(e => !opts.excludeCategories!.includes(e.category));
  }

  // Count limit (insertion order)
  if (opts.maxMemoryEntries !== null) {
    entries = entries.slice(0, opts.maxMemoryEntries);
  }

  return entries.map(e => `[${e.category}] ${e.title}: ${e.content}`);
}

function buildStateSummary(state: CanonicalProjectState, opts: ContextPackOptions): string {
  const parts: string[] = [];
  if (state.goal) parts.push(`Goal: ${state.goal}`);
  if (state.phase) parts.push(`Phase: ${state.phase}`);
  if (state.phaseGoal) parts.push(`Phase goal: ${state.phaseGoal}`);
  if (state.constraints.length) {
    parts.push(`Constraints:\n${state.constraints.map(c => `  - ${c}`).join('\n')}`);
  }
  if (opts.includeDecisions && state.decisions.length) {
    parts.push(`Decisions:\n${state.decisions.map(d => `  - ${d}`).join('\n')}`);
  }
  if (opts.includeRisks && state.risks.length) {
    parts.push(`Risks:\n${state.risks.map(r => `  - ${r}`).join('\n')}`);
  }
  if (opts.includeKnownFiles && state.knownFiles.length) {
    parts.push(`Known files: ${state.knownFiles.join(', ')}`);
  }
  if (state.nextStep) parts.push(`Next step: ${state.nextStep}`);
  parts.push(`State version: ${state.version}`);
  return parts.join('\n\n');
}

// Priority-based trimming. Removes lowest-priority content first.
// Deterministic: same inputs → same output. At most 4 iterations.
// Never trims: taskGoal, scopeDescription, constraints (safety-critical).
function trimToBudget(
  pack: ContextPack,
  state: CanonicalProjectState,
  maxTokens: number,
): ContextPack {
  let current = { ...pack };
  const trimOpts: ContextPackOptions = {
    ...DEFAULT_OPTIONS,
    includeKnownFiles: true,
    includeRisks: true,
    includeDecisions: true,
  };

  // Step 1: drop knownFiles (often large, least critical)
  if (current.estimatedTokens > maxTokens) {
    trimOpts.includeKnownFiles = false;
    current.canonicalStateSummary = buildStateSummary(state, trimOpts);
    current.estimatedTokens = estimateTokens(current);
  }

  // Step 2: drop risks
  if (current.estimatedTokens > maxTokens) {
    trimOpts.includeRisks = false;
    current.canonicalStateSummary = buildStateSummary(state, trimOpts);
    current.estimatedTokens = estimateTokens(current);
  }

  // Step 3: drop decisions
  if (current.estimatedTokens > maxTokens) {
    trimOpts.includeDecisions = false;
    current.canonicalStateSummary = buildStateSummary(state, trimOpts);
    current.estimatedTokens = estimateTokens(current);
  }

  // Step 4: drop memory (stablePrefix) — last resort before irreducible core
  if (current.estimatedTokens > maxTokens) {
    current.stablePrefix = '';
    current.estimatedTokens = estimateTokens(current);
  }

  return current;
}

// Rough token estimate: ~4 characters per token (industry approximation).
// Not billing-accurate. Used for sizing awareness and future cost tracking.
// Track this per-run so we can surface cost visibility without requiring exact counts.
export function estimateTokens(
  pack: Omit<ContextPack, 'estimatedTokens'>,
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
