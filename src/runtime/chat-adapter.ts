import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { DurableMemory } from '../domain/durable-memory.js';
import type { ChatMessage, ChatTurnResult, ChatMode, DraftCanonicalState, DraftTask, TaskContext } from '../domain/chat.js';
import type { DeltaOperation } from '../domain/state-delta.js';
import { runClaude } from './claude-adapter.js';

// Chat adapter: one function per turn.
// Builds a prompt from state context + recent messages + system instructions,
// calls Claude in single-shot mode, parses the structured ChatTurnResult.
//
// No persistent process. Fresh-from-snapshot per turn.

const CHAT_START_MARKER = '---MORTICUS-CHAT-START---';
const CHAT_END_MARKER = '---MORTICUS-CHAT-END---';

// ── System prompts ──

function buildKickoffSystemPrompt(): string {
  return `You are Morticus, a project planning assistant. The user is setting up a new software project. Help them scope it by extracting structured project information from their description.

Your job: understand what the user wants to build and produce a structured draft of their project state.

After each response, output a structured block between markers. This block represents your current best understanding of the project. It accumulates across turns — include ALL fields you know so far, not just what changed in this turn.

${buildKickoffOutputContract()}

Guidelines:
- Extract: goal, phase (current work focus), phaseGoal (what this phase achieves), constraints, risks, nextStep
- Be conversational — ask clarifying questions if the description is vague
- If the user refines something, update the relevant field in the structured block
- Keep constraints specific and actionable, not generic
- Risks should be genuine uncertainties, not restated constraints
- Suggest a concrete nextStep (first thing to do)
- draftTasks: optionally suggest 1-3 starter tasks if you have enough context. Keep these lightweight and concrete.
- Do not invent information the user hasn't mentioned or implied`;
}

function buildSteeringSystemPrompt(stateSummary: string, taskContextSection: string): string {
  return `You are Morticus, a project steering assistant. The user has an active project with canonical state. Help them create tasks and answer questions about their project.

## Current Project State
${stateSummary}
${taskContextSection}
Your primary action: when the user wants work done, draft a task for them.

${buildSteeringOutputContract()}

Guidelines:
- If the user wants to create, implement, explore, or investigate something → produce a draftTask
- If the request requires substantial exploration or implementation → ALWAYS propose a task rather than doing the work inline. The main chat stays clean; tasks do the work.
- Task types: "discovery" (explore/research/analyze), "implementation" (build/create/modify code), "validation" (test/verify/check)
- Infer scopePaths from the task goal and project context. Use empty array if uncertain.
- Be aware of existing active tasks to avoid suggesting duplicate work.
- If the user asks about priorities, what to do next, or strategic direction:
  1. Analyze the project goal, current phase, phase goal, and phase exit criteria
  2. Consider active tasks (avoid duplicating in-progress work), recently completed tasks (build on what's done), and tasks awaiting review (unresolved work)
  3. Consider risks that should be mitigated and the stated nextStep
  4. Provide a grounded strategic recommendation — explain WHY based on the project state
  5. Optionally suggest 1-2 concrete tasks via draftTasks (array). Each needs a clear, specific goal.
  6. Do NOT suggest tasks that duplicate active or awaiting-review work
  7. Ground your reasoning in the project state — do not invent context
- If the user explicitly requests a state change (add/remove constraint, update goal, change phase, etc.):
  1. Produce the specific operations in draftDelta
  2. These will go through a review step before being applied — explain what you're proposing
  3. Only include operations the user asked for — don't add extras
  4. For removals, match the exact existing value from the project state
- If the user is just asking a question or chatting → respond conversationally, omit the structured block entirely
- Keep responses concise and focused`;
}

function buildKickoffOutputContract(): string {
  return `Output format: include this block in your response when you have structured data to report.
If you are just responding conversationally with no draft to propose, you may OMIT this block entirely.

${CHAT_START_MARKER}
{
  "draftState": null,
  "draftTasks": []
}
${CHAT_END_MARKER}

Field schemas:
- draftState: { "goal": "", "phase": "", "phaseGoal": "", "constraints": [], "decisions": [], "risks": [], "knownFiles": [], "nextStep": "" } — include all fields you know, null/omit unknown ones
- draftTasks: array of { "title": "", "goal": "", "taskType": "discovery"|"implementation"|"validation", "scopePaths": [] } — suggested starter tasks (1-3 max). Omit or use empty array if no tasks to suggest yet.
- Set unused fields to null`;
}

function buildSteeringOutputContract(): string {
  return `Output format: include this block in your response when you have structured data to report.
If you are just responding conversationally with no draft to propose, you may OMIT this block entirely.

${CHAT_START_MARKER}
{
  "draftState": null,
  "draftTask": null,
  "draftTasks": [],
  "draftDelta": []
}
${CHAT_END_MARKER}

Field schemas:
- draftState (not used in steering mode): set to null
- draftTask: { "title": "", "goal": "", "taskType": "discovery"|"implementation"|"validation", "scopePaths": [] } — use for direct task creation requests
- draftTasks: array of same shape — use for strategic "what next" suggestions (0-2 tasks). Use draftTasks (not draftTask) when suggesting strategic priorities.
- draftDelta: array of state change operations. Each is { "type": "...", "value": "..." }. Valid types: add_constraint, remove_constraint, add_decision, remove_decision, add_risk, remove_risk, set_goal, set_phase, set_next_step, set_phase_goal, add_phase_exit_criterion, remove_phase_exit_criterion. For add_known_file/remove_known_file, use "path" instead of "value".
- Use draftTask for work that requires execution. Use draftDelta for direct state mutations. Use draftTasks for strategic suggestions.
- Never use draftDelta and draftTask in the same response.
- Set unused fields to null`;
}

// ── Context building ──

export function buildStateSummary(state: CanonicalProjectState): string {
  const parts: string[] = [];
  if (state.goal) parts.push(`Goal: ${state.goal}`);
  if (state.phase) parts.push(`Phase: ${state.phase}`);
  if (state.phaseGoal) parts.push(`Phase goal: ${state.phaseGoal}`);
  if (state.phaseExitCriteria.length) {
    parts.push(`Phase exit criteria:\n${state.phaseExitCriteria.map(c => `  - ${c}`).join('\n')}`);
  }
  if (state.constraints.length) {
    parts.push(`Constraints:\n${state.constraints.map(c => `  - ${c}`).join('\n')}`);
  }
  if (state.decisions.length) {
    parts.push(`Decisions:\n${state.decisions.map(d => `  - ${d}`).join('\n')}`);
  }
  if (state.risks.length) {
    parts.push(`Risks:\n${state.risks.map(r => `  - ${r}`).join('\n')}`);
  }
  if (state.knownFiles.length) {
    parts.push(`Known files: ${state.knownFiles.join(', ')}`);
  }
  if (state.nextStep) parts.push(`Next step: ${state.nextStep}`);
  parts.push(`State version: ${state.version}`);
  return parts.join('\n\n');
}

function buildMemoryContext(memory: DurableMemory): string {
  const active = memory.entries.filter(e => e.active);
  if (active.length === 0) return '';
  const lines = active.map(e => `[${e.category}] ${e.title}: ${e.content}`);
  return `## Project Memory\n\n${lines.join('\n\n')}`;
}

export function buildTaskContextSection(ctx: TaskContext): string {
  const parts: string[] = [];

  if (ctx.activeTasks.length > 0) {
    const lines = ctx.activeTasks.map(t => `  - "${t.title}" [${t.taskType}] — ${t.status}`);
    parts.push(`Active tasks:\n${lines.join('\n')}`);
  }

  if (ctx.recentlyCompleted.length > 0) {
    const lines = ctx.recentlyCompleted.map(t => `  - "${t.title}" [${t.taskType}] — ${t.goal}`);
    parts.push(`Recently completed:\n${lines.join('\n')}`);
  }

  if (ctx.awaitingReview.length > 0) {
    const lines = ctx.awaitingReview.map(t => `  - "${t.title}"`);
    parts.push(`Awaiting review:\n${lines.join('\n')}`);
  }

  if (parts.length === 0) return '';
  return `\n## Project Activity\n${parts.join('\n\n')}`;
}

function formatMessages(messages: ChatMessage[]): string {
  // Include recent messages as conversation context (sliding window)
  const recent = messages.slice(-20);
  return recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
}

// ── Main entry point ──

export interface ChatAdapterOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  workingDirectory: string;
}

export async function sendChatTurn(
  messages: ChatMessage[],
  state: CanonicalProjectState | null,
  memory: DurableMemory,
  mode: ChatMode,
  options: ChatAdapterOptions,
  taskContext?: TaskContext,
): Promise<ChatTurnResult> {
  const sections: string[] = [];

  // System prompt
  if (mode === 'kickoff') {
    sections.push(buildKickoffSystemPrompt());
  } else {
    const stateSummary = state ? buildStateSummary(state) : 'No canonical state yet.';
    const taskCtxSection = taskContext ? buildTaskContextSection(taskContext) : '';
    sections.push(buildSteeringSystemPrompt(stateSummary, taskCtxSection));
  }

  // Memory context
  const memoryCtx = buildMemoryContext(memory);
  if (memoryCtx) sections.push(memoryCtx);

  // Conversation history
  if (messages.length > 0) {
    sections.push(`## Conversation\n\n${formatMessages(messages)}`);
  }

  const prompt = sections.join('\n\n');

  const result = await runClaude(prompt, {
    workingDirectory: options.workingDirectory,
    timeoutMs: options.timeoutMs ?? 120_000,
    signal: options.signal,
  });

  return parseChatTurnResult(result.stdout);
}

// ── Response parsing ──

export function parseChatTurnResult(raw: string): ChatTurnResult {
  const startIdx = raw.indexOf(CHAT_START_MARKER);
  const endIdx = raw.indexOf(CHAT_END_MARKER);

  // Extract natural-language response (everything outside markers)
  let response: string;
  if (startIdx !== -1 && endIdx !== -1) {
    const before = raw.slice(0, startIdx).trim();
    const after = raw.slice(endIdx + CHAT_END_MARKER.length).trim();
    response = [before, after].filter(Boolean).join('\n\n');
  } else {
    response = raw.trim();
  }

  // If no markers, degrade gracefully to response-only mode
  if (startIdx === -1 || endIdx === -1) {
    return { response: response || '(No response from Claude)' };
  }

  // Parse structured block
  const jsonStr = raw.slice(startIdx + CHAT_START_MARKER.length, endIdx).trim();
  try {
    const parsed = JSON.parse(jsonStr);
    const result: ChatTurnResult = {
      response: response || '(No response from Claude)',
    };

    if (parsed.draftState && typeof parsed.draftState === 'object') {
      result.draftState = sanitizeDraftState(parsed.draftState);
    }

    if (parsed.draftTask && typeof parsed.draftTask === 'object') {
      result.draftTask = sanitizeDraftTask(parsed.draftTask);
    }

    // Parse draftTasks array (kickoff suggested tasks / steering strategic suggestions)
    if (Array.isArray(parsed.draftTasks)) {
      const tasks = parsed.draftTasks
        .filter((t: unknown) => t && typeof t === 'object')
        .map((t: unknown) => sanitizeDraftTask(t as Record<string, unknown>))
        .filter((t: DraftTask | undefined): t is DraftTask => t !== undefined);
      if (tasks.length > 0) {
        result.draftTasks = tasks;
      }
    }

    // Parse draftDelta array (steering state mutation proposals)
    if (Array.isArray(parsed.draftDelta)) {
      const ops = parsed.draftDelta
        .filter((o: unknown) => o && typeof o === 'object')
        .map((o: unknown) => sanitizeDeltaOperation(o as Record<string, unknown>))
        .filter((o: DeltaOperation | undefined): o is DeltaOperation => o !== undefined);
      if (ops.length > 0) {
        result.draftDelta = ops;
      }
    }

    return result;
  } catch {
    // Malformed JSON — degrade to response-only
    return { response: response || '(No response from Claude)' };
  }
}

function sanitizeDraftState(raw: Record<string, unknown>): DraftCanonicalState {
  const draft: DraftCanonicalState = {};
  if (typeof raw.goal === 'string' && raw.goal) draft.goal = raw.goal;
  if (typeof raw.phase === 'string' && raw.phase) draft.phase = raw.phase;
  if (typeof raw.phaseGoal === 'string' && raw.phaseGoal) draft.phaseGoal = raw.phaseGoal;
  if (Array.isArray(raw.constraints)) draft.constraints = raw.constraints.filter((c): c is string => typeof c === 'string');
  if (Array.isArray(raw.decisions)) draft.decisions = raw.decisions.filter((d): d is string => typeof d === 'string');
  if (Array.isArray(raw.risks)) draft.risks = raw.risks.filter((r): r is string => typeof r === 'string');
  if (Array.isArray(raw.knownFiles)) draft.knownFiles = raw.knownFiles.filter((f): f is string => typeof f === 'string');
  if (typeof raw.nextStep === 'string' && raw.nextStep) draft.nextStep = raw.nextStep;
  return draft;
}

function sanitizeDraftTask(raw: Record<string, unknown>): DraftTask | undefined {
  if (typeof raw.title !== 'string' || !raw.title) return undefined;
  if (typeof raw.goal !== 'string' || !raw.goal) return undefined;
  const validTypes = ['discovery', 'implementation', 'validation'];
  const taskType = validTypes.includes(raw.taskType as string)
    ? (raw.taskType as DraftTask['taskType'])
    : 'discovery';
  const scopePaths = Array.isArray(raw.scopePaths)
    ? raw.scopePaths.filter((s): s is string => typeof s === 'string')
    : [];
  return { title: raw.title, goal: raw.goal, taskType, scopePaths };
}

const VALID_DELTA_TYPES = [
  'add_constraint', 'remove_constraint', 'add_decision', 'remove_decision',
  'add_risk', 'remove_risk', 'add_known_file', 'remove_known_file',
  'set_goal', 'set_phase', 'set_next_step', 'set_phase_goal',
  'add_phase_exit_criterion', 'remove_phase_exit_criterion',
] as const;

export function sanitizeDeltaOperation(raw: Record<string, unknown>): DeltaOperation | undefined {
  const type = raw.type;
  if (typeof type !== 'string' || !(VALID_DELTA_TYPES as readonly string[]).includes(type)) return undefined;

  if (type === 'add_known_file' || type === 'remove_known_file') {
    if (typeof raw.path !== 'string' || !raw.path) return undefined;
    return { type, path: raw.path } as DeltaOperation;
  }

  if (typeof raw.value !== 'string' || !raw.value) return undefined;
  return { type, value: raw.value } as DeltaOperation;
}
