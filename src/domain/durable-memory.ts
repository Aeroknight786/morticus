import { MemoryEntryId, TaskId, RunId, DeltaId } from './ids.js';
import type { DeltaOperation } from './state-delta.js';

export type MemoryCategory =
  | 'coding_standard'
  | 'architecture_invariant'
  | 'environment_setup'
  | 'domain_glossary'
  | 'workflow_preference'
  | 'test_convention'
  | 'custom';

export type MemoryOrigin = 'user' | 'auto_extracted';

export interface MemoryEntry {
  id: MemoryEntryId;
  category: MemoryCategory;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;

  // Provenance — where did this entry come from?
  origin: MemoryOrigin;
  sourceTaskId: TaskId | null;
  sourceRunId: RunId | null;
  sourceDeltaId: DeltaId | null;
  sourceOperationType: DeltaOperation['type'] | null;

  // Review status for auto-extracted entries.
  // Auto-extracted entries start as reviewed: false, active: false.
  // The active toggle is disabled until reviewed === true.
  reviewed: boolean;

  // Raw value for deduplication (before source attribution is appended to content).
  // null for user-created entries. Dedup checks category + normalizedValue.
  normalizedValue: string | null;
}

export interface DurableMemory {
  version: number;
  entries: MemoryEntry[];
  updatedAt: string;
}

export function createEmptyMemory(): DurableMemory {
  return {
    version: 1,
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}
