import { describe, it, expect } from 'vitest';
import { createInitialState, applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import type { DeltaOperation } from '../../../src/domain/state-delta.js';
import { generateDeltaId } from '../../../src/domain/ids.js';

describe('Phase fields — phaseGoal and phaseExitCriteria', () => {
  it('createInitialState includes empty phase fields', () => {
    const state = createInitialState();
    expect(state.phaseGoal).toBe('');
    expect(state.phaseExitCriteria).toEqual([]);
  });

  it('applies set_phase_goal', () => {
    const state = createInitialState();
    const ops: DeltaOperation[] = [
      { type: 'set_phase_goal', value: 'Complete the auth module' },
    ];
    const next = applyDeltaOperations(state, ops, generateDeltaId());
    expect(next.phaseGoal).toBe('Complete the auth module');
  });

  it('applies add_phase_exit_criterion', () => {
    const state = createInitialState();
    const ops: DeltaOperation[] = [
      { type: 'add_phase_exit_criterion', value: 'All tests pass' },
      { type: 'add_phase_exit_criterion', value: 'Code reviewed' },
    ];
    const next = applyDeltaOperations(state, ops, generateDeltaId());
    expect(next.phaseExitCriteria).toEqual(['All tests pass', 'Code reviewed']);
  });

  it('deduplicates phase exit criteria', () => {
    const state = {
      ...createInitialState(),
      phaseExitCriteria: ['All tests pass'],
    };
    const ops: DeltaOperation[] = [
      { type: 'add_phase_exit_criterion', value: 'All tests pass' },
    ];
    const next = applyDeltaOperations(state, ops, generateDeltaId());
    expect(next.phaseExitCriteria).toEqual(['All tests pass']);
  });

  it('removes phase exit criteria', () => {
    const state = {
      ...createInitialState(),
      phaseExitCriteria: ['A', 'B', 'C'],
    };
    const ops: DeltaOperation[] = [
      { type: 'remove_phase_exit_criterion', value: 'B' },
    ];
    const next = applyDeltaOperations(state, ops, generateDeltaId());
    expect(next.phaseExitCriteria).toEqual(['A', 'C']);
  });

  it('does not mutate original state for phase fields', () => {
    const state = {
      ...createInitialState(),
      phaseGoal: 'Old goal',
      phaseExitCriteria: ['Criterion'],
    };
    const ops: DeltaOperation[] = [
      { type: 'set_phase_goal', value: 'New goal' },
      { type: 'remove_phase_exit_criterion', value: 'Criterion' },
    ];
    applyDeltaOperations(state, ops, generateDeltaId());
    expect(state.phaseGoal).toBe('Old goal');
    expect(state.phaseExitCriteria).toEqual(['Criterion']);
  });

  it('combines phase operations with existing operations', () => {
    const state = createInitialState();
    const ops: DeltaOperation[] = [
      { type: 'set_goal', value: 'Build pricing engine' },
      { type: 'set_phase', value: 'implementation' },
      { type: 'set_phase_goal', value: 'Complete core calculations' },
      { type: 'add_phase_exit_criterion', value: 'Unit tests cover core' },
      { type: 'add_constraint', value: 'Must be fast' },
    ];
    const next = applyDeltaOperations(state, ops, generateDeltaId());
    expect(next.goal).toBe('Build pricing engine');
    expect(next.phase).toBe('implementation');
    expect(next.phaseGoal).toBe('Complete core calculations');
    expect(next.phaseExitCriteria).toEqual(['Unit tests cover core']);
    expect(next.constraints).toEqual(['Must be fast']);
  });
});
