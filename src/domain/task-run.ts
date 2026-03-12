import { RunId, TaskId } from './ids.js';
import type { ProviderType } from './project.js';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// Snapshot of context cost metrics at run creation time.
// Persisted into run.json so historical run detail never depends on mutable spec state.
export interface ContextMetrics {
  estimatedTokens: number;
  activeMemoryEntryCount: number;
  stablePrefixLength: number;
}

export interface TaskRun {
  id: RunId;
  taskId: TaskId;
  provider: ProviderType;
  status: RunStatus;
  worktreePath: string | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  artifactPaths: string[];
  rawOutputPath: string | null;
  normalizedOutputPath: string | null;
  contextMetrics: ContextMetrics | null;
}

export interface NormalizedOutput {
  summary: string;
  inspectedFiles: string[];
  modifiedFiles: string[];
  proposedDelta: ProposedDelta;
  evidenceRefs: string[];
  confidence: number;
  completionReason: CompletionReason;
  unresolvedIssues: string[];
}

export type CompletionReason =
  | 'task_goal_met'
  | 'max_turns_reached'
  | 'user_stopped'
  | 'provider_stopped'
  | 'error';

export interface ProposedDelta {
  addConstraints: string[];
  removeConstraints: string[];
  addDecisions: string[];
  removeDecisions: string[];
  addRisks: string[];
  removeRisks: string[];
  addKnownFiles: string[];
  removeKnownFiles: string[];
  setGoal: string | null;
  setPhase: string | null;
  setNextStep: string | null;
}

export function createTaskRun(
  id: RunId,
  taskId: TaskId,
  provider: ProviderType,
): TaskRun {
  return {
    id,
    taskId,
    provider,
    status: 'pending',
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    artifactPaths: [],
    rawOutputPath: null,
    normalizedOutputPath: null,
    contextMetrics: null,
  };
}
