import { DeltaId, TaskId, StateVersion, EvidenceId } from './ids.js';

export type DeltaStatus = 'proposed' | 'accepted' | 'accepted_with_edits' | 'rejected';

export type DeltaOperation =
  | { type: 'add_constraint'; value: string }
  | { type: 'remove_constraint'; value: string }
  | { type: 'add_decision'; value: string }
  | { type: 'remove_decision'; value: string }
  | { type: 'add_risk'; value: string }
  | { type: 'remove_risk'; value: string }
  | { type: 'add_known_file'; path: string }
  | { type: 'remove_known_file'; path: string }
  | { type: 'set_goal'; value: string }
  | { type: 'set_phase'; value: string }
  | { type: 'set_next_step'; value: string }
  | { type: 'set_phase_goal'; value: string }
  | { type: 'add_phase_exit_criterion'; value: string }
  | { type: 'remove_phase_exit_criterion'; value: string }
  | { type: 'clear_phase_exit_criteria' };

// Canonical list of valid delta operation type strings, derived from the DeltaOperation union.
export const VALID_DELTA_OP_TYPES = [
  'add_constraint', 'remove_constraint', 'add_decision', 'remove_decision',
  'add_risk', 'remove_risk', 'add_known_file', 'remove_known_file',
  'set_goal', 'set_phase', 'set_next_step', 'set_phase_goal',
  'add_phase_exit_criterion', 'remove_phase_exit_criterion',
  'clear_phase_exit_criteria',
] as const;

export interface DeltaConflict {
  severity: 'warning' | 'error';
  type: ConflictType;
  description: string;
  operationIndex: number;
}

export type ConflictType =
  | 'stale_base_version'
  | 'scope_violation'
  | 'file_not_found'
  | 'constraint_contradiction'
  | 'missing_evidence'
  | 'test_not_run';

export interface StateDelta {
  id: DeltaId;
  taskId: TaskId | null;
  baseStateVersion: StateVersion;
  operations: DeltaOperation[];
  evidenceRefs: EvidenceId[];
  confidence: number;
  conflicts: DeltaConflict[];
  status: DeltaStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

export interface AppliedStateDelta {
  deltaId: DeltaId;
  operations: DeltaOperation[];
  appliedAt: string;
  resultingVersion: StateVersion;
}

export function createStateDelta(
  id: DeltaId,
  taskId: TaskId | null,
  baseStateVersion: StateVersion,
  operations: DeltaOperation[],
): StateDelta {
  return {
    id,
    taskId,
    baseStateVersion,
    operations,
    evidenceRefs: [],
    confidence: 0,
    conflicts: [],
    status: 'proposed',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewNotes: null,
  };
}
