// Extracts structured project data from parsed import chunks via Claude.
// Uses the same single-shot `runLlm()` pattern as the chat adapter.
// Reuses sanitizers from chat-adapter for defensive parsing.

import type { ImportChunk, TranscriptChunk, DocSection, ImportExtractionResult } from '../domain/import.js';
import type { DraftCanonicalState, DraftTask, DraftMemoryEntry } from '../domain/chat.js';
import type { MemCell } from '../domain/durable-memory.js';
import type { MemCellId } from '../domain/ids.js';
import { runLlm } from './llm-provider.js';
import { createAndExtractMemCell, shouldForceSplit } from './memory-extractor.js';
import { sanitizeDraftState, sanitizeDraftTask, sanitizeDraftMemoryEntry } from './chat-adapter.js';
import { MorticusError } from '../domain/errors.js';

const IMPORT_START_MARKER = '---MORTICUS-IMPORT-START---';
const IMPORT_END_MARKER = '---MORTICUS-IMPORT-END---';

export interface ParsedImportExtraction {
  draftState: DraftCanonicalState | null;
  candidateMemory: DraftMemoryEntry[];
  candidateTasks: DraftTask[];
  summary: string;
}

// Estimated tokens per chunk (chars / 4).
function estimateChunkTokens(chunks: ImportChunk[]): number {
  return Math.ceil(chunks.reduce((sum, c) => sum + c.content.length, 0) / 4);
}

// Format chunks for inclusion in the extraction prompt.
function formatChunksForPrompt(chunks: ImportChunk[]): string {
  return chunks.map(chunk => {
    if (chunk.kind === 'transcript') {
      const tc = chunk as TranscriptChunk;
      return `[${tc.role.toUpperCase()} — lines ${tc.startLine}–${tc.endLine}]\n${tc.content}`;
    }
    const ds = chunk as DocSection;
    const heading = ds.heading ? `${'#'.repeat(ds.level)} ${ds.heading}` : '(preamble)';
    return `[DOC SECTION — ${heading} — lines ${ds.startLine}–${ds.endLine}]\n${ds.content}`;
  }).join('\n\n---\n\n');
}

// Build the extraction prompt for Claude.
function buildExtractionPrompt(chunks: ImportChunk[], summary?: string): string {
  const contextNote = summary
    ? `\nPrior extraction summary (from an earlier pass):\n${summary}\n\nFocus on NEW information not already captured.\n`
    : '';

  const formattedContent = formatChunksForPrompt(chunks);

  return `You are Morticus, extracting structured project data from a prior transcript or document.

Extract ONLY what IS explicitly present — do not invent or infer information that isn't stated.
Focus on CONCLUSIONS and DECISIONS, not exploration or questions.
${contextNote}
SOURCE CONTENT:
${formattedContent}

Output your extraction between the markers below. The JSON must be valid.

${IMPORT_START_MARKER}
{
  "draftState": {
    "goal": "<project goal if stated, or null>",
    "phase": "<current phase if stated, or null>",
    "phaseGoal": "<phase goal if stated, or null>",
    "constraints": ["<specific, actionable constraints found>"],
    "decisions": ["<final decisions made, not questions debated>"],
    "risks": ["<identified risks>"],
    "knownFiles": ["<file paths mentioned>"],
    "nextStep": "<next step if stated, or null>"
  },
  "candidateMemory": [
    { "category": "<coding_standard|architecture_invariant|environment_setup|domain_glossary|workflow_preference|test_convention|custom>", "title": "<short title>", "content": "<full content>" }
  ],
  "candidateTasks": [
    { "title": "<task title>", "goal": "<task goal>", "taskType": "<discovery|implementation|validation>", "scopePaths": ["<relevant paths>"] }
  ],
  "summary": "<1-3 sentence description of what was found>"
}
${IMPORT_END_MARKER}

Guidelines:
- Constraints must be specific and actionable (not generic like "write good code")
- Decisions are final choices made (not questions still being debated)
- Memory entries: coding standards, architecture decisions, domain terms — one per entry
- Tasks: uncompleted work items, next steps, TODOs mentioned
- If nothing found for a field, use null (scalars) or empty array (arrays)
- Do not duplicate information across draftState and candidateMemory`;
}

// Parse the structured extraction result from Claude's response.
export function parseExtractionResponse(response: string): {
  draftState: DraftCanonicalState | null;
  candidateMemory: DraftMemoryEntry[];
  candidateTasks: DraftTask[];
  summary: string;
} {
  const startIdx = response.indexOf(IMPORT_START_MARKER);
  const endIdx = response.indexOf(IMPORT_END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Try to find JSON block without markers
    const jsonMatch = response.match(/\{[\s\S]*"draftState"[\s\S]*\}/);
    if (!jsonMatch) {
      return { draftState: null, candidateMemory: [], candidateTasks: [], summary: '' };
    }
    return parseJsonBlock(jsonMatch[0]);
  }

  const jsonBlock = response.slice(startIdx + IMPORT_START_MARKER.length, endIdx).trim();
  return parseJsonBlock(jsonBlock);
}

function parseJsonBlock(jsonBlock: string): ParsedImportExtraction {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return { draftState: null, candidateMemory: [], candidateTasks: [], summary: '' };
  }

  // Sanitize draft state
  let draftState: DraftCanonicalState | null = null;
  if (parsed.draftState && typeof parsed.draftState === 'object') {
    const sanitized = sanitizeDraftState(parsed.draftState as Record<string, unknown>);
    // Check if it has any actual content
    if (Object.keys(sanitized).length > 0) {
      draftState = sanitized;
    }
  }

  // Sanitize candidate memory
  const candidateMemory: DraftMemoryEntry[] = [];
  if (Array.isArray(parsed.candidateMemory)) {
    for (const raw of parsed.candidateMemory) {
      if (raw && typeof raw === 'object') {
        const entry = sanitizeDraftMemoryEntry(raw as Record<string, unknown>);
        if (entry) candidateMemory.push(entry);
      }
    }
  }

  // Sanitize candidate tasks
  const candidateTasks: DraftTask[] = [];
  if (Array.isArray(parsed.candidateTasks)) {
    for (const raw of parsed.candidateTasks) {
      if (raw && typeof raw === 'object') {
        const task = sanitizeDraftTask(raw as Record<string, unknown>);
        if (task) candidateTasks.push(task);
      }
    }
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';

  return { draftState, candidateMemory, candidateTasks, summary };
}

function mergeUniqueStrings(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const value of [...(existing ?? []), ...(incoming ?? [])]) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(value);
  }

  return merged.length > 0 ? merged : undefined;
}

export function mergeExtractionResults(
  current: ParsedImportExtraction,
  incoming: ParsedImportExtraction,
): ParsedImportExtraction {
  const mergedState = current.draftState || incoming.draftState
    ? {
        goal: current.draftState?.goal || incoming.draftState?.goal,
        phase: current.draftState?.phase || incoming.draftState?.phase,
        phaseGoal: current.draftState?.phaseGoal || incoming.draftState?.phaseGoal,
        constraints: mergeUniqueStrings(current.draftState?.constraints, incoming.draftState?.constraints),
        decisions: mergeUniqueStrings(current.draftState?.decisions, incoming.draftState?.decisions),
        risks: mergeUniqueStrings(current.draftState?.risks, incoming.draftState?.risks),
        knownFiles: mergeUniqueStrings(current.draftState?.knownFiles, incoming.draftState?.knownFiles),
        nextStep: current.draftState?.nextStep || incoming.draftState?.nextStep,
      }
    : null;

  const summaryParts = [current.summary, incoming.summary].filter(Boolean);

  return {
    draftState: mergedState && Object.keys(mergedState).some(key => {
      const value = mergedState[key as keyof DraftCanonicalState];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }) ? mergedState : null,
    candidateMemory: [...current.candidateMemory, ...incoming.candidateMemory],
    candidateTasks: [...current.candidateTasks, ...incoming.candidateTasks],
    summary: summaryParts.join(' ').trim(),
  };
}

// ── MemCell extraction from import chunks ──

const MEMCELL_TOKEN_LIMIT = 8192;
const MEMCELL_MESSAGE_LIMIT = 50;

export function groupChunksIntoWindows(chunks: TranscriptChunk[]): TranscriptChunk[][] {
  const windows: TranscriptChunk[][] = [];
  let current: TranscriptChunk[] = [];
  let currentTokens = 0;
  let currentMessages = 0;

  for (const chunk of chunks) {
    const chunkTokens = Math.ceil(chunk.content.length / 4);

    if (current.length > 0 && shouldForceSplit(currentTokens + chunkTokens, currentMessages + 1)) {
      windows.push(current);
      current = [];
      currentTokens = 0;
      currentMessages = 0;
    }

    current.push(chunk);
    currentTokens += chunkTokens;
    currentMessages += 1;
  }

  if (current.length > 0) {
    windows.push(current);
  }

  return windows;
}

export async function extractImportMemCells(
  chunks: TranscriptChunk[],
  source: string,
  workingDirectory: string,
): Promise<MemCell[]> {
  const windows = groupChunksIntoWindows(chunks);
  const cells: MemCell[] = [];

  const defaultContext = {
    goal: 'Imported transcript',
    phase: 'import',
    decisions: [],
  };

  for (const window of windows) {
    const rawContent = window.map(c => `[${c.role}]: ${c.content}`).join('\n');
    try {
      const cell = await createAndExtractMemCell(
        source,
        'import_chunk',
        rawContent,
        defaultContext,
        { workingDirectory },
      );
      cells.push(cell);
    } catch {
      // Skip failed extractions — don't block the entire import
    }
  }

  return cells;
}

// Token budget for a single Claude extraction call.
const MAX_EXTRACTION_TOKENS = 30_000;

// Select chunks for extraction, applying the bookend strategy for large transcripts.
export function selectChunksForExtraction(
  chunks: ImportChunk[],
  maxTokens: number = MAX_EXTRACTION_TOKENS,
): { primary: ImportChunk[]; overflow: ImportChunk[] } {
  if (chunks.length === 0) {
    return { primary: [], overflow: [] };
  }

  const totalTokens = estimateChunkTokens(chunks);
  if (totalTokens <= maxTokens) {
    return { primary: chunks, overflow: [] };
  }

  // Bookend strategy: take from beginning and end
  const halfBudget = Math.floor(maxTokens / 2);
  const primary: ImportChunk[] = [];
  const overflow: ImportChunk[] = [];

  let headTokens = 0;
  let headEnd = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkTokens = Math.ceil(chunks[i].content.length / 4);
    if (headTokens + chunkTokens > halfBudget) break;
    headTokens += chunkTokens;
    headEnd = i + 1;
  }

  let tailTokens = 0;
  let tailStart = chunks.length;
  for (let i = chunks.length - 1; i >= headEnd; i--) {
    const chunkTokens = Math.ceil(chunks[i].content.length / 4);
    if (tailTokens + chunkTokens > halfBudget) break;
    tailTokens += chunkTokens;
    tailStart = i;
  }

  if (headEnd === 0 && tailStart === chunks.length) {
    return {
      primary: [chunks[0]],
      overflow: chunks.slice(1),
    };
  }

  primary.push(...chunks.slice(0, headEnd));
  primary.push(...chunks.slice(tailStart));

  if (headEnd < tailStart) {
    overflow.push(...chunks.slice(headEnd, tailStart));
  }

  return { primary, overflow };
}

export interface ExtractFromTranscriptOutput {
  result: ImportExtractionResult;
  extractedMemCells: MemCell[];
}

// Main extraction entry point.
export async function extractFromTranscript(
  chunks: ImportChunk[],
  workingDirectory: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ExtractFromTranscriptOutput> {
  let remaining = chunks;
  let aggregate: ParsedImportExtraction = {
    draftState: null,
    candidateMemory: [],
    candidateTasks: [],
    summary: '',
  };
  let priorSummary: string | undefined;
  let contextTokenEstimate = 0;
  let passIndex = 0;

  while (remaining.length > 0) {
    const { primary, overflow } = selectChunksForExtraction(remaining);
    if (primary.length === 0) break;

    if (passIndex === 0) {
      contextTokenEstimate = estimateChunkTokens(primary);
    } else {
      contextTokenEstimate = Math.max(contextTokenEstimate, estimateChunkTokens(primary));
    }

    const prompt = buildExtractionPrompt(primary, priorSummary);
    let result;
    try {
      result = await runLlm(prompt, {
        workingDirectory,
        timeoutMs: options?.timeoutMs ?? 120_000,
        signal: options?.signal,
      });
    } catch (err) {
      if (passIndex === 0) {
        throw new MorticusError(
          `Import extraction failed: ${(err as Error).message}`,
          'IMPORT_EXTRACTION_ERROR',
          { cause: (err as Error).message },
        );
      }
      break;
    }

    if (result.timedOut) {
      if (passIndex === 0) {
        throw new MorticusError(
          'Import extraction timed out',
          'IMPORT_EXTRACTION_ERROR',
        );
      }
      break;
    }

    const parsed = parseExtractionResponse(result.stdout);
    aggregate = mergeExtractionResults(aggregate, parsed);
    if (aggregate.summary) {
      priorSummary = aggregate.summary;
    } else if (parsed.summary) {
      priorSummary = parsed.summary;
    }

    remaining = overflow;
    passIndex += 1;
  }

  // Pass B: MemCell extraction from transcript chunks
  const transcriptChunks = chunks.filter(
    (c): c is TranscriptChunk => c.kind === 'transcript',
  );
  let extractedCells: MemCell[] = [];
  if (transcriptChunks.length > 0) {
    try {
      const source = `import:extraction`;
      extractedCells = await extractImportMemCells(
        transcriptChunks,
        source,
        workingDirectory,
      );
    } catch {
      // MemCell extraction is best-effort — don't fail the import
    }
  }

  return {
    result: {
      draftState: aggregate.draftState,
      candidateMemory: aggregate.candidateMemory,
      candidateTasks: aggregate.candidateTasks,
      memCellIds: extractedCells.map(c => c.id),
      summary: aggregate.summary,
      extractedAt: new Date().toISOString(),
      contextTokenEstimate,
    },
    extractedMemCells: extractedCells,
  };
}
