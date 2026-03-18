import { SpecId, TaskId, StateVersion } from './ids.js';
import type { WritePermission } from './task.js';
import type { MemoryCategory } from './durable-memory.js';

export interface TaskSpec {
  id: SpecId;
  taskId: TaskId;
  baseStateVersion: StateVersion;
  scopePaths: string[];
  allowedTools: string[];
  writePermissions: WritePermission[];
  testRequirements: TestRequirement[];
  outputSchema: OutputSchemaRef;
  stopConditions: StopCondition[];
  mergePolicy: MergePolicy;
  contextPack: ContextPack;
  compiledAt: string;
  compilerVersion: string;
}

export interface TestRequirement {
  description: string;
  command: string | null;
  required: boolean;
}

export interface OutputSchemaRef {
  version: string;
}

export type StopCondition =
  | { type: 'goal_met' }
  | { type: 'max_turns'; maxTurns: number }
  | { type: 'user_stop' };

export type MergePolicy = 'require_review' | 'auto_merge_if_clean';

export interface ContextPack {
  // Stable prefix: content that rarely changes and can be reused across runs.
  // Includes durable memory, project rules, task template boilerplate.
  stablePrefix: string;

  // Variable per-run content: compiled from the current canonical state snapshot.
  canonicalStateSummary: string;
  relevantMemoryEntries: string[];
  scopeDescription: string;
  taskGoal: string;
  constraints: string[];

  // Lightweight cost tracking: estimated token count for this pack.
  // Based on character count / 4 (rough approximation). Not billed precision.
  estimatedTokens: number;
}

// Options that control what the context compiler includes.
// Use to produce the smallest context that is still sufficient for the task.
export interface ContextPackOptions {
  // Include risks in the state summary (default: true)
  includeRisks: boolean;
  // Include decisions in the state summary (default: true)
  includeDecisions: boolean;
  // Include known files list (default: true for discovery/validation, optional for implementation)
  includeKnownFiles: boolean;
  // Max memory entries to include (default: all active)
  maxMemoryEntries: number | null;
  // Only include these memory categories (default: null = all)
  includeCategories: MemoryCategory[] | null;
  // Exclude these memory categories (default: null = none excluded)
  excludeCategories: MemoryCategory[] | null;
  // Max estimated tokens for the context pack (default: null = no limit).
  // When exceeded, lower-priority content is trimmed progressively.
  maxTokens: number | null;
}

// Intermediate type: what the user or LLM provides before deterministic compilation
export interface TaskIntent {
  title: string;
  goal: string;
  suggestedType: 'discovery' | 'implementation' | 'validation';
  suggestedScope: string[];
  suggestedPermissions: WritePermission[];
  userRequest: string;
}
