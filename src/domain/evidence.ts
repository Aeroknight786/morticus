import { EvidenceId, RunId, TaskId } from './ids.js';

export type EvidenceType =
  | 'file_ref'
  | 'diff_ref'
  | 'test_output'
  | 'command_output'
  | 'task_message'
  | 'run_artifact';

export interface EvidenceRef {
  id: EvidenceId;
  type: EvidenceType;
  taskId: TaskId;
  runId: RunId | null;
  locator: string;
  description: string;
  createdAt: string;
}
