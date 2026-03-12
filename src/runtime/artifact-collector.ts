import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ArtifactCollection {
  gitDiff: string | null;
  changedFiles: string[];
  artifactPaths: string[];
}

// Captures artifacts after a task run completes.
// For read-only tasks (worktreePath === null): returns empty collection.
// For implementation tasks: captures the git diff from the worktree.
//
// STUB Phase 3: test runner collection (TestRequirement commands) not yet implemented.
export async function collectArtifacts(
  workspaceRoot: string,
  worktreePath: string | null,
  runArtifactDir: string,
  runId: string,
): Promise<ArtifactCollection> {
  // Read-only runs produce no file changes
  if (!worktreePath) {
    return { gitDiff: null, changedFiles: [], artifactPaths: [] };
  }

  let gitDiff: string | null = null;
  let changedFiles: string[] = [];
  const artifactPaths: string[] = [];

  try {
    gitDiff = child_process
      .execSync('git diff HEAD', { cwd: worktreePath, encoding: 'utf8' })
      .trim();

    const changedOutput = child_process
      .execSync('git diff --name-only HEAD', { cwd: worktreePath, encoding: 'utf8' })
      .trim();
    changedFiles = changedOutput ? changedOutput.split('\n').filter(Boolean) : [];
  } catch {
    // Not fatal — diff may fail if there are no commits yet in the worktree
    gitDiff = null;
    changedFiles = [];
  }

  // Persist the diff as a patch file
  if (gitDiff) {
    try {
      await fs.promises.mkdir(runArtifactDir, { recursive: true });
      const patchPath = path.join(runArtifactDir, 'diff.patch');
      await fs.promises.writeFile(patchPath, gitDiff, 'utf8');
      artifactPaths.push(patchPath);
    } catch {
      // Non-fatal — patch file is best-effort
    }
  }

  // STUB Phase 3: run test commands from TaskSpec.testRequirements and capture output
  // For now, return empty test results.

  return { gitDiff, changedFiles, artifactPaths };
}
