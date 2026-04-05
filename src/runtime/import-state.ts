import type { DraftCanonicalState } from '../domain/chat.js';
import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { StateVersion } from '../domain/ids.js';
import type { ProjectStore } from '../storage/store.js';

export function buildImportedInitialState(
  baseState: CanonicalProjectState,
  nextVersion: StateVersion,
  draft: DraftCanonicalState,
): CanonicalProjectState {
  const now = new Date().toISOString();

  return {
    ...baseState,
    version: nextVersion,
    parentVersion: baseState.version,
    goal: draft.goal ?? baseState.goal,
    phase: draft.phase ?? baseState.phase,
    phaseGoal: draft.phaseGoal ?? baseState.phaseGoal,
    phaseExitCriteria: [...baseState.phaseExitCriteria],
    constraints: draft.constraints ?? [...baseState.constraints],
    decisions: draft.decisions ?? [...baseState.decisions],
    risks: draft.risks ?? [...baseState.risks],
    knownFiles: draft.knownFiles ?? [...baseState.knownFiles],
    nextStep: draft.nextStep ?? baseState.nextStep,
    evidenceRefs: [...baseState.evidenceRefs],
    createdAt: now,
    updatedAt: now,
    createdFromDeltaId: null,
  };
}

export async function applyImportedInitialState(
  store: ProjectStore,
  draft: DraftCanonicalState,
): Promise<CanonicalProjectState> {
  const baseState = await store.state.getCurrentState();
  const nextVersion = await store.state.getNextVersion();
  const importedState = buildImportedInitialState(baseState, nextVersion, draft);

  await store.state.saveVersion(importedState);

  const project = await store.getProject();
  project.currentStateVersion = importedState.version;
  await store.updateProject(project);

  return importedState;
}
