import type { ScratchpadId, ChatSessionId } from './ids.js';
import type { ChatMessage } from './chat.js';
import { VALID_DELTA_OP_TYPES } from './state-delta.js';

export type ScratchpadStatus = 'active' | 'handed_off' | 'archived' | 'discarded';

// Structured exit artifact produced when the user ends a scratchpad.
// Contains only a distilled summary and optional candidates for action.
// No candidateMemory in v1 — memory actions are deferred.
export interface ScratchpadHandoff {
  summary: string;
  keyFindings: string[];
  unresolvedQuestions: string[];
  candidateTask?: {
    title: string;
    goal: string;
    taskType: 'discovery' | 'implementation' | 'validation';
    scopePaths: string[];
  };
  candidateDelta?: {
    operations: Array<{ type: string; value?: string; path?: string }>;
    rationale: string;
  };
}

// Origin context frozen at spawn time for display in the scratchpad panel.
export interface ScratchpadOrigin {
  goal: string;
  phase: string;
  phaseGoal: string;
}

// Ephemeral exploratory session. Separate from the main ChatSession.
// Scratchpad transcript stays local — only the handoff crosses back to main chat.
export interface ScratchpadSession {
  id: ScratchpadId;
  parentChatSessionId: ChatSessionId;
  parentContextSummary: string;
  origin: ScratchpadOrigin;
  status: ScratchpadStatus;
  messages: ChatMessage[];
  handoff: ScratchpadHandoff | null;
  spawnedAt: string;
  closedAt: string | null;
}

export function createScratchpadSession(
  id: ScratchpadId,
  parentChatSessionId: ChatSessionId,
  parentContextSummary: string,
  origin: ScratchpadOrigin,
): ScratchpadSession {
  return {
    id,
    parentChatSessionId,
    parentContextSummary,
    origin,
    status: 'active',
    messages: [],
    handoff: null,
    spawnedAt: new Date().toISOString(),
    closedAt: null,
  };
}

// Parse a raw handoff object from Claude's output into a typed ScratchpadHandoff.
// Defensive: missing or malformed fields get safe defaults.
export function parseScratchpadHandoff(raw: Record<string, unknown>): ScratchpadHandoff {
  const summary = typeof raw.summary === 'string' ? raw.summary : 'No summary provided.';
  const keyFindings = Array.isArray(raw.keyFindings)
    ? raw.keyFindings.filter((f): f is string => typeof f === 'string')
    : [];
  const unresolvedQuestions = Array.isArray(raw.unresolvedQuestions)
    ? raw.unresolvedQuestions.filter((q): q is string => typeof q === 'string')
    : [];

  const handoff: ScratchpadHandoff = { summary, keyFindings, unresolvedQuestions };

  // Parse optional candidateTask
  if (raw.candidateTask && typeof raw.candidateTask === 'object') {
    const ct = raw.candidateTask as Record<string, unknown>;
    const validTypes = ['discovery', 'implementation', 'validation'];
    if (typeof ct.title === 'string' && typeof ct.goal === 'string') {
      handoff.candidateTask = {
        title: ct.title,
        goal: ct.goal,
        taskType: validTypes.includes(ct.taskType as string)
          ? (ct.taskType as 'discovery' | 'implementation' | 'validation')
          : 'discovery',
        scopePaths: Array.isArray(ct.scopePaths)
          ? ct.scopePaths.filter((p): p is string => typeof p === 'string')
          : [],
      };
    }
  }

  // Parse optional candidateDelta — only accept known delta operation types
  if (raw.candidateDelta && typeof raw.candidateDelta === 'object') {
    const cd = raw.candidateDelta as Record<string, unknown>;
    if (Array.isArray(cd.operations) && cd.operations.length > 0) {
      const validTypes: readonly string[] = VALID_DELTA_OP_TYPES;
      const ops = cd.operations
        .filter((o): o is Record<string, unknown> =>
          typeof o === 'object' && o !== null &&
          typeof (o as Record<string, unknown>).type === 'string' &&
          validTypes.includes((o as Record<string, unknown>).type as string))
        .map(o => ({
          type: o.type as string,
          ...(typeof o.value === 'string' ? { value: o.value } : {}),
          ...(typeof o.path === 'string' ? { path: o.path } : {}),
        }));
      if (ops.length > 0) {
        handoff.candidateDelta = {
          operations: ops,
          rationale: typeof cd.rationale === 'string' ? cd.rationale : '',
        };
      }
    }
  }

  return handoff;
}
