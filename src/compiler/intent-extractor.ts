import type { TaskIntent } from '../domain/task-spec.js';
import type { WritePermission } from '../domain/task.js';

// STUB: In Phase 1, the user fills in TaskIntent fields manually via UI.
// In Phase 2, this will call Claude to extract intent from natural language.

export function createManualIntent(
  title: string,
  goal: string,
  taskType: 'discovery' | 'implementation' | 'validation',
  scopePaths: string[],
): TaskIntent {
  const permissions: WritePermission[] = taskType === 'implementation'
    ? ['create_files', 'modify_files', 'run_commands', 'run_tests']
    : taskType === 'validation'
      ? ['run_tests']
      : [];

  return {
    title,
    goal,
    suggestedType: taskType,
    suggestedScope: scopePaths,
    suggestedPermissions: permissions,
    userRequest: goal,
  };
}
