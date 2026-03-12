import type { DeltaConflict } from '../domain/state-delta.js';

// STUB for Phase 1.
// In Phase 2, this will check:
// - Do claimed modified files actually have changes in git diff?
// - Do claimed new files exist?
// - Are there unstaged changes outside scope?

export async function reconcile(
  _repoPath: string,
  _operations: unknown[],
): Promise<DeltaConflict[]> {
  return [];
}
