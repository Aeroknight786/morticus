import type { NormalizedOutput, ProposedDelta } from '../domain/task-run.js';

// STUB for Phase 1: user manually fills the NormalizedOutput.
// In Phase 2, this will call Claude to extract structured output from raw task output.

export function createEmptyNormalizedOutput(): NormalizedOutput {
  return {
    summary: '',
    inspectedFiles: [],
    modifiedFiles: [],
    proposedDelta: createEmptyProposedDelta(),
    evidenceRefs: [],
    confidence: 0,
    completionReason: 'task_goal_met',
    unresolvedIssues: [],
  };
}

export function createEmptyProposedDelta(): ProposedDelta {
  return {
    addConstraints: [],
    removeConstraints: [],
    addDecisions: [],
    removeDecisions: [],
    addRisks: [],
    removeRisks: [],
    addKnownFiles: [],
    removeKnownFiles: [],
    setGoal: null,
    setPhase: null,
    setNextStep: null,
  };
}
