// Transcript import and archive domain types.
// Pure domain — no VS Code or Node imports.

import type { ArchiveId, MemCellId } from './ids.js';
import type { DraftCanonicalState, DraftTask, DraftMemoryEntry } from './chat.js';

// ── Source classification ──

export type ImportSourceType = 'markdown_transcript' | 'text_chat_dump' | 'planning_doc' | 'claude_cli_jsonl';

export interface ImportSourceMeta {
  originalFileName: string;
  fileSize: number;
  lineCount: number;
  detectedFormat: ImportSourceType;
  detectedTurnCount: number; // 0 for planning docs
  estimatedTokens: number;
  importedAt: string;
}

// ── Chunks from deterministic parsing ──

export interface TranscriptChunk {
  kind: 'transcript';
  index: number;
  startLine: number;
  endLine: number;
  role: 'user' | 'assistant' | 'system' | 'unknown';
  content: string;
}

export interface DocSection {
  kind: 'doc';
  index: number;
  heading: string;
  level: number; // 1-6, 0 for preamble
  content: string;
  startLine: number;
  endLine: number;
}

export type ImportChunk = TranscriptChunk | DocSection;

// ── Extraction result (LLM output) ──

export interface ImportExtractionResult {
  draftState: DraftCanonicalState | null;
  candidateMemory: DraftMemoryEntry[];
  candidateTasks: DraftTask[];
  memCellIds: MemCellId[];
  summary: string;
  extractedAt: string;
  contextTokenEstimate: number;
}

// ── Conflict detection ──

export type ConflictSeverity = 'info' | 'warning' | 'override';

export interface ImportConflict {
  field: string;
  existingValue: string;
  importedValue: string;
  severity: ConflictSeverity;
  description: string;
}

// ── Archive record ──

export type ImportStatus = 'parsed' | 'extracting' | 'extracted' | 'reviewing' | 'completed' | 'failed';

export interface AcceptedItemRef {
  type: 'state' | 'memory' | 'task' | 'memcell';
  label: string;
  acceptedAt: string;
}

export interface ArchiveRecord {
  id: ArchiveId;
  sourceMeta: ImportSourceMeta;
  chunks: ImportChunk[];
  extraction: ImportExtractionResult | null;
  conflicts: ImportConflict[];
  status: ImportStatus;
  acceptedItems: AcceptedItemRef[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Factory ──

export function createArchiveRecord(
  id: ArchiveId,
  sourceMeta: ImportSourceMeta,
  chunks: ImportChunk[],
): ArchiveRecord {
  const now = new Date().toISOString();
  return {
    id,
    sourceMeta,
    chunks,
    extraction: null,
    conflicts: [],
    status: 'parsed',
    acceptedItems: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}
