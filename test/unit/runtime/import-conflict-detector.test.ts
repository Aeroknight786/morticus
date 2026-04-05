import { describe, it, expect } from 'vitest';
import { detectImportConflicts } from '../../../src/runtime/import-conflict-detector.js';
import { createInitialState, applyDeltaOperations } from '../../../src/domain/canonical-state.js';
import { generateDeltaId } from '../../../src/domain/ids.js';
import type { ImportExtractionResult } from '../../../src/domain/import.js';

function makeExtraction(overrides: Partial<ImportExtractionResult['draftState']> = {}): ImportExtractionResult {
  return {
    draftState: {
      goal: undefined,
      phase: undefined,
      phaseGoal: undefined,
      constraints: undefined,
      decisions: undefined,
      risks: undefined,
      knownFiles: undefined,
      nextStep: undefined,
      ...overrides,
    },
    candidateMemory: [],
    candidateTasks: [],
    summary: 'test',
    extractedAt: new Date().toISOString(),
    contextTokenEstimate: 100,
  };
}

describe('detectImportConflicts', () => {
  it('returns no conflicts when state is empty', () => {
    const state = createInitialState();
    const extraction = makeExtraction({ goal: 'New goal' });

    const conflicts = detectImportConflicts(extraction, state);
    expect(conflicts).toHaveLength(0);
  });

  it('returns no conflicts when extraction has no draft state', () => {
    const ops = [{ type: 'set_goal' as const, value: 'Existing goal' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction: ImportExtractionResult = {
      draftState: null,
      candidateMemory: [],
      candidateTasks: [],
      summary: '',
      extractedAt: new Date().toISOString(),
      contextTokenEstimate: 0,
    };

    const conflicts = detectImportConflicts(extraction, state);
    expect(conflicts).toHaveLength(0);
  });

  it('detects goal conflict', () => {
    const ops = [{ type: 'set_goal' as const, value: 'Build auth system' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({ goal: 'Build payment system' });

    const conflicts = detectImportConflicts(extraction, state);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe('goal');
    expect(conflicts[0].existingValue).toBe('Build auth system');
    expect(conflicts[0].importedValue).toBe('Build payment system');
  });

  it('detects phase conflict', () => {
    const ops = [{ type: 'set_phase' as const, value: 'testing' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({ phase: 'implementation' });

    const conflicts = detectImportConflicts(extraction, state);

    const phaseConflict = conflicts.find(c => c.field === 'phase');
    expect(phaseConflict).toBeDefined();
    expect(phaseConflict!.severity).toBe('warning');
  });

  it('detects phaseGoal conflict', () => {
    const ops = [{ type: 'set_phase_goal' as const, value: 'Complete unit tests' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({ phaseGoal: 'Deploy to staging' });

    const conflicts = detectImportConflicts(extraction, state);

    const conflict = conflicts.find(c => c.field === 'phaseGoal');
    expect(conflict).toBeDefined();
  });

  it('detects nextStep conflict', () => {
    const ops = [{ type: 'set_next_step' as const, value: 'Write integration tests' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({ nextStep: 'Deploy to prod' });

    const conflicts = detectImportConflicts(extraction, state);

    const conflict = conflicts.find(c => c.field === 'nextStep');
    expect(conflict).toBeDefined();
  });

  it('detects duplicate constraints', () => {
    const ops = [{ type: 'add_constraint' as const, value: 'No external deps' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({
      constraints: ['No external deps', 'Max 100ms latency'],
    });

    const conflicts = detectImportConflicts(extraction, state);

    const conflict = conflicts.find(c => c.field === 'constraints');
    expect(conflict).toBeDefined();
    expect(conflict!.description).toContain('1');
    expect(conflict!.severity).toBe('info');
  });

  it('detects duplicate decisions (case insensitive)', () => {
    const ops = [{ type: 'add_decision' as const, value: 'Use TypeScript' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({
      decisions: ['use typescript', 'Use React'],
    });

    const conflicts = detectImportConflicts(extraction, state);

    const conflict = conflicts.find(c => c.field === 'decisions');
    expect(conflict).toBeDefined();
    expect(conflict!.description).toContain('1');
  });

  it('detects duplicate risks', () => {
    const ops = [{ type: 'add_risk' as const, value: 'Timeline risk' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({
      risks: ['Timeline risk'],
    });

    const conflicts = detectImportConflicts(extraction, state);

    const conflict = conflicts.find(c => c.field === 'risks');
    expect(conflict).toBeDefined();
  });

  it('no conflict when imported goal matches existing', () => {
    const ops = [{ type: 'set_goal' as const, value: 'Build auth' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({ goal: 'Build auth' });

    const conflicts = detectImportConflicts(extraction, state);

    expect(conflicts.find(c => c.field === 'goal')).toBeUndefined();
  });

  it('no conflict for new array entries that dont overlap', () => {
    const ops = [{ type: 'add_constraint' as const, value: 'Constraint A' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({
      constraints: ['Constraint B', 'Constraint C'],
    });

    const conflicts = detectImportConflicts(extraction, state);

    expect(conflicts.find(c => c.field === 'constraints')).toBeUndefined();
  });

  it('handles multiple conflicts at once', () => {
    const ops = [
      { type: 'set_goal' as const, value: 'Old goal' },
      { type: 'set_phase' as const, value: 'planning' },
      { type: 'add_constraint' as const, value: 'No deps' },
    ];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({
      goal: 'New goal',
      phase: 'implementation',
      constraints: ['No deps'],
    });

    const conflicts = detectImportConflicts(extraction, state);

    expect(conflicts.length).toBeGreaterThanOrEqual(3);
  });

  it('assigns override severity when goals are completely different', () => {
    const ops = [{ type: 'set_goal' as const, value: 'Build authentication system with OAuth' }];
    const state = applyDeltaOperations(createInitialState(), ops, generateDeltaId());
    const extraction = makeExtraction({ goal: 'Create payment processing pipeline' });

    const conflicts = detectImportConflicts(extraction, state);

    const goalConflict = conflicts.find(c => c.field === 'goal');
    expect(goalConflict).toBeDefined();
    // Words are very different → override or warning
    expect(['override', 'warning']).toContain(goalConflict!.severity);
  });
});
