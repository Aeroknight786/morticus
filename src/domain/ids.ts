// Branded ID types for type safety across the domain.
// Using branded types prevents passing a TaskId where a RunId is expected.

export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type RunId = string & { readonly __brand: 'RunId' };
export type SpecId = string & { readonly __brand: 'SpecId' };
export type DeltaId = string & { readonly __brand: 'DeltaId' };
export type EvidenceId = string & { readonly __brand: 'EvidenceId' };
export type MemoryEntryId = string & { readonly __brand: 'MemoryEntryId' };
export type ChatSessionId = string & { readonly __brand: 'ChatSessionId' };
export type ChatMessageId = string & { readonly __brand: 'ChatMessageId' };
export type CheckpointId = string & { readonly __brand: 'CheckpointId' };
export type ScratchpadId = string & { readonly __brand: 'ScratchpadId' };
export type ArchiveId = string & { readonly __brand: 'ArchiveId' };
export type MemCellId = string & { readonly __brand: 'MemCellId' };
// Global monotonic state version ID. Each version file on disk has a unique
// StateVersion. Values are never reused — after resuming from v1 when v3
// exists, the next version is v4, not v2. Assigned by StateStore.getNextVersion().
export type StateVersion = number;

let counter = 0;

function makeId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  counter++;
  return `${prefix}_${timestamp}${random}${counter.toString(36)}`;
}

export function generateProjectId(): ProjectId {
  return makeId('proj') as ProjectId;
}

export function generateTaskId(): TaskId {
  return makeId('task') as TaskId;
}

export function generateRunId(): RunId {
  return makeId('run') as RunId;
}

export function generateSpecId(): SpecId {
  return makeId('spec') as SpecId;
}

export function generateDeltaId(): DeltaId {
  return makeId('delta') as DeltaId;
}

export function generateEvidenceId(): EvidenceId {
  return makeId('ev') as EvidenceId;
}

export function generateMemoryEntryId(): MemoryEntryId {
  return makeId('mem') as MemoryEntryId;
}

export function generateChatSessionId(): ChatSessionId {
  return makeId('chat') as ChatSessionId;
}

export function generateChatMessageId(): ChatMessageId {
  return makeId('msg') as ChatMessageId;
}

export function generateCheckpointId(): CheckpointId {
  return makeId('ckpt') as CheckpointId;
}

export function generateScratchpadId(): ScratchpadId {
  return makeId('scratch') as ScratchpadId;
}

export function generateArchiveId(): ArchiveId {
  return makeId('arch') as ArchiveId;
}

export function generateMemCellId(): MemCellId {
  return makeId('mc') as MemCellId;
}

// Non-branded ID for suggested task lifecycle tracking.
export function generateSuggestionId(): string {
  return makeId('sug');
}
