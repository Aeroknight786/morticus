import { describe, it, expect } from 'vitest';
import { diffStates, isDiffEmpty } from '../../../src/domain/state-diff.js';
import type { CanonicalProjectState } from '../../../src/domain/canonical-state.js';

function makeState(overrides: Partial<CanonicalProjectState> = {}): CanonicalProjectState {
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
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    createdFromDeltaId: null,
    ...overrides,
  };
}

describe('diffStates', () => {
  it('returns empty diff for identical states', () => {
    const state = makeState({ goal: 'Build app', phase: 'alpha', constraints: ['No deps'] });
    const diff = diffStates(state, state);
    expect(isDiffEmpty(diff)).toBe(true);
  });

  it('detects added constraints', () => {
    const prev = makeState({ constraints: ['A'] });
    const next = makeState({ constraints: ['A', 'B'] });
    const diff = diffStates(prev, next);
    expect(diff.addedConstraints).toEqual(['B']);
    expect(diff.removedConstraints).toEqual([]);
  });

  it('detects removed constraints', () => {
    const prev = makeState({ constraints: ['A', 'B'] });
    const next = makeState({ constraints: ['A'] });
    const diff = diffStates(prev, next);
    expect(diff.addedConstraints).toEqual([]);
    expect(diff.removedConstraints).toEqual(['B']);
  });

  it('detects added and removed decisions', () => {
    const prev = makeState({ decisions: ['Use REST'] });
    const next = makeState({ decisions: ['Use GraphQL'] });
    const diff = diffStates(prev, next);
    expect(diff.addedDecisions).toEqual(['Use GraphQL']);
    expect(diff.removedDecisions).toEqual(['Use REST']);
  });

  it('detects added and removed risks', () => {
    const prev = makeState({ risks: [] });
    const next = makeState({ risks: ['Scaling concern'] });
    const diff = diffStates(prev, next);
    expect(diff.addedRisks).toEqual(['Scaling concern']);
    expect(diff.removedRisks).toEqual([]);
  });

  it('detects added and removed known files', () => {
    const prev = makeState({ knownFiles: ['src/a.ts'] });
    const next = makeState({ knownFiles: ['src/a.ts', 'src/b.ts'] });
    const diff = diffStates(prev, next);
    expect(diff.addedKnownFiles).toEqual(['src/b.ts']);
    expect(diff.removedKnownFiles).toEqual([]);
  });

  it('detects goal change', () => {
    const prev = makeState({ goal: 'Old goal' });
    const next = makeState({ goal: 'New goal' });
    const diff = diffStates(prev, next);
    expect(diff.goalChanged).toEqual({ from: 'Old goal', to: 'New goal' });
  });

  it('returns null for unchanged goal', () => {
    const prev = makeState({ goal: 'Same' });
    const next = makeState({ goal: 'Same' });
    const diff = diffStates(prev, next);
    expect(diff.goalChanged).toBeNull();
  });

  it('detects phase change', () => {
    const prev = makeState({ phase: 'alpha' });
    const next = makeState({ phase: 'beta' });
    const diff = diffStates(prev, next);
    expect(diff.phaseChanged).toEqual({ from: 'alpha', to: 'beta' });
  });

  it('detects nextStep change', () => {
    const prev = makeState({ nextStep: 'Write tests' });
    const next = makeState({ nextStep: 'Deploy' });
    const diff = diffStates(prev, next);
    expect(diff.nextStepChanged).toEqual({ from: 'Write tests', to: 'Deploy' });
  });

  it('detects phaseGoal change', () => {
    const prev = makeState({ phaseGoal: 'Scaffold project' });
    const next = makeState({ phaseGoal: 'Complete auth module' });
    const diff = diffStates(prev, next);
    expect(diff.phaseGoalChanged).toEqual({ from: 'Scaffold project', to: 'Complete auth module' });
  });

  it('returns null for unchanged phaseGoal', () => {
    const prev = makeState({ phaseGoal: 'Same' });
    const next = makeState({ phaseGoal: 'Same' });
    const diff = diffStates(prev, next);
    expect(diff.phaseGoalChanged).toBeNull();
  });

  it('detects added and removed phaseExitCriteria', () => {
    const prev = makeState({ phaseExitCriteria: ['Tests pass', 'Docs written'] });
    const next = makeState({ phaseExitCriteria: ['Tests pass', 'Code reviewed'] });
    const diff = diffStates(prev, next);
    expect(diff.addedPhaseExitCriteria).toEqual(['Code reviewed']);
    expect(diff.removedPhaseExitCriteria).toEqual(['Docs written']);
  });

  it('handles multiple changes at once', () => {
    const prev = makeState({
      goal: 'Build MVP',
      phase: 'alpha',
      constraints: ['No deps', 'TypeScript only'],
      decisions: ['REST API'],
      risks: ['Deadline risk'],
    });
    const next = makeState({
      goal: 'Ship v1',
      phase: 'beta',
      constraints: ['TypeScript only', 'Use ESM'],
      decisions: ['REST API', 'PostgreSQL'],
      risks: [],
    });
    const diff = diffStates(prev, next);
    expect(diff.goalChanged).toEqual({ from: 'Build MVP', to: 'Ship v1' });
    expect(diff.phaseChanged).toEqual({ from: 'alpha', to: 'beta' });
    expect(diff.addedConstraints).toEqual(['Use ESM']);
    expect(diff.removedConstraints).toEqual(['No deps']);
    expect(diff.addedDecisions).toEqual(['PostgreSQL']);
    expect(diff.removedDecisions).toEqual([]);
    expect(diff.addedRisks).toEqual([]);
    expect(diff.removedRisks).toEqual(['Deadline risk']);
    expect(isDiffEmpty(diff)).toBe(false);
  });
});

describe('isDiffEmpty', () => {
  it('returns true for empty diff', () => {
    const diff = diffStates(makeState(), makeState());
    expect(isDiffEmpty(diff)).toBe(true);
  });

  it('returns false when any array field has entries', () => {
    const diff = diffStates(makeState(), makeState({ constraints: ['New'] }));
    expect(isDiffEmpty(diff)).toBe(false);
  });

  it('returns false when any scalar field changed', () => {
    const diff = diffStates(makeState({ nextStep: 'A' }), makeState({ nextStep: 'B' }));
    expect(isDiffEmpty(diff)).toBe(false);
  });
});
