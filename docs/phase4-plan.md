# Phase 4: Conversational Steering

## Status
Phase 4A: shipped (171 tests). Phase 4A.5: shipped (195 tests). Phase 4A.6: shipped (206 tests). Phase 4B.1: next ("What should we do next?").

## Phasing

This phase is split into two sub-phases:

- **Phase 4A** (implement next): Conversational onboarding + conversational task drafting. Solves the sharpest UX pain: project startup and task creation are too form-first.
- **Phase 4B** (later): Strategic trunk behavior — phase transitions from chat, state update proposals, richer strategic questioning, deeper main-chat orchestration.

Everything below marked "4A" is in scope for the next implementation. Everything marked "4B" is deferred.

---

## Problem
Morticus has strong state/task/review foundations, but the interaction model is entirely form-based. Creating a project means filling empty forms. Creating tasks means answering sequential input boxes. The product feels administrative when it should feel conversational.

The two sharpest pain points:
1. **Project startup**: user initializes, gets an empty state, must manually type every field
2. **Task creation**: user picks type, types title, types goal, types scope — four sequential input boxes

The missing layer: natural language → typed draft objects → reviewed canonical mutation.

## Design Principle

> Task chats do the work.
> The main chat steers the project.
> Canonical state stores what the project currently believes.
> Phases describe what kind of work should happen next.

**Work-spawning rule:** If a main-chat request requires substantial exploration or implementation planning, the system should prefer drafting/spawning a task rather than doing the work inline. The strategic trunk stays clean.

---

## Phase 4A: Scope

### What 4A delivers
1. **Kickoff chat**: user describes project conversationally → system drafts canonical state → user reviews and accepts → canonical state v1
2. **Conversational task drafting**: after canonical state exists, user says "create a task to..." → system drafts TaskIntent → shown as card → user confirms/edits/cancels → task created
3. **One chat panel** with mode switching (kickoff → steering) based on whether canonical state exists
4. **phaseGoal** field on CanonicalProjectState (lightweight, not bureaucratic)
5. **Manual flows remain** as fallback for all operations
6. **Explicit review/confirmation** for every mutation

### What 4A does NOT do
- Phase transition proposals from chat (4B)
- State update proposals from chat beyond kickoff (4B)
- Memory update proposals from chat (4B)
- Deep strategic question answering (4B)
- Draft-state task spawning before canonical state acceptance (4B)
- Chat transcript compaction / summarization (4B)
- Deterministic intent pre-classification (4B — all turns go through Claude in 4A)

---

## Product Model (4A)

### Kickoff Chat

When a project has no canonical state (freshly initialized), the chat panel opens in **kickoff mode**.

The user talks naturally: *"I want to build a chess engine in Rust. Start with board representation, then move generation, then an AI player."*

Each chat turn, the system calls Claude with current conversation + a structured output contract. Claude returns a **ChatTurnResult** containing:
- A natural-language response (shown to user)
- An optional draft state update (accumulated across turns)
- Optional candidate task ideas (shown as cards on accept)

The draft state is displayed inline in the chat as a collapsible preview. It accumulates across turns — each response can refine it. The user can say *"add a constraint: must support FEN notation"* and the draft updates.

When satisfied, the user clicks **"Accept Draft State"**:
1. Creates canonical state v1 with all extracted fields
2. Converts any candidate task ideas into draft TaskNodes
3. Chat transitions to steering mode

**Key rule:** Draft state is transient. It lives in the chat session, never as a state version. Only acceptance creates canonical state.

### Task Drafting (Steering Mode)

After canonical state exists, the chat shifts to **steering mode**. In 4A, steering mode supports one primary action: **task drafting**.

User: *"Create a task to implement the board data structure using bitboards"*

The system calls Claude with current state context. Claude returns a ChatTurnResult with:
- Natural-language response
- A draft task (title, goal, type, scope)

The draft task is shown as a compact inline card:
```
Draft Task
  Title: Implement board data structure using bitboards
  Type: implementation
  Goal: Implement board representation using bitboard...
  Scope: src/board/
  [Confirm] [Edit] [Cancel]
```

**Confirm** → creates the TaskNode via existing `createTask`. **Edit** → opens fields for adjustment. **Cancel** → discards.

Tasks inherit context via the existing spec compilation pipeline (canonical state + memory → context pack). Tasks do NOT inherit chat transcript.

**Work-spawning rule in action:** If the user asks something that requires substantial work — *"analyze the codebase for performance issues"*, *"figure out the best algorithm for move generation"* — the system should respond with a draft discovery task rather than attempting the analysis inline.

### Conversational responses

For messages that don't map to state drafting or task spawning, the system responds conversationally but does not mutate anything. In 4A this is lightweight — Claude answers using state context, but there's no special strategic reasoning engine. Richer behavior is 4B.

### Phase Model (4A — minimal)

Add one field to `CanonicalProjectState`:
- `phaseGoal: string` — what this phase aims to accomplish

Add `phaseExitCriteria: string[]` to the type for forward compatibility, but do not prominently surface it in kickoff chat or steering mode. It exists, the state panel can show it, but the chat doesn't push it.

Add delta operations:
- `set_phase_goal`
- `add_phase_exit_criterion` / `remove_phase_exit_criterion`

These are wired through `applyDeltaOperations` so they work if used manually via the state panel. Chat-driven phase transitions are 4B.

---

## Architecture (4A — simplified)

### Core simplification

The previous plan had four separate compiler layers (chat-intent-classifier, state-drafter, task-drafter, chat-adapter). This is over-factored for 4A.

Instead: **one chat turn produces one structured result object.** The chat adapter calls Claude, parses the response, and returns a `ChatTurnResult`. The chat panel routes that result to the appropriate UI action.

```
User message
  → chat-adapter builds context (state + memory + recent messages + system prompt)
  → single Claude call (--print)
  → parse structured JSON from response
  → ChatTurnResult { response, draftState?, draftTask? }
  → chat panel renders response + draft cards
```

No separate intent classifier, state drafter, or task drafter files. Classification, extraction, and drafting all happen inside the Claude call via the structured output contract. The system prompt tells Claude what to produce; the adapter parses the result.

If deterministic pre-classification becomes valuable later (4B), it can be added as a fast path before the Claude call.

### ChatTurnResult (the one structured object)

```typescript
interface ChatTurnResult {
  response: string;                              // always present — shown to user
  draftState?: Partial<CanonicalProjectState>;   // kickoff mode — accumulated state fields
  draftTask?: {                                  // steering mode — task to create
    title: string;
    goal: string;
    taskType: TaskType;
    scopePaths: string[];
  };
}
```

The chat adapter parses this from Claude's output using the same marker pattern as the task output normalizer:
```
---MORTICUS-CHAT-START---
{ ... ChatTurnResult JSON ... }
---MORTICUS-CHAT-END---
```

Natural language response is everything outside the markers.

### Chat Adapter (`src/runtime/chat-adapter.ts`)

One function:

```typescript
async function sendChatTurn(
  messages: ChatMessage[],
  state: CanonicalProjectState | null,
  memory: DurableMemory,
  mode: 'kickoff' | 'steering',
  options?: { signal?: AbortSignal },
): Promise<ChatTurnResult>
```

Internally:
1. Build system prompt (mode-specific instructions + structured output contract)
2. Build context section (current state summary, active memory, task statuses)
3. Format recent messages as conversation
4. Call `runClaude` with the assembled prompt
5. Parse markers → ChatTurnResult

The system prompt is the critical piece. It tells Claude:
- In kickoff mode: extract project fields, refine draft state, suggest tasks
- In steering mode: if the user wants a task, produce a draftTask; if the request needs substantial work, propose a task rather than doing it inline; otherwise respond conversationally

### Chat Storage (`src/storage/chat-store.ts`)

- `.morticus/chat/main.json` — single session per project
- Stores: messages, current draftState (kickoff), draftTasks (kickoff)
- Simple read/write via `json-backend.ts`

### Chat UI (`src/ui/webviews/chat-panel.ts`)

Webview with:
- Message list (user + assistant, scrollable)
- Text input + send button at bottom
- **Kickoff mode additions:**
  - Collapsible draft state preview (updates after each turn)
  - "Accept Draft State" button (prominent, appears once draft has a goal)
- **Steering mode additions:**
  - Inline draft task cards (confirm/edit/cancel)
- Mode indicator (subtle — "Setting up project..." vs project name)

### Review Integration (4A)

Minimal — the chat panel handles confirmation directly:
- **Accept Draft State**: creates `CanonicalProjectState` via `createInitialState` populated with draft fields, saves as v1. No delta review for the initial state (there's nothing to diff against).
- **Confirm Task**: creates `TaskNode` via `createTask` with extracted fields. Standard task lifecycle from there (compile spec → run → review delta).

Delta review enters when tasks produce results, same as today. The chat itself doesn't propose deltas in 4A.

---

## File-Level Impact (4A)

### New Files

| File | Layer | Purpose |
|---|---|---|
| `src/domain/chat.ts` | Domain | ChatMessage, ChatSession, ChatTurnResult types |
| `src/runtime/chat-adapter.ts` | Runtime | `sendChatTurn` — builds prompt, calls Claude, parses result |
| `src/storage/chat-store.ts` | Storage | Main chat session persistence |
| `src/ui/webviews/chat-panel.ts` | UI | Chat webview (messages, drafts, input) |
| `test/unit/domain/chat.test.ts` | Test | Chat type construction |
| `test/unit/runtime/chat-adapter.test.ts` | Test | Prompt assembly + result parsing (mocked Claude) |
| `test/integration/chat-kickoff.test.ts` | Test | Kickoff flow end-to-end |
| `test/integration/chat-task-drafting.test.ts` | Test | Task drafting flow end-to-end |

### Modified Files

| File | Change |
|---|---|
| `src/domain/canonical-state.ts` | Add `phaseGoal: string`, `phaseExitCriteria: string[]`; update `createInitialState`, `applyDeltaOperations` |
| `src/domain/state-delta.ts` | Add `set_phase_goal`, `add_phase_exit_criterion`, `remove_phase_exit_criterion` to DeltaOperation |
| `src/domain/ids.ts` | Add `ChatSessionId`, `ChatMessageId` branded types + generators |
| `src/domain/state-diff.ts` | Handle phaseGoal, phaseExitCriteria in `diffStates` |
| `src/storage/store.ts` | Add `chat: ChatStore` to ProjectStore facade |
| `src/extension.ts` | Register chat panel, auto-open on kickoff |
| `src/ui/commands.ts` | Add `morticus.openChat` command |
| `src/ui/webviews/state-panel.ts` | Show phaseGoal field |
| `package.json` | New commands |

### NOT created in 4A

| File | Reason |
|---|---|
| `src/compiler/chat-intent-classifier.ts` | Over-factored — classification happens inside Claude call |
| `src/compiler/state-drafter.ts` | Over-factored — drafting happens inside Claude call |
| `src/compiler/task-drafter.ts` | Over-factored — drafting happens inside Claude call |

---

## Workstreams (4A)

| # | Workstream | Description |
|---|---|---|
| WS1 | Domain types | ChatMessage, ChatSession, ChatTurnResult in `src/domain/chat.ts`. ChatSessionId/ChatMessageId in ids.ts. phaseGoal + phaseExitCriteria on state. New delta operations. |
| WS2 | Chat adapter | `sendChatTurn` function. System prompts for kickoff and steering modes. Structured output contract with markers. Result parsing. |
| WS3 | Chat storage | ChatStore — single main.json session per project. |
| WS4 | Chat UI | Chat panel webview. Kickoff mode with draft state preview + accept. Steering mode with draft task cards. |
| WS5 | Wiring | Commands (openChat), extension registration, package.json. Auto-open chat on project init. |
| WS6 | Tests | Unit tests for types, adapter parsing. Integration tests for kickoff and task drafting flows. |

---

## Builder Flow: Before and After

### Before (current)
```
1. Command palette → "Initialize Project" → type name → empty project
2. Sidebar shows empty state tree
3. Open State Panel → manually type goal, phase, constraints, decisions, risks...
4. Submit → diff against empty state → review delta → accept
5. Command palette → "Create Task" → pick type → type title → type goal → type scope
6. Task created as draft
7. Compile spec → run → review output → accept delta
8. To change phase: open state panel → edit phase string → submit → review
```

### After (4A)
```
1. Command palette → "Initialize Project" → name → chat panel opens
2. "I want to build a chess engine in Rust. Board representation first."
3. System shows draft state preview: goal, phase, phaseGoal, constraints, risks
4. "Also add a constraint: must support FEN notation"
5. Draft updates → user clicks "Accept Draft State" → canonical state v1
6. "Create a task to implement the board using bitboards"
7. Draft task card appears inline → user clicks "Confirm" → task created as draft
8. Compile spec → run → review output → accept delta (same as today)
```

Steps 1–7 replace the form-first pain. Steps 8+ are unchanged — the existing pipeline handles the rest.

Manual forms remain as fallback for all operations.

---

## Key Design Decisions

### 1. One structured result per chat turn
No separate intent classifier, state drafter, or task drafter. Claude produces one `ChatTurnResult` per turn. The chat adapter parses it. The chat panel routes it. Simple.

### 2. Kickoff and steering share one panel
Same webview, same adapter function. System prompt shifts based on mode. If canonical state exists → steering. If not → kickoff.

### 3. Work-spawning rule
If a main-chat request requires substantial exploration or implementation, the system proposes a task rather than doing the work inline. This keeps the strategic trunk clean and prevents the main chat from becoming a giant-chat.

### 4. Manual flows remain as fallback
All existing form-based flows stay. The chat is additive.

### 5. phaseGoal is lightweight
phaseGoal exists and the kickoff chat can populate it. phaseExitCriteria exists in the type but is not pushed by the chat UX. No process burden.

### 6. No initial-state delta review
The first canonical state created from kickoff chat is accepted directly (there's nothing to diff against — it's the first version). After that, all mutations go through deltas.

---

## Risks (4A)

| Risk | Severity | Mitigation |
|---|---|---|
| Weak structured output — Claude doesn't produce clean ChatTurnResult JSON | High | Explicit marker contract (same pattern as task output normalizer, already proven). Fallback: show response, skip draft. |
| Chat feels like a thin Claude wrapper | High | System prompt must instruct Claude to produce structured drafts, not just echo. The draft state preview / task cards are the value — not the prose. |
| Kickoff draft state is incomplete or wrong | Medium | User refines across turns. Draft preview makes omissions visible. User can always edit via state panel after acceptance. |
| Cost per chat turn | Medium | Each turn is one Claude call. Kickoff is ~3-5 turns. Task drafting is ~1 turn. Acceptable for the value delivered. |
| Users confused by chat vs forms | Low | Chat auto-opens on init. Forms remain but aren't the default entry point. |

---

## Verification Plan (4A)

### Unit Tests
1. ChatMessage, ChatSession, ChatTurnResult type construction and validation
2. Chat adapter: system prompt assembly for kickoff mode
3. Chat adapter: system prompt assembly for steering mode
4. Chat adapter: structured output parsing from mock Claude response (markers present)
5. Chat adapter: graceful fallback when markers missing
6. Phase delta operations: `set_phase_goal`, `add/remove_phase_exit_criterion` in `applyDeltaOperations`
7. State diff: handles phaseGoal, phaseExitCriteria

### Integration Tests
8. Kickoff flow: mock Claude → draft state accumulates → accept → canonical state v1 with correct fields
9. Task drafting flow: mock Claude → draft task → confirm → task exists with correct fields

### Manual E2E
10. Fresh project → chat opens → describe project → see draft → refine → accept → state v1
11. State exists → "create a task to..." → draft card → confirm → task in sidebar tree
12. Non-task message → conversational response → no mutation
13. Forms still work as fallback for all operations

---

## Phase 4B: Deferred Scope

The following belongs to 4B and should not be implemented until 4A ships and is validated:

- **Phase transitions from chat**: "move to next phase" → draft delta → review
- **State update proposals from chat**: "add a decision: ..." → draft delta → review
- **Memory update proposals from chat**: "remember that..." → draft memory entry
- **Richer strategic questioning**: "what should we do next?" with deep state analysis and task suggestions
- **Deterministic intent pre-classification**: fast path before Claude call for obvious patterns
- **Chat transcript compaction**: summarize old messages to control context cost
- **Draft-state task spawning**: tasks before canonical state acceptance
- **Multi-session support**: branching strategic conversations
- **Cost tracking per chat turn**
- **Richer phase model**: phase templates, exit criteria prominently surfaced, dependency graph
