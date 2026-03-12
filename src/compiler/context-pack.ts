import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { DurableMemory } from '../domain/durable-memory.js';
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
// Caution: do not truncate what is needed for reliable task execution.
// Bad truncation causes retries and rework, which increases total cost.

const DEFAULT_OPTIONS: ContextPackOptions = {
  includeRisks: true,
  includeDecisions: true,
  includeKnownFiles: true,
  maxMemoryEntries: null,
};

export function buildContextPack(
  state: CanonicalProjectState,
  memory: DurableMemory,
  task: TaskNode,
  options: Partial<ContextPackOptions> = {},
): ContextPack {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Stable prefix: durable memory and project-level rules.
  // Isolated so it is structurally separate from run-variable content.
  const stablePrefix = buildStablePrefix(memory, opts);

  // Variable per-run content: compiled from the current state snapshot.
  const stateSummary = buildStateSummary(state, opts);
  const memoryEntries = buildMemoryEntries(memory, opts);

  const scopeDesc = task.scope.readOnly
    ? `Read-only access to: ${task.scope.paths.join(', ') || 'entire project'}`
    : `Read/write access to: ${task.scope.paths.join(', ') || 'entire project'}`;

  const pack = {
    stablePrefix,
    canonicalStateSummary: stateSummary,
    relevantMemoryEntries: memoryEntries,
    scopeDescription: scopeDesc,
    taskGoal: task.goal,
    constraints: state.constraints,
  };

  return {
    ...pack,
    estimatedTokens: estimateTokens(pack),
  };
}

function buildStablePrefix(memory: DurableMemory, opts: ContextPackOptions): string {
  const entries = buildMemoryEntries(memory, opts);
  if (entries.length === 0) return '';
  return `## Project Rules and Standards\n\n${entries.join('\n\n')}`;
}

function buildMemoryEntries(memory: DurableMemory, opts: ContextPackOptions): string[] {
  const active = memory.entries.filter(e => e.active);
  const limited = opts.maxMemoryEntries !== null
    ? active.slice(0, opts.maxMemoryEntries)
    : active;
  return limited.map(e => `[${e.category}] ${e.title}: ${e.content}`);
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
