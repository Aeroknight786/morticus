import {
  TaskId, ProjectId, SpecId, RunId, DeltaId, StateVersion,
} from './ids.js';
import type { ProviderType } from './project.js';
import { MorticusError } from './errors.js';

export type TaskType = 'discovery' | 'implementation' | 'validation';

export type TaskStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'awaiting_completion'
  | 'normalizing_output'
  | 'awaiting_review'
  | 'merged'
  | 'rejected'
  | 'archived';

export type WritePermission =
  | 'create_files'
  | 'modify_files'
  | 'delete_files'
  | 'run_commands'
  | 'run_tests';

export interface TaskScope {
  paths: string[];
  readOnly: boolean;
  writePermissions: WritePermission[];
}

export type ReviewOutcome =
  | { decision: 'accepted'; acceptedAt: string }
  | { decision: 'accepted_with_edits'; edits: string; acceptedAt: string }
  | { decision: 'rejected'; reason: string; rejectedAt: string }
  | { decision: 'archived'; archivedAt: string };

export interface TaskNode {
  id: TaskId;
  projectId: ProjectId;
  parentTaskId: TaskId | null;
  title: string;
  goal: string;
  description: string;
  taskType: TaskType;
  scope: TaskScope;
  provider: ProviderType;
  baseStateVersion: StateVersion;
  specId: SpecId | null;
  runIds: RunId[];
  status: TaskStatus;
  candidateDeltaId: DeltaId | null;
  reviewOutcome: ReviewOutcome | null;
  createdAt: string;
  updatedAt: string;
}

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft: ['ready', 'archived'],
  ready: ['running', 'archived'],
  running: ['awaiting_completion', 'archived'],
  awaiting_completion: ['normalizing_output', 'running', 'archived'],
  normalizing_output: ['awaiting_review', 'archived'],
  awaiting_review: ['merged', 'rejected', 'archived'],
  merged: [],
  rejected: ['draft', 'archived'],
  archived: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function transitionTask(task: TaskNode, to: TaskStatus): TaskNode {
  if (!canTransition(task.status, to)) {
    throw new MorticusError(
      `Cannot transition task from '${task.status}' to '${to}'`,
      'INVALID_TRANSITION',
      { taskId: task.id, from: task.status, to },
    );
  }
  return {
    ...task,
    status: to,
    updatedAt: new Date().toISOString(),
  };
}

export function createTask(
  id: TaskId,
  projectId: ProjectId,
  title: string,
  goal: string,
  taskType: TaskType,
  scope: TaskScope,
  baseStateVersion: StateVersion,
  provider: ProviderType = 'claude',
): TaskNode {
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    parentTaskId: null,
    title,
    goal,
    description: '',
    taskType,
    scope,
    provider,
    baseStateVersion,
    specId: null,
    runIds: [],
    status: 'draft',
    candidateDeltaId: null,
    reviewOutcome: null,
    createdAt: now,
    updatedAt: now,
  };
}

// Creates a new draft task from a rejected or archived task.
// Preserves title, goal, type, scope, and provider. Sets parentTaskId for provenance.
// Uses the current state version as the base (not the original's stale version).
export function createRetryTask(
  newId: TaskId,
  original: TaskNode,
  currentStateVersion: StateVersion,
): TaskNode {
  const now = new Date().toISOString();
  return {
    id: newId,
    projectId: original.projectId,
    parentTaskId: original.id,
    title: original.title,
    goal: original.goal,
    description: original.description,
    taskType: original.taskType,
    scope: { ...original.scope },
    provider: original.provider,
    baseStateVersion: currentStateVersion,
    specId: null,
    runIds: [],
    status: 'draft',
    candidateDeltaId: null,
    reviewOutcome: null,
    createdAt: now,
    updatedAt: now,
  };
}
