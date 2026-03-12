import * as child_process from 'node:child_process';
import * as path from 'node:path';
import { MorticusError } from '../domain/errors.js';

export interface WorktreeResult {
  path: string | null;
  branch: string | null;
}

// Creates a git worktree for implementation tasks (readOnly=false).
// Read-only tasks (discovery, validation) return null — they run in-place.
// The worktree is isolated on its own branch so file changes don't affect the main workspace.
export async function prepareWorktree(
  workspaceRoot: string,
  runId: string,
  readOnly: boolean,
): Promise<WorktreeResult> {
  if (readOnly) {
    return { path: null, branch: null };
  }

  // Verify this is a git repo
  try {
    child_process.execSync('git rev-parse --git-dir', {
      cwd: workspaceRoot,
      stdio: 'ignore',
    });
  } catch {
    throw new MorticusError(
      'Workspace is not a git repository. Git worktrees require a git repo for implementation tasks.',
      'WORKTREE_ERROR',
      { workspaceRoot },
    );
  }

  const branchName = `morticus/run-${runId}`;
  const worktreePath = path.join(workspaceRoot, '.morticus', 'worktrees', runId);

  try {
    child_process.execSync(
      `git worktree add -b "${branchName}" "${worktreePath}" HEAD`,
      { cwd: workspaceRoot, stdio: 'pipe' },
    );
  } catch (err) {
    throw new MorticusError(
      `Failed to create git worktree: ${(err as Error).message}`,
      'WORKTREE_ERROR',
      { branchName, worktreePath },
    );
  }

  return { path: worktreePath, branch: branchName };
}

// Removes the git worktree and deletes the branch.
// Non-fatal: logs on failure rather than throwing, so a cleanup error never
// blocks the review flow.
export async function cleanupWorktree(
  workspaceRoot: string,
  worktreePath: string,
): Promise<void> {
  try {
    child_process.execSync(
      `git worktree remove --force "${worktreePath}"`,
      { cwd: workspaceRoot, stdio: 'pipe' },
    );
  } catch (err) {
    // Non-fatal — the worktree may already be cleaned up or the path invalid.
    console.warn(`[morticus] worktree cleanup warning: ${(err as Error).message}`);
  }
}
