// Resume orchestrator: repoints the current state pointer to a historical version
// and archives all non-terminal tasks. Does NOT create a new version — subsequent
// deltas applied via delta-applier will use StateStore.getNextVersion() to assign
// a globally unique version number, with parentVersion pointing to the resumed target.
//
// This is checkpoint+resume, not git-style branching. There are no named branches,
// no merge operations, and no divergent branch tracking. The version history forms
// a DAG via parentVersion, but there is no UI to visualize or navigate that DAG yet.

import type { ProjectStore } from '../storage/store.js';
import type { StateVersion, TaskId } from '../domain/ids.js';
import { transitionTask } from '../domain/task.js';

export interface ResumeResult {
  resumedToVersion: StateVersion;
  archivedTaskIds: TaskId[];
}

export async function resumeFromVersion(
  store: ProjectStore,
  targetVersion: StateVersion,
): Promise<ResumeResult> {
  // Verify target version exists (throws if not found)
  await store.state.getVersion(targetVersion);

  // Archive all non-terminal tasks
  const allTasks = await store.tasks.list();
  const archivedIds: TaskId[] = [];
  const terminalStatuses = new Set<string>(['merged', 'rejected', 'archived']);

  for (const task of allTasks) {
    if (!terminalStatuses.has(task.status)) {
      const archived = transitionTask(task, 'archived');
      await store.tasks.save(archived);
      archivedIds.push(task.id);
    }
  }

  // Repoint current version
  await store.state.setCurrentVersion(targetVersion);

  return {
    resumedToVersion: targetVersion,
    archivedTaskIds: archivedIds,
  };
}
