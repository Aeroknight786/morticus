import { ChatSessionId, ChatMessageId, ProjectId } from './ids.js';
import type { TaskType } from './task.js';
import type { DeltaOperation } from './state-delta.js';

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
// suggestionId is assigned when a task moves to pendingSuggestedTasks on accept.
// Not present during kickoff accumulation or in Claude output — client-side lifecycle only.
export interface DraftTask {
  title: string;
  goal: string;
  taskType: TaskType;
  scopePaths: string[];
  suggestionId?: string;
}

// The one structured result per chat turn.
// The chat adapter calls Claude and parses this from the response.
// - response: always present, shown to the user
// - draftState: kickoff mode — accumulated state fields
// - draftTask: steering mode — single task to create
// - draftTasks: kickoff mode — suggested starter tasks (accumulated across turns)
export interface ChatTurnResult {
  response: string;
  draftState?: DraftCanonicalState;
  draftTask?: DraftTask;
  draftTasks?: DraftTask[];
  draftDelta?: DeltaOperation[];
}

// Lightweight task context for enriching the steering prompt.
// Built by the chat panel from store data, passed to the chat adapter.
export interface TaskContext {
  activeTasks: { title: string; taskType: string; status: string }[];
  recentlyCompleted: { title: string; taskType: string; goal: string }[];
  awaitingReview: { title: string }[];
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
  draftTasks?: DraftTask[];
  draftDelta?: DeltaOperation[];
}

export interface ChatSession {
  id: ChatSessionId;
  projectId: ProjectId;
  mode: ChatMode;
  messages: ChatMessage[];
  // Accumulated draft state during kickoff (latest snapshot across turns).
  currentDraftState: DraftCanonicalState | null;
  // Kickoff-only: candidate tasks accumulated during conversation (no suggestionId yet).
  // Cleared on accept — NOT auto-created as TaskNodes.
  draftTasks: DraftTask[];
  // Post-accept: suggested tasks that haven't been created or dismissed yet.
  // Each has a suggestionId for stable lifecycle tracking. Drained as user acts.
  pendingSuggestedTasks: DraftTask[];
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
    pendingSuggestedTasks: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Merge new suggested tasks into existing list.
// Matched by normalized title (lowercase, trimmed). Existing unmatched tasks are preserved.
// User-dismissed tasks should be removed from the list before calling this.
export function mergeDraftTasks(
  existing: DraftTask[],
  incoming: DraftTask[],
): DraftTask[] {
  const normalize = (t: string) => t.toLowerCase().trim();
  const result = [...existing];
  const existingKeys = new Set(result.map(t => normalize(t.title)));

  for (const task of incoming) {
    const key = normalize(task.title);
    const idx = result.findIndex(t => normalize(t.title) === key);
    if (idx !== -1) {
      // Update in place — keep position, update fields
      result[idx] = { ...task };
    } else {
      result.push(task);
      existingKeys.add(key);
    }
  }
  return result;
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
