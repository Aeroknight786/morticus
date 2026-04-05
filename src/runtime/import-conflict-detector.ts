// Pure function: detects conflicts between imported extraction and existing canonical state.
// No side effects, no LLM calls.

import type { ImportConflict, ConflictSeverity, ImportExtractionResult } from '../domain/import.js';
import type { CanonicalProjectState } from '../domain/canonical-state.js';

export function detectImportConflicts(
  extraction: ImportExtractionResult,
  currentState: CanonicalProjectState,
): ImportConflict[] {
  const conflicts: ImportConflict[] = [];
  const draft = extraction.draftState;
  if (!draft) return conflicts;

  // Scalar field conflicts
  if (draft.goal && currentState.goal && draft.goal !== currentState.goal) {
    conflicts.push({
      field: 'goal',
      existingValue: currentState.goal,
      importedValue: draft.goal,
      severity: scalarSeverity(currentState.goal, draft.goal),
      description: 'Project goal differs from existing state',
    });
  }

  if (draft.phase && currentState.phase && draft.phase !== currentState.phase) {
    conflicts.push({
      field: 'phase',
      existingValue: currentState.phase,
      importedValue: draft.phase,
      severity: 'warning',
      description: 'Project phase differs from existing state',
    });
  }

  if (draft.phaseGoal && currentState.phaseGoal && draft.phaseGoal !== currentState.phaseGoal) {
    conflicts.push({
      field: 'phaseGoal',
      existingValue: currentState.phaseGoal,
      importedValue: draft.phaseGoal,
      severity: 'info',
      description: 'Phase goal differs from existing state',
    });
  }

  if (draft.nextStep && currentState.nextStep && draft.nextStep !== currentState.nextStep) {
    conflicts.push({
      field: 'nextStep',
      existingValue: currentState.nextStep,
      importedValue: draft.nextStep,
      severity: 'info',
      description: 'Next step differs from existing state',
    });
  }

  // Array field conflicts: check for duplicates
  if (draft.constraints?.length) {
    const dupes = findArrayOverlaps(draft.constraints, currentState.constraints);
    if (dupes.length > 0) {
      conflicts.push({
        field: 'constraints',
        existingValue: dupes.join('; '),
        importedValue: dupes.join('; '),
        severity: 'info',
        description: `${dupes.length} imported constraint(s) already exist`,
      });
    }
  }

  if (draft.decisions?.length) {
    const dupes = findArrayOverlaps(draft.decisions, currentState.decisions);
    if (dupes.length > 0) {
      conflicts.push({
        field: 'decisions',
        existingValue: dupes.join('; '),
        importedValue: dupes.join('; '),
        severity: 'info',
        description: `${dupes.length} imported decision(s) already exist`,
      });
    }
  }

  if (draft.risks?.length) {
    const dupes = findArrayOverlaps(draft.risks, currentState.risks);
    if (dupes.length > 0) {
      conflicts.push({
        field: 'risks',
        existingValue: dupes.join('; '),
        importedValue: dupes.join('; '),
        severity: 'info',
        description: `${dupes.length} imported risk(s) already exist`,
      });
    }
  }

  return conflicts;
}

// Determine severity for scalar field conflicts.
function scalarSeverity(existing: string, imported: string): ConflictSeverity {
  // If the existing value is substantially different, it's a warning.
  // A complete replacement is an override.
  const overlap = computeWordOverlap(existing, imported);
  if (overlap < 0.2) return 'override';
  if (overlap < 0.6) return 'warning';
  return 'info';
}

// Simple word-overlap ratio between two strings.
function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

// Find exact-match duplicates between imported and existing arrays (case-insensitive).
function findArrayOverlaps(imported: string[], existing: string[]): string[] {
  const existingNorm = new Set(existing.map(s => s.toLowerCase().trim()));
  return imported.filter(s => existingNorm.has(s.toLowerCase().trim()));
}
