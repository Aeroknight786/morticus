import type { StateVersion } from '../domain/ids.js';
import type { CanonicalProjectState } from '../domain/canonical-state.js';
import { applyDeltaOperations } from '../domain/canonical-state.js';
import type { StateDelta, AppliedStateDelta } from '../domain/state-delta.js';
import type { StateStore } from '../storage/state-store.js';
import type { DeltaStore } from '../storage/delta-store.js';

// Applies an accepted delta to canonical state and persists both.
// Deterministic — no LLM involvement.

export interface ApplyResult {
  newState: CanonicalProjectState;
  applied: AppliedStateDelta;
}

export async function applyAcceptedDelta(
  delta: StateDelta,
  currentState: CanonicalProjectState,
  stateStore: StateStore,
  deltaStore: DeltaStore,
): Promise<ApplyResult> {
  const newState = applyDeltaOperations(currentState, delta.operations, delta.id);

  // Persist the new state version
  await stateStore.saveVersion(newState);

  // Update delta status
  const acceptedDelta: StateDelta = {
    ...delta,
    status: 'accepted',
    reviewedAt: new Date().toISOString(),
  };
  await deltaStore.save(acceptedDelta);

  const applied: AppliedStateDelta = {
    deltaId: delta.id,
    operations: delta.operations,
    appliedAt: new Date().toISOString(),
    resultingVersion: newState.version,
  };

  return { newState, applied };
}
