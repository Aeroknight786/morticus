import type { CanonicalProjectState } from './canonical-state.js';

// Pure function: computes a human-readable diff between two state snapshots.
// No Node APIs, no VS Code. Fully testable.

export interface StateDiff {
  addedConstraints: string[];
  removedConstraints: string[];
  addedDecisions: string[];
  removedDecisions: string[];
  addedRisks: string[];
  removedRisks: string[];
  addedKnownFiles: string[];
  removedKnownFiles: string[];
  goalChanged: { from: string; to: string } | null;
  phaseChanged: { from: string; to: string } | null;
  phaseGoalChanged: { from: string; to: string } | null;
  addedPhaseExitCriteria: string[];
  removedPhaseExitCriteria: string[];
  nextStepChanged: { from: string; to: string } | null;
}

export function diffStates(
  prev: CanonicalProjectState,
  next: CanonicalProjectState,
): StateDiff {
  return {
    addedConstraints: next.constraints.filter(c => !prev.constraints.includes(c)),
    removedConstraints: prev.constraints.filter(c => !next.constraints.includes(c)),
    addedDecisions: next.decisions.filter(d => !prev.decisions.includes(d)),
    removedDecisions: prev.decisions.filter(d => !next.decisions.includes(d)),
    addedRisks: next.risks.filter(r => !prev.risks.includes(r)),
    removedRisks: prev.risks.filter(r => !next.risks.includes(r)),
    addedKnownFiles: next.knownFiles.filter(f => !prev.knownFiles.includes(f)),
    removedKnownFiles: prev.knownFiles.filter(f => !next.knownFiles.includes(f)),
    goalChanged: prev.goal !== next.goal ? { from: prev.goal, to: next.goal } : null,
    phaseChanged: prev.phase !== next.phase ? { from: prev.phase, to: next.phase } : null,
    phaseGoalChanged: prev.phaseGoal !== next.phaseGoal ? { from: prev.phaseGoal, to: next.phaseGoal } : null,
    addedPhaseExitCriteria: next.phaseExitCriteria.filter(c => !prev.phaseExitCriteria.includes(c)),
    removedPhaseExitCriteria: prev.phaseExitCriteria.filter(c => !next.phaseExitCriteria.includes(c)),
    nextStepChanged: prev.nextStep !== next.nextStep ? { from: prev.nextStep, to: next.nextStep } : null,
  };
}

export function isDiffEmpty(diff: StateDiff): boolean {
  return (
    diff.addedConstraints.length === 0 &&
    diff.removedConstraints.length === 0 &&
    diff.addedDecisions.length === 0 &&
    diff.removedDecisions.length === 0 &&
    diff.addedRisks.length === 0 &&
    diff.removedRisks.length === 0 &&
    diff.addedKnownFiles.length === 0 &&
    diff.removedKnownFiles.length === 0 &&
    diff.goalChanged === null &&
    diff.phaseChanged === null &&
    diff.phaseGoalChanged === null &&
    diff.addedPhaseExitCriteria.length === 0 &&
    diff.removedPhaseExitCriteria.length === 0 &&
    diff.nextStepChanged === null
  );
}
