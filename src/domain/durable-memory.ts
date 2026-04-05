import { MemoryEntryId, MemCellId, TaskId, RunId, DeltaId, ArchiveId } from './ids.js';
import type { DeltaOperation } from './state-delta.js';

export type MemoryCategory =
  | 'coding_standard'
  | 'architecture_invariant'
  | 'environment_setup'
  | 'domain_glossary'
  | 'workflow_preference'
  | 'test_convention'
  | 'custom';

export type MemoryOrigin = 'user' | 'auto_extracted' | 'imported';

export type MemoryType = 'episodic' | 'event';

export type BoundaryReason =
  | 'task_completed'
  | 'review_accepted'
  | 'force_split'
  | 'topic_shift'
  | 'scratchpad_exit'
  | 'import_chunk';

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

  // Archive provenance — set when origin is 'imported'.
  sourceArchiveId: ArchiveId | null;

  // Link to the MemCell this entry was extracted from (null for legacy/user entries).
  memCellId: MemCellId | null;
}

export interface DurableMemory {
  version: number;
  entries: MemoryEntry[];
  updatedAt: string;
}

export interface MemCell {
  id: MemCellId;
  source: string;                     // e.g. "task:task_abc", "chat:session_xyz", "import:arch_123"
  boundaryReason: BoundaryReason;
  timestamp: string;                  // ISO 8601
  tokenCount: number;
  rawContent: string;                 // the interaction text that was chunked
  episodicSummary: string | null;     // filled by extraction
  events: string[];                   // atomic facts, filled by extraction
  relatedDecisionIds: string[];       // links to canonical state decisions
  relatedTaskIds: string[];           // links to tasks
  extracted: boolean;                 // false until LLM extraction runs
  createdAt: string;
  updatedAt: string;
}

export function createMemCell(
  id: MemCellId,
  source: string,
  boundaryReason: BoundaryReason,
  rawContent: string,
  tokenCount: number,
): MemCell {
  const now = new Date().toISOString();
  return {
    id,
    source,
    boundaryReason,
    timestamp: now,
    tokenCount,
    rawContent,
    episodicSummary: null,
    events: [],
    relatedDecisionIds: [],
    relatedTaskIds: [],
    extracted: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyMemory(): DurableMemory {
  return {
    version: 1,
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}
