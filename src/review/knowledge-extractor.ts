import type { DeltaOperation } from '../domain/state-delta.js';
import type { MemoryEntry } from '../domain/durable-memory.js';
import type { TaskId, RunId, DeltaId } from '../domain/ids.js';
import { generateMemoryEntryId } from '../domain/ids.js';

// Deterministic knowledge extraction from accepted delta operations.
// V1: extracts decisions only, maps to 'architecture_invariant'.
// No LLM involvement. Runs after delta accept.
//
// Auto-extracted entries default to active: false, reviewed: false.
// They do NOT influence future context packs until the user explicitly
// reviews and activates them.

export function extractKnowledge(
  operations: DeltaOperation[],
  taskTitle: string,
  taskId: TaskId,
  runId: RunId | null,
  deltaId: DeltaId,
): MemoryEntry[] {
  const now = new Date().toISOString();
  const entries: MemoryEntry[] = [];

  for (const op of operations) {
    if (op.type !== 'add_decision') continue;

    entries.push({
      id: generateMemoryEntryId(),
      category: 'architecture_invariant',
      title: op.value.length > 80 ? op.value.slice(0, 77) + '...' : op.value,
      content: `${op.value}\n\nSource: task "${taskTitle}"`,
      normalizedValue: op.value,
      origin: 'auto_extracted',
      active: false,
      reviewed: false,
      sourceTaskId: taskId,
      sourceRunId: runId,
      sourceDeltaId: deltaId,
      sourceOperationType: 'add_decision',
      createdAt: now,
      updatedAt: now,
    });
  }

  return entries;
}

// Dedup extracted entries against existing memory.
// Checks category + normalizedValue (not content, which includes variable attribution).
export function deduplicateEntries(
  candidates: MemoryEntry[],
  existing: MemoryEntry[],
): MemoryEntry[] {
  return candidates.filter(candidate => {
    if (!candidate.normalizedValue) return true;
    return !existing.some(
      e => e.category === candidate.category &&
           e.normalizedValue === candidate.normalizedValue,
    );
  });
}
