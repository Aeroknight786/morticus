import { ChatSessionId, ChatMessageId, ProjectId } from './ids.js';
import type { TaskType } from './task.js';

// Draft canonical state built up during kickoff conversation.
// Dedicated type rather than Partial<CanonicalProjectState> for clarity.
// All fields optional — accumulated across chat turns.
export interface DraftCanonicalState {
  goal?: string;
  phase?: string;
  phaseGoal?: string;
  constraints?: string[];
  decisions?: string[];
  risks?: string[];
  knownFiles?: string[];
  nextStep?: string;
}

// Lightweight draft task surfaced as a card in chat.
export interface DraftTask {
  title: string;
  goal: string;
  taskType: TaskType;
  scopePaths: string[];
}

// The one structured result per chat turn.
// The chat adapter calls Claude and parses this from the response.
// - response: always present, shown to the user
// - draftState: kickoff mode — accumulated state fields
// - draftTask: steering mode — task to create
export interface ChatTurnResult {
  response: string;
  draftState?: DraftCanonicalState;
  draftTask?: DraftTask;
}

export type ChatMode = 'kickoff' | 'steering';

export interface ChatMessage {
  id: ChatMessageId;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  // If this assistant message produced a draft, store it for display.
  draftState?: DraftCanonicalState;
  draftTask?: DraftTask;
}

export interface ChatSession {
  id: ChatSessionId;
  projectId: ProjectId;
  mode: ChatMode;
  messages: ChatMessage[];
  // Accumulated draft state during kickoff (latest snapshot across turns).
  currentDraftState: DraftCanonicalState | null;
  // Candidate tasks surfaced during kickoff, created on state acceptance.
  draftTasks: DraftTask[];
  createdAt: string;
  updatedAt: string;
}

export function createChatSession(
  id: ChatSessionId,
  projectId: ProjectId,
  mode: ChatMode,
): ChatSession {
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    mode,
    messages: [],
    currentDraftState: null,
    draftTasks: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Merge a new draft state update into the accumulated draft.
// New fields overwrite; arrays are replaced, not appended.
export function mergeDraftState(
  current: DraftCanonicalState | null,
  update: DraftCanonicalState,
): DraftCanonicalState {
  const base = current ?? {};
  return {
    goal: update.goal ?? base.goal,
    phase: update.phase ?? base.phase,
    phaseGoal: update.phaseGoal ?? base.phaseGoal,
    constraints: update.constraints ?? base.constraints,
    decisions: update.decisions ?? base.decisions,
    risks: update.risks ?? base.risks,
    knownFiles: update.knownFiles ?? base.knownFiles,
    nextStep: update.nextStep ?? base.nextStep,
  };
}
