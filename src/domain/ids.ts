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

// Non-branded ID for suggested task lifecycle tracking.
export function generateSuggestionId(): string {
  return makeId('sug');
}
