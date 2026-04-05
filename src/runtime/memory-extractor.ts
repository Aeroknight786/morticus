// MemCell extraction: boundary detection + LLM-based memory extraction.
// Single LLM call per MemCell produces episodic summary + atomic events.
// Adapted from EverMemOS (Apache 2.0) — see THIRD_PARTY_NOTICES.md.

import type { MemCell, BoundaryReason } from '../domain/durable-memory.js';
import { createMemCell } from '../domain/durable-memory.js';
import { generateMemCellId } from '../domain/ids.js';
import { runLlm } from './llm-provider.js';

// ── Extraction result ──

export interface MemCellExtractionResult {
  episodicSummary: string;
  events: string[];
  relatedDecisionIds: string[];
}

// ── Extraction prompt markers ──

const EXTRACT_START_MARKER = '---MEMCELL-EXTRACT-START---';
const EXTRACT_END_MARKER = '---MEMCELL-EXTRACT-END---';

// ── Force-split thresholds ──

const MAX_TOKENS = 8192;
const MAX_MESSAGES = 50;

export function shouldForceSplit(tokenCount: number, messageCount: number): boolean {
  return tokenCount >= MAX_TOKENS || messageCount >= MAX_MESSAGES;
}

// ── Extraction prompt builder ──

export interface ProjectContext {
  goal: string;
  phase: string;
  decisions: string[];
}

function buildExtractionPrompt(rawContent: string, context: ProjectContext): string {
  const decisionsBlock = context.decisions.length > 0
    ? context.decisions.map(d => `  - ${d}`).join('\n')
    : '  (none)';

  return `You are extracting structured memory from a chunk of project interaction.

Project context:
- Goal: ${context.goal}
- Phase: ${context.phase}
- Existing decisions:
${decisionsBlock}

Interaction content:
${rawContent}

Extract:
1. An episodic summary (2-4 sentences, third person, factual narrative of what happened)
2. Atomic event facts (each a single coherent unit — one decision, one constraint, one convention)

Rules:
- Extract ONLY what IS present — do not invent
- Each atomic fact must state WHO decided/said/did WHAT
- Resolve relative references ("this file", "the function") to specific names where possible
- Filter out greetings, acknowledgments, and phatic communication
- If a fact matches an existing decision, note the decision text

Output between markers:
${EXTRACT_START_MARKER}
{
  "episodicSummary": "...",
  "events": ["...", "..."],
  "relatedDecisions": ["exact text of matching decisions"]
}
${EXTRACT_END_MARKER}`;
}

// ── Response parser ──

export function parseExtractionResponse(raw: string): MemCellExtractionResult {
  const startIdx = raw.indexOf(EXTRACT_START_MARKER);
  const endIdx = raw.indexOf(EXTRACT_END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    return { episodicSummary: '', events: [], relatedDecisionIds: [] };
  }

  const jsonStr = raw.slice(startIdx + EXTRACT_START_MARKER.length, endIdx).trim();
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      episodicSummary: typeof parsed.episodicSummary === 'string' ? parsed.episodicSummary : '',
      events: Array.isArray(parsed.events)
        ? parsed.events.filter((e: unknown): e is string => typeof e === 'string')
        : [],
      relatedDecisionIds: Array.isArray(parsed.relatedDecisions)
        ? parsed.relatedDecisions.filter((d: unknown): d is string => typeof d === 'string')
        : [],
    };
  } catch {
    return { episodicSummary: '', events: [], relatedDecisionIds: [] };
  }
}

// ── Extract from raw content via LLM ──

export async function extractMemCell(
  rawContent: string,
  projectContext: ProjectContext,
  config: { workingDirectory: string; timeoutMs?: number },
): Promise<MemCellExtractionResult> {
  const prompt = buildExtractionPrompt(rawContent, projectContext);
  const result = await runLlm(prompt, {
    workingDirectory: config.workingDirectory,
    timeoutMs: config.timeoutMs ?? 120_000,
  });
  return parseExtractionResponse(result.stdout);
}

// ── Create + extract in one step ──

export async function createAndExtractMemCell(
  source: string,
  boundaryReason: BoundaryReason,
  rawContent: string,
  projectContext: ProjectContext,
  config: { workingDirectory: string; timeoutMs?: number },
): Promise<MemCell> {
  const id = generateMemCellId();
  const tokenCount = Math.ceil(rawContent.length / 4);
  const cell = createMemCell(id, source, boundaryReason, rawContent, tokenCount);

  const extraction = await extractMemCell(rawContent, projectContext, config);

  return {
    ...cell,
    episodicSummary: extraction.episodicSummary || null,
    events: extraction.events,
    relatedDecisionIds: extraction.relatedDecisionIds,
    extracted: true,
    updatedAt: new Date().toISOString(),
  };
}
