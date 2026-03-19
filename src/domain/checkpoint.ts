import type { CheckpointId, StateVersion } from './ids.js';

export interface Checkpoint {
  id: CheckpointId;
  version: StateVersion;
  label: string;
  createdAt: string;
}
