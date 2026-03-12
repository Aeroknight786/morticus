import { StateVersion, DeltaId, EvidenceId } from './ids.js';
import type { DeltaOperation } from './state-delta.js';

export interface CanonicalProjectState {
  version: StateVersion;
  goal: string;
  phase: string;
  phaseGoal: string;
  phaseExitCriteria: string[];
  constraints: string[];
  decisions: string[];
  risks: string[];
  knownFiles: string[];
  nextStep: string;
  evidenceRefs: EvidenceId[];
  createdAt: string;
  updatedAt: string;
  createdFromDeltaId: DeltaId | null;
}

export function createInitialState(): CanonicalProjectState {
  const now = new Date().toISOString();
  return {
    version: 1,
    goal: '',
    phase: '',
    phaseGoal: '',
    phaseExitCriteria: [],
    constraints: [],
    decisions: [],
    risks: [],
    knownFiles: [],
    nextStep: '',
    evidenceRefs: [],
    createdAt: now,
    updatedAt: now,
    createdFromDeltaId: null,
  };
}

// Pure function: apply a list of delta operations to produce a new state.
// Does not mutate the input.
export function applyDeltaOperations(
  current: CanonicalProjectState,
  operations: DeltaOperation[],
  deltaId: DeltaId,
): CanonicalProjectState {
  const next: CanonicalProjectState = {
    ...current,
    version: current.version + 1,
    constraints: [...current.constraints],
    decisions: [...current.decisions],
    risks: [...current.risks],
    knownFiles: [...current.knownFiles],
    phaseExitCriteria: [...current.phaseExitCriteria],
    evidenceRefs: [...current.evidenceRefs],
    updatedAt: new Date().toISOString(),
    createdFromDeltaId: deltaId,
  };

  for (const op of operations) {
    switch (op.type) {
      case 'add_constraint':
        if (!next.constraints.includes(op.value)) {
          next.constraints.push(op.value);
        }
        break;
      case 'remove_constraint':
        next.constraints = next.constraints.filter(c => c !== op.value);
        break;
      case 'add_decision':
        if (!next.decisions.includes(op.value)) {
          next.decisions.push(op.value);
        }
        break;
      case 'remove_decision':
        next.decisions = next.decisions.filter(d => d !== op.value);
        break;
      case 'add_risk':
        if (!next.risks.includes(op.value)) {
          next.risks.push(op.value);
        }
        break;
      case 'remove_risk':
        next.risks = next.risks.filter(r => r !== op.value);
        break;
      case 'add_known_file':
        if (!next.knownFiles.includes(op.path)) {
          next.knownFiles.push(op.path);
        }
        break;
      case 'remove_known_file':
        next.knownFiles = next.knownFiles.filter(f => f !== op.path);
        break;
      case 'set_goal':
        next.goal = op.value;
        break;
      case 'set_phase':
        next.phase = op.value;
        break;
      case 'set_next_step':
        next.nextStep = op.value;
        break;
      case 'set_phase_goal':
        next.phaseGoal = op.value;
        break;
      case 'add_phase_exit_criterion':
        if (!next.phaseExitCriteria.includes(op.value)) {
          next.phaseExitCriteria.push(op.value);
        }
        break;
      case 'remove_phase_exit_criterion':
        next.phaseExitCriteria = next.phaseExitCriteria.filter(c => c !== op.value);
        break;
    }
  }

  return next;
}
