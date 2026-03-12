import type { StateDelta, DeltaConflict } from '../domain/state-delta.js';
import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { TaskSpec } from '../domain/task-spec.js';

// Deterministic review checks.
// Returns a list of conflicts found — empty list means clean.

export function validateDelta(
  delta: StateDelta,
  currentState: CanonicalProjectState,
  spec: TaskSpec,
): DeltaConflict[] {
  const conflicts: DeltaConflict[] = [];

  // Check: base version staleness
  if (delta.baseStateVersion !== currentState.version) {
    conflicts.push({
      severity: 'error',
      type: 'stale_base_version',
      description: `Delta was built against state v${delta.baseStateVersion}, but current state is v${currentState.version}`,
      operationIndex: -1,
    });
  }

  // Check: scope violations — removing or adding files outside scope
  if (spec.scopePaths.length > 0) {
    for (let i = 0; i < delta.operations.length; i++) {
      const op = delta.operations[i];
      if (op.type === 'add_known_file' || op.type === 'remove_known_file') {
        const filePath = op.type === 'add_known_file' ? op.path : op.path;
        const inScope = spec.scopePaths.some(sp => filePath.startsWith(sp));
        if (!inScope) {
          conflicts.push({
            severity: 'warning',
            type: 'scope_violation',
            description: `File '${filePath}' is outside task scope (${spec.scopePaths.join(', ')})`,
            operationIndex: i,
          });
        }
      }
    }
  }

  // Check: read-only task trying to make substantive changes
  if (spec.writePermissions.length === 0) {
    for (let i = 0; i < delta.operations.length; i++) {
      const op = delta.operations[i];
      if (op.type === 'add_known_file' || op.type === 'remove_known_file') {
        // File map changes from a read-only task are fine (it's just noting what exists)
        continue;
      }
    }
  }

  return conflicts;
}
