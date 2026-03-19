import { describe, it, expect } from 'vitest';
import { createInitialState, applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import type { DeltaOperation } from '../../../src/domain/state-delta.js';
import { generateDeltaId } from '../../../src/domain/ids.js';

describe('CanonicalProjectState', () => {
  it('createInitialState returns version 1 with empty fields', () => {
    const state = createInitialState();
    expect(state.version).toBe(1);
    expect(state.parentVersion).toBeNull();
    expect(state.goal).toBe('');
    expect(state.constraints).toEqual([]);
    expect(state.decisions).toEqual([]);
    expect(state.risks).toEqual([]);
    expect(state.knownFiles).toEqual([]);
    expect(state.createdFromDeltaId).toBeNull();
  });

  it('applyDeltaOperations produces incremented version with parentVersion', () => {
    const state = createInitialState();
    const deltaId = generateDeltaId();
    const next = applyDeltaOperations(state, [], deltaId);
    expect(next.version).toBe(2);
    expect(next.parentVersion).toBe(1);
    expect(next.createdFromDeltaId).toBe(deltaId);
  });

  it('parentVersion tracks actual parent through non-linear history', () => {
    const v1 = createInitialState();
    const v2 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'A' }], generateDeltaId());
    const v3 = applyDeltaOperations(v2, [{ type: 'set_phase', value: 'B' }], generateDeltaId());
    // Simulate resume: apply new delta from v1 (not v3)
    const v4 = applyDeltaOperations(v1, [{ type: 'set_goal', value: 'C' }], generateDeltaId());
    expect(v4.parentVersion).toBe(1); // Parent is v1, not v3
    expect(v4.version).toBe(2); // Pure function doesn't know about gaps — caller overrides
  });

  it('applies add operations', () => {
    const state = createInitialState();
    const ops: DeltaOperation[] = [
      { type: 'set_goal', value: 'Add SSO login' },
      { type: 'set_phase', value: 'backend implementation' },
      { type: 'add_constraint', value: 'Preserve session middleware' },
      { type: 'add_decision', value: 'Use feature flag' },
      { type: 'add_risk', value: 'Callback bypass' },
      { type: 'add_known_file', path: 'src/auth.ts' },
      { type: 'set_next_step', value: 'Implement token validation' },
    ];
    const next = applyDeltaOperations(state, ops, generateDeltaId());
    expect(next.goal).toBe('Add SSO login');
    expect(next.phase).toBe('backend implementation');
    expect(next.constraints).toEqual(['Preserve session middleware']);
    expect(next.decisions).toEqual(['Use feature flag']);
    expect(next.risks).toEqual(['Callback bypass']);
    expect(next.knownFiles).toEqual(['src/auth.ts']);
    expect(next.nextStep).toBe('Implement token validation');
  });

  it('applies remove operations', () => {
    const state = {
      ...createInitialState(),
      constraints: ['A', 'B', 'C'],
      risks: ['R1', 'R2'],
      knownFiles: ['a.ts', 'b.ts'],
    };
    const ops: DeltaOperation[] = [
      { type: 'remove_constraint', value: 'B' },
      { type: 'remove_risk', value: 'R1' },
      { type: 'remove_known_file', path: 'a.ts' },
    ];
    const next = applyDeltaOperations(state, ops, generateDeltaId());
    expect(next.constraints).toEqual(['A', 'C']);
    expect(next.risks).toEqual(['R2']);
    expect(next.knownFiles).toEqual(['b.ts']);
  });

  it('does not mutate original state', () => {
    const state = createInitialState();
    const ops: DeltaOperation[] = [
      { type: 'add_constraint', value: 'New' },
    ];
    applyDeltaOperations(state, ops, generateDeltaId());
    expect(state.constraints).toEqual([]);
    expect(state.version).toBe(1);
  });

  it('deduplicates add operations', () => {
    const state = {
      ...createInitialState(),
      constraints: ['Existing'],
    };
    const ops: DeltaOperation[] = [
      { type: 'add_constraint', value: 'Existing' },
    ];
    const next = applyDeltaOperations(state, ops, generateDeltaId());
    expect(next.constraints).toEqual(['Existing']);
  });
});
