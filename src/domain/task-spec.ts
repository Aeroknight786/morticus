import { SpecId, TaskId, StateVersion } from './ids.js';
import type { WritePermission } from './task.js';
import type { MemoryCategory, MemoryType } from './durable-memory.js';
import type { ContextManifest } from './context-policy.js';

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

  // What was included/excluded and why. Populated by the context compiler.
  contextManifest: ContextManifest | null;
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
  // Include phase exit criteria in the state summary (default: false)
  includePhaseExitCriteria: boolean;
  // Max memory entries to include (default: all active)
  maxMemoryEntries: number | null;
  // Only include these memory categories (default: null = all)
  includeCategories: MemoryCategory[] | null;
  // Exclude these memory categories (default: null = none excluded)
  excludeCategories: MemoryCategory[] | null;
  // Max estimated tokens for the context pack (default: null = no limit).
  // When exceeded, lower-priority content is trimmed progressively.
  maxTokens: number | null;
  // Minimum keyword relevance score for memory entries (default: null = no filtering)
  memoryRelevanceThreshold: number | null;
  // Keywords for relevance scoring (from task goal + scope paths)
  relevanceKeywords: string[];
  // Scope-filter knownFiles by path prefix match
  scopeFilterKnownFiles: boolean;
  // Scope paths for filtering (from task scope)
  scopePaths: string[];
  // Scope-filter decisions by keyword overlap
  scopeFilterDecisions: boolean;
  // Scope-filter risks by keyword overlap
  scopeFilterRisks: boolean;
  // Preferred MemCell memory type (null = fuse both via RRF)
  preferredMemCellType: MemoryType | null;
  // Maximum MemCell results to supplement flat entries
  maxMemCellResults: number;
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
