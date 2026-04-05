import { generateSpecId } from '../domain/ids.js';
import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { DurableMemory, MemCell } from '../domain/durable-memory.js';
import type { TaskNode } from '../domain/task.js';
import type { TaskSpec, ContextPackOptions } from '../domain/task-spec.js';
import { resolvePolicy } from './policy.js';
import { buildContextPack } from './context-pack.js';
import { resolveContextProfile, extractRelevanceKeywords } from '../domain/context-policy.js';

const COMPILER_VERSION = '0.1.0';

// Deterministic task spec resolver.
// Takes a task node + canonical state + durable memory and produces a fully specified TaskSpec.
// No LLM call — pure function.
//
// Context profiles are resolved from the context-policy module based on surface + task type.
// The caller can still pass packOptions to override specific fields.

export function resolveTaskSpec(
  task: TaskNode,
  state: CanonicalProjectState,
  memory: DurableMemory,
  packOptions: Partial<ContextPackOptions> = {},
  memCells?: MemCell[],
): TaskSpec {
  const policy = resolvePolicy(task.taskType);

  // Resolve context profile for this task type
  const profile = resolveContextProfile('task_run', task.taskType, task.scope.paths);
  const relevanceKeywords = extractRelevanceKeywords(task.goal, task.scope.paths);

  // Map profile to ContextPackOptions
  const profileOptions: Partial<ContextPackOptions> = {
    includeDecisions: profile.stateSlice.includeDecisions,
    includeRisks: profile.stateSlice.includeRisks,
    includeKnownFiles: profile.stateSlice.includeKnownFiles,
    includePhaseExitCriteria: profile.stateSlice.includePhaseExitCriteria,
    scopeFilterKnownFiles: profile.stateSlice.scopeFilterKnownFiles,
    scopeFilterDecisions: profile.stateSlice.scopeFilterDecisions,
    scopeFilterRisks: profile.stateSlice.scopeFilterRisks,
    scopePaths: task.scope.paths,
    includeCategories: profile.memorySlice.includeCategories,
    excludeCategories: profile.memorySlice.excludeCategories,
    maxMemoryEntries: profile.memorySlice.maxEntries,
    memoryRelevanceThreshold: profile.memorySlice.relevanceThreshold,
    relevanceKeywords,
    maxTokens: profile.tokenBudget.maxSystemPromptTokens,
    preferredMemCellType: profile.memorySlice.preferredMemoryType,
    maxMemCellResults: profile.memorySlice.maxMemCellResults,
  };

  const contextPack = buildContextPack(state, memory, task, {
    ...profileOptions,
    ...packOptions, // caller overrides win
  }, memCells);

  return {
    id: generateSpecId(),
    taskId: task.id,
    baseStateVersion: state.version,
    scopePaths: task.scope.paths,
    allowedTools: policy.allowedTools,
    writePermissions: policy.writePermissions,
    testRequirements: [],
    outputSchema: { version: '1.0.0' },
    stopConditions: [{ type: 'goal_met' }],
    mergePolicy: 'require_review',
    contextPack,
    compiledAt: new Date().toISOString(),
    compilerVersion: COMPILER_VERSION,
  };
}
