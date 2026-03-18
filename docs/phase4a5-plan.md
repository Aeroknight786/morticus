# Phase 4A.5 — Conversational UX Consolidation

## Status
Planned — not yet implemented.

## Motivation

Phase 4A shipped the chat-first interaction model: kickoff drafts canonical state from conversation, steering mode drafts tasks from conversation. 171 tests pass, build is clean, the product is beginning to feel like a thing.

But the chat still feels like a webview attached to a structured extension rather than the center of the product. Before building 4B strategic features on top, the conversational UX needs consolidation. The gap is not missing features — it's polish, context, and connective tissue.

---

## Audit of Current 4A UX

### 1. Empty state is truly blank

The chat opens with a mode bar ("Setting up project..."), an empty message area, and a placeholder ("Describe your project..."). No welcome message, no examples, no hint about what level of detail to provide. A new user staring at a blank textarea doesn't know if they should paste a requirements doc or speak conversationally.

### 2. Draft state changes are invisible across turns

When Claude refines the draft state (e.g., user says "add a constraint"), the collapsible preview shows the merged result but does not indicate what changed. The user sees the full state but has no diff highlighting. This makes multi-turn refinement feel uncertain — "did it actually update?"

### 3. Draft state acceptance is binary and abrupt

Clicking "Accept Draft State" immediately creates canonical state v1, switches to steering mode, and hides the draft section. There is:
- No confirmation dialog or preview of what will become permanent
- No post-accept guidance ("Your project is set up. Try creating a task...")
- No way to go back and refine from chat after accepting
- No indication of *why* the Accept button is hidden when the draft lacks a goal

### 4. Task editing breaks conversational flow

The Edit button on draft task cards opens four sequential VS Code input boxes (title, goal, type, scope). This recreates the form-first experience the chat was designed to eliminate. If the user cancels mid-way, all edits are lost. They cannot see the original card while editing.

### 5. Steering context is too thin

The chat adapter sends to Claude: state summary + active memory + last 20 messages. It does NOT include:
- Active tasks (what's already being worked on)
- Recently completed tasks (what was just done)
- Tasks awaiting review (what's pending)
- Phase exit criteria (acceptance conditions for the current phase)

This means Claude is operating with a partial view of project reality. It may suggest tasks that duplicate existing work, or tasks that are out of scope for the current phase.

### 6. Kickoff suggested tasks are not realized

The docs and system prompt mention candidate kickoff tasks. `ChatSession.draftTasks` exists as a field. But the implementation only supports a single `draftTask` per turn. The `draftTasks` array is never populated. The kickoff system prompt mentions "optionally suggest 1-2 starter tasks" but the result only parses one. The product promise and code are out of sync.

### 7. No navigation after creating objects

After accepting draft state: a toast message with text, no action button, no link. The user must manually navigate to the State Panel to verify.

After confirming a task: a toast message, no task ID shown, no "Jump to Task" action. The user must find the task in the sidebar tree. If task creation silently failed, the user would not know.

### 8. Task card state is optimistic

The task card immediately changes to "Task created." when Confirm is clicked, before the backend confirms success. If the store write fails, the UI and reality diverge.

---

## Phase 4A.5 Plan

### Goal
Make the chat-first experience feel natural and central. Remove the most obvious restrictive interaction points. Enrich steering context before adding broader strategic behavior. Tighten the bridge from conversation to typed object to action.

### Non-goals
- No new strategic trunk features (those are 4B)
- No new panels or sidebar views
- No new domain entities or storage tables
- No chat-driven state mutation (4B)
- No chat transcript compaction (4B)

---

### WS1: Chat UX improvements

#### 1a. Welcome messages

Add mode-specific system messages shown when the chat opens or transitions:

**Kickoff mode (empty session):**
> Welcome to Morticus. Describe the project you want to build — what it does, any constraints, and what the first focus should be.
>
> Example: "I want to build a chess engine in Rust. Start with board representation, then move generation. Must support FEN notation."
>
> I'll draft your project's canonical state from the conversation. You can refine it across multiple messages before accepting.

**Steering mode (after accept or on reopen):**
> Project: {goal truncated to 80 chars}
>
> You can create tasks ("create a task to implement auth"), ask questions about the project, or request strategic advice.

These are rendered as styled system messages (distinct from user/assistant), not part of the Claude conversation context.

#### 1b. Draft state diff indicators

When the draft state updates across turns, visually mark fields that changed in the current turn. Implementation: compare previous `currentDraftState` with the merged result. Changed fields get a subtle CSS highlight (e.g., left border accent or background tint) that fades after a few seconds or on the next turn.

#### 1c. Accept confirmation

Replace immediate acceptance with a two-step flow:
1. User clicks "Accept Draft State"
2. A confirmation section appears below the draft preview:
   - Full state summary (read-only, formatted)
   - "This will become your project's canonical state (v1). You can edit it later in the State Panel."
   - [Confirm] [Cancel] buttons
3. Confirm creates the state and transitions mode

#### 1d. Post-accept system message

After state acceptance, inject a system message:
> Project state v1 created. You're now in steering mode.
>
> Try: "Create a task to [first thing to do]" or ask "What should we tackle first?"

#### 1e. Missing-goal hint

When the draft has fields but no goal, show a hint below the draft preview: "Set a project goal to enable acceptance. Try: 'The goal is to build...'"

---

### WS2: Inline task card editing

Replace the sequential input box flow with inline editing within the task card.

When the user clicks Edit on a draft task card:
1. The card's static field values become editable inputs (text inputs for title/goal, a select dropdown for taskType, text input for scopePaths)
2. The button row changes to [Save] [Cancel]
3. Save calls `handleConfirmTask` with the edited values
4. Cancel reverts the card to its original read-only state

This keeps the user in the chat, preserves visual context, and allows editing individual fields without cycling through all four.

Implementation: the card rendering function gets an `editing` mode. In editing mode, `.value` divs become `<input>` / `<select>` elements. The webview sends an `editedTask` message with the new values.

---

### WS3: Enriched steering context

Add lightweight project-operational context to the steering system prompt. The chat adapter receives this as a new parameter.

#### New type

```typescript
interface TaskContext {
  activeTasks: { title: string; taskType: string; status: string }[];
  recentlyCompleted: { title: string; taskType: string }[];
  awaitingReview: { title: string }[];
}
```

#### Context section added to steering prompt

```
## Project Activity
Active tasks:
  - "Implement auth module" [implementation] — running
  - "Explore database options" [discovery] — ready

Recently completed:
  - "Scaffold project structure" [implementation] — merged

Awaiting review:
  - "Research caching strategies" — awaiting_review
```

If all sections are empty: "No active tasks."

#### Who builds it

The chat panel builds `TaskContext` from `store.tasks.list()` before calling `sendChatTurn`. The chat adapter receives it and includes it in the prompt. The adapter stays storage-free.

#### Signature change

```typescript
export async function sendChatTurn(
  messages: ChatMessage[],
  state: CanonicalProjectState | null,
  memory: DurableMemory,
  mode: ChatMode,
  options: ChatAdapterOptions,
  taskContext?: TaskContext,      // new
): Promise<ChatTurnResult>
```

#### Filtering

- `activeTasks`: status in `['draft', 'ready', 'running', 'awaiting_completion', 'normalizing_output']`
- `recentlyCompleted`: status `'merged'`, sorted by updatedAt desc, limit 5
- `awaitingReview`: status `'awaiting_review'`

Keep it compact. Include title + type + status only. No IDs, no full task objects, no scope paths. This is for Claude's awareness, not for generating references.

---

### WS4: Kickoff suggested tasks

Resolve the gap between the product promise (candidate kickoff tasks) and the implementation (single draftTask).

#### Option chosen: implement properly, with explicit confirmation

The kickoff flow should allow Claude to suggest 1–3 starter tasks alongside the draft state. These accumulate across turns but are **never auto-created**. Each suggestion requires explicit user confirmation.

#### Changes

**`ChatTurnResult`** — add `draftTasks?: DraftTask[]` field. The existing `draftTask` field stays for steering mode (one task per turn). `draftTasks` is for kickoff mode (accumulated across turns).

**Output contract (kickoff prompt)** — change `draftTask` to `draftTasks` (array) in the kickoff structured output:
```json
{
  "draftState": { ... },
  "draftTasks": [
    { "title": "...", "goal": "...", "taskType": "...", "scopePaths": [] }
  ]
}
```

**Parser** — `parseChatTurnResult` parses `draftTasks` array. Each element validated with `sanitizeDraftTask`.

**Accumulation — merge, not replace.** Draft state arrays use replacement semantics (the latest version is the whole truth). Suggested tasks use **merge semantics** because the model may forget prior good suggestions and wholesale replacement makes the UI feel unstable:
- New suggestions are matched against existing ones by normalized title (lowercase, trimmed).
- Match found: update the existing suggestion's fields (goal, taskType, scopePaths) in place.
- No match: append as a new suggestion.
- Existing suggestions not mentioned in the new turn: **preserved** (not removed).
- User dismissal: removes one suggestion cleanly from `session.draftTasks`.

**Chat panel — kickoff mode.** Suggested tasks are shown in the draft preview section during kickoff:
```
Suggested starter tasks:
  1. "Implement board representation" [implementation] — src/board/   [×]
  2. "Research move generation algorithms" [discovery]                [×]
```
The × button dismisses a suggestion. These are informational — no Create button during kickoff.

**After accepting state v1** — suggested tasks are NOT auto-created. Instead:
1. State v1 is created and mode transitions to steering.
2. Any remaining (non-dismissed) suggested tasks are shown as individual task cards in the chat, identical to steering-mode draft task cards.
3. Each card gets [Create] [Edit] [Dismiss] buttons.
4. Only explicit Create makes a real TaskNode.
5. Toast: "Project state v1 created. Review N suggested starter tasks below."

This keeps task creation deliberate — no magical clutter in the task tree.

---

### WS5: Navigation and feedback improvements

#### Toast actions

VS Code `showInformationMessage` supports action buttons. Use them:

After task creation:
```typescript
const action = await vscode.window.showInformationMessage(
  `Task "${title}" created.`,
  'Open Tasks Panel'
);
if (action === 'Open Tasks Panel') {
  vscode.commands.executeCommand('morticus-tasks.focus');
}
```

After state acceptance:
```typescript
const action = await vscode.window.showInformationMessage(
  `Project state v1 created.`,
  'Open State Panel'
);
if (action === 'Open State Panel') {
  vscode.commands.executeCommand('morticus.openStatePanel');
}
```

#### Non-optimistic card state

Don't change the task card to "Task created." until after the store confirms success. If the store throws, show an error on the card instead.

#### Task ID in chat

After task creation, include the task ID in the system-style confirmation within the chat: "Task 'Implement auth' created (task_xxx). Compile its spec when ready."

---

### WS6: Tests

| Test file | Covers |
|---|---|
| `test/unit/runtime/chat-adapter.test.ts` | Add: steering context rendering, draftTasks array parsing, task context in prompt |
| `test/unit/domain/chat.test.ts` | Add: draftTasks accumulation if `mergeDraftState` changes |
| New: `test/unit/ui/chat-context.test.ts` | TaskContext building logic (filtering active/completed/review tasks) |

No new integration tests — the existing flow tests cover the pipeline. The UX changes are webview HTML/JS which are manually tested.

---

## File-Level Implementation Impact

### Modified files

| File | Change | WS |
|---|---|---|
| `src/domain/chat.ts` | Add `draftTasks?: DraftTask[]` to `ChatTurnResult` | WS4 |
| `src/runtime/chat-adapter.ts` | Add `TaskContext` param, build steering context section, update kickoff prompt for draftTasks array, parse draftTasks | WS3, WS4 |
| `src/ui/webviews/chat-panel.ts` | Welcome messages, inline task editing, draft diff indicators, accept confirmation, post-accept message, suggested tasks display, non-optimistic card, navigation actions, missing-goal hint | WS1, WS2, WS4, WS5 |
| `src/ui/commands.ts` | Pass task list to chat panel if needed (or chat panel fetches directly from store) | WS3 |
| `test/unit/runtime/chat-adapter.test.ts` | Add steering context and draftTasks tests | WS6 |
| `test/unit/domain/chat.test.ts` | Update if ChatTurnResult type changes | WS6 |

### New files

| File | Purpose | WS |
|---|---|---|
| `test/unit/ui/chat-context.test.ts` | TaskContext building and filtering logic | WS6 |

### Not modified

| File | Reason |
|---|---|
| `src/domain/canonical-state.ts` | No new state fields |
| `src/domain/state-delta.ts` | No new operations |
| `src/storage/*` | No schema changes, no new stores |
| `src/review/*` | No review changes |
| `src/compiler/*` | No compiler changes |
| `package.json` | No new commands or views |

**Total: 6 modified files, 1 new test file. Zero new source files.**

This is a consolidation phase. No new architectural surface area.

---

## What Is Deferred to 4B

Everything from the original 4B list remains deferred. Additionally, the following were considered for 4A.5 and explicitly excluded:

| Feature | Why deferred |
|---|---|
| Phase transitions from chat | Requires delta proposal flow — different mechanic than task drafting |
| State update proposals from chat ("add a constraint...") | Same — requires delta creation from chat, review gate |
| Memory management from chat | Requires new message types and store integration |
| "What should we do next?" with deep analysis | Requires richer reasoning chain; current enriched context is a prerequisite, not the feature itself |
| Chat transcript compaction | Not needed until chat sessions grow long; sliding window of 20 is sufficient |
| Cost tracking per chat turn | Token estimation exists in context packs but not in chat; additive, not urgent |
| Draft-state diff as a formal review step | Overengineered for kickoff; the confirmation step in WS1 is sufficient |
| Multi-draftTask per steering turn | Steering mode should stay focused: one task per request, discuss, then next |

### Recommended first 4B slice (after 4A.5)

One of:
1. **"What should we do next?"** — grounded strategic suggestion using canonical state + task status + recent completions + phase goal. Returns a `draftTask`. Natural extension of the enriched context from WS3.
2. **State update proposals from chat** — "add a decision: use PostgreSQL" → draft delta → review panel. Natural extension of the work-spawning rule (non-task mutations).

Pick one. Ship it. Validate. Then the next.

---

## Implementation Order

| Step | Workstream | Dependencies |
|---|---|---|
| 1 | WS3: Enriched steering context | None — add `TaskContext` type to chat-adapter, wire into chat panel |
| 2 | WS4: Kickoff suggested tasks | Depends on understanding the chat adapter changes from WS3 |
| 3 | WS2: Inline task card editing | None — pure webview HTML/JS change |
| 4 | WS1: Chat UX improvements | Depends on WS4 (suggested tasks display in kickoff) |
| 5 | WS5: Navigation and feedback | Depends on WS1 (post-accept flow), WS2 (non-optimistic cards) |
| 6 | WS6: Tests | After all implementation |

WS2 and WS3 can run in parallel. WS1 and WS5 depend on earlier work.

---

## Verification

### Automated
- All existing 171 tests pass (no regressions)
- New chat adapter tests for steering context rendering
- New chat adapter tests for draftTasks array parsing
- New TaskContext filtering tests

### Manual E2E
1. Fresh project → chat opens → welcome message visible with example
2. Describe project → draft state shows with field-level change indicators
3. Refine → changed fields highlighted → accept button visible
4. Click Accept → confirmation step shown → Confirm → state v1 → post-accept guidance
5. If kickoff suggested tasks → shown in preview → created on accept
6. Steering mode → welcome message shown → "create a task to..." → card appears
7. Click Edit on card → fields become editable inline → Save → task created
8. Toast shows "Open Tasks Panel" action → clicking it focuses the panel
9. Claude sees active tasks in context → does not suggest duplicates
10. Chat card does not say "Task created." until backend confirms
