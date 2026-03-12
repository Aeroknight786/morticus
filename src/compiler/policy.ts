import type { TaskType, WritePermission } from '../domain/task.js';

// Deterministic policy rules for task permissions based on task type.
// No LLM involvement — pure mapping from type to allowed capabilities.

export interface PolicyResult {
  readOnly: boolean;
  writePermissions: WritePermission[];
  allowedTools: string[];
}

export function resolvePolicy(taskType: TaskType): PolicyResult {
  switch (taskType) {
    case 'discovery':
      return {
        readOnly: true,
        writePermissions: [],
        allowedTools: ['read', 'grep', 'glob', 'bash_readonly'],
      };
    case 'implementation':
      return {
        readOnly: false,
        writePermissions: ['create_files', 'modify_files', 'delete_files', 'run_commands', 'run_tests'],
        allowedTools: ['read', 'write', 'edit', 'grep', 'glob', 'bash', 'test'],
      };
    case 'validation':
      return {
        readOnly: true,
        writePermissions: ['run_tests'],
        allowedTools: ['read', 'grep', 'glob', 'bash_readonly', 'test'],
      };
  }
}
