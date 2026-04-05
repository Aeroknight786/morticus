import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { DurableMemory, MemoryEntry } from '../domain/durable-memory.js';
import type { ChatMessage } from '../domain/chat.js';
import type { ScratchpadHandoff } from '../domain/scratchpad.js';
import { parseScratchpadHandoff } from '../domain/scratchpad.js';
import { buildStateSummary, formatMessages, type ChatAdapterOptions } from './chat-adapter.js';
import { runLlm } from './llm-provider.js';
import { resolveContextProfile } from '../domain/context-policy.js';

// Scratchpad adapter: separate from the main chat adapter.
// Normal turns produce response-only output (no mutation parsing).
// Handoff turns produce a structured ScratchpadHandoff.

const HANDOFF_START_MARKER = '---MORTICUS-SCRATCHPAD-HANDOFF-START---';
const HANDOFF_END_MARKER = '---MORTICUS-SCRATCHPAD-HANDOFF-END---';

function buildScratchpadSystemPrompt(parentContextSummary: string, stateSummary: string): string {
  return `You are Morticus, operating in Scratchpad Mode. This is a temporary, exploratory side-space for brainstorming, research, and free-form thinking.

## Context (inherited from parent chat)
${parentContextSummary}

## Current Project State
${stateSummary}

Rules:
- This is exploratory. Think freely, suggest ideas, analyze trade-offs, explore alternatives.
- You CANNOT create tasks, modify project state, or add memory entries from here. Those actions happen after the user returns to the main chat via a structured handoff.
- Focus on depth of analysis rather than action proposals.
- When the user is done exploring, they will click "End Scratchpad" and you will be asked to produce a structured handoff summary.`;
}

function buildHandoffPrompt(parentContextSummary: string, stateSummary: string): string {
  return `You are Morticus, operating in Scratchpad Mode. The user has finished exploring and needs a structured handoff summary.

## Context (inherited from parent chat)
${parentContextSummary}

## Current Project State
${stateSummary}

Review the entire conversation above and produce a structured handoff. This handoff will be the ONLY thing that returns to the main chat — the raw transcript stays in the scratchpad.

Output the handoff between these markers:

${HANDOFF_START_MARKER}
{
  "summary": "1-3 sentence distillation of what was explored and concluded",
  "keyFindings": ["concrete discovery or conclusion 1", "..."],
  "unresolvedQuestions": ["open thread or question 1", "..."],
  "candidateTask": null,
  "candidateDelta": null
}
${HANDOFF_END_MARKER}

Field details:
- summary: Brief distillation of the exploration. Focus on conclusions, not process.
- keyFindings: Concrete discoveries, decisions, or conclusions reached. Be specific.
- unresolvedQuestions: Open threads that need further work. Be specific.
- candidateTask: If the exploration surfaced work that should be done, suggest a task: { "title": "", "goal": "", "taskType": "discovery"|"implementation"|"validation", "scopePaths": [] }. Set to null if no task emerged.
- candidateDelta: If the exploration surfaced state changes worth proposing, include them: { "operations": [{ "type": "add_decision", "value": "..." }], "rationale": "why" }. Valid operation types: add_constraint, remove_constraint, add_decision, remove_decision, add_risk, remove_risk, set_goal, set_phase, set_next_step, set_phase_goal, add_phase_exit_criterion, remove_phase_exit_criterion, clear_phase_exit_criteria. Set to null if no state changes emerged.

Be honest about what was actually explored. Do not invent findings that weren't discussed.`;
}

// Normal exploratory turn — response only, no structured output parsing.
export async function sendScratchpadTurn(
  messages: ChatMessage[],
  parentContextSummary: string,
  state: CanonicalProjectState | null,
  memory: DurableMemory,
  options: ChatAdapterOptions,
): Promise<{ response: string }> {
  const profile = resolveContextProfile('scratchpad');
  const stateSummary = state ? buildStateSummary(state) : 'No canonical state yet.';
  const sections: string[] = [
    buildScratchpadSystemPrompt(parentContextSummary, stateSummary),
  ];

  // Memory context with profile-driven limit
  let active: MemoryEntry[] = memory.entries.filter(e => e.active);
  if (profile.memorySlice.maxEntries !== null && active.length > profile.memorySlice.maxEntries) {
    active = active.slice(0, profile.memorySlice.maxEntries);
  }
  if (active.length > 0) {
    const lines = active.map(e => `[${e.category}] ${e.title}: ${e.content}`);
    sections.push(`## Project Memory\n\n${lines.join('\n\n')}`);
  }

  if (messages.length > 0) {
    sections.push(`## Conversation\n\n${formatMessages(messages)}`);
  }

  const prompt = sections.join('\n\n');
  const result = await runLlm(prompt, {
    workingDirectory: options.workingDirectory,
    timeoutMs: options.timeoutMs ?? 120_000,
    signal: options.signal,
  });

  return { response: result.stdout.trim() || '(No response)' };
}

// Exit turn — requests and parses structured handoff.
export async function requestScratchpadHandoff(
  messages: ChatMessage[],
  parentContextSummary: string,
  state: CanonicalProjectState | null,
  memory: DurableMemory,
  options: ChatAdapterOptions,
): Promise<ScratchpadHandoff> {
  const stateSummary = state ? buildStateSummary(state) : 'No canonical state yet.';
  const sections: string[] = [
    buildHandoffPrompt(parentContextSummary, stateSummary),
  ];

  if (messages.length > 0) {
    sections.push(`## Scratchpad Conversation\n\n${formatMessages(messages)}`);
  }

  const prompt = sections.join('\n\n');
  const result = await runLlm(prompt, {
    workingDirectory: options.workingDirectory,
    timeoutMs: options.timeoutMs ?? 120_000,
    signal: options.signal,
  });

  return parseScratchpadHandoffResponse(result.stdout);
}

export function parseScratchpadHandoffResponse(raw: string): ScratchpadHandoff {
  const startIdx = raw.indexOf(HANDOFF_START_MARKER);
  const endIdx = raw.indexOf(HANDOFF_END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    // No markers — generate a minimal handoff from the raw response
    return {
      summary: raw.trim().slice(0, 500) || 'Scratchpad session ended without structured handoff.',
      keyFindings: [],
      unresolvedQuestions: [],
    };
  }

  const jsonStr = raw.slice(startIdx + HANDOFF_START_MARKER.length, endIdx).trim();
  try {
    const parsed = JSON.parse(jsonStr);
    return parseScratchpadHandoff(parsed);
  } catch {
    return {
      summary: 'Failed to parse handoff. Raw output preserved in scratchpad.',
      keyFindings: [],
      unresolvedQuestions: [],
    };
  }
}
