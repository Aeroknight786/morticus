import { generateDeltaId } from '../domain/ids.js';
import type { TaskId, StateVersion } from '../domain/ids.js';
import type { ProposedDelta } from '../domain/task-run.js';
import { createStateDelta, type DeltaOperation, type StateDelta } from '../domain/state-delta.js';

// Converts a ProposedDelta (from normalized output) into a typed StateDelta.
// Deterministic — no LLM involvement.

export function buildDelta(
  proposed: ProposedDelta,
  taskId: TaskId,
  baseStateVersion: StateVersion,
): StateDelta {
  const operations: DeltaOperation[] = [];

  for (const v of proposed.addConstraints) {
    operations.push({ type: 'add_constraint', value: v });
  }
  for (const v of proposed.removeConstraints) {
    operations.push({ type: 'remove_constraint', value: v });
  }
  for (const v of proposed.addDecisions) {
    operations.push({ type: 'add_decision', value: v });
  }
  for (const v of proposed.removeDecisions) {
    operations.push({ type: 'remove_decision', value: v });
  }
  for (const v of proposed.addRisks) {
    operations.push({ type: 'add_risk', value: v });
  }
  for (const v of proposed.removeRisks) {
    operations.push({ type: 'remove_risk', value: v });
  }
  for (const p of proposed.addKnownFiles) {
    operations.push({ type: 'add_known_file', path: p });
  }
  for (const p of proposed.removeKnownFiles) {
    operations.push({ type: 'remove_known_file', path: p });
  }
  if (proposed.setGoal !== null) {
    operations.push({ type: 'set_goal', value: proposed.setGoal });
  }
  if (proposed.setPhase !== null) {
    operations.push({ type: 'set_phase', value: proposed.setPhase });
  }
  if (proposed.setNextStep !== null) {
    operations.push({ type: 'set_next_step', value: proposed.setNextStep });
  }

  return createStateDelta(generateDeltaId(), taskId, baseStateVersion, operations);
}
