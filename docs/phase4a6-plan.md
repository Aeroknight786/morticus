# Phase 4A.6 — Chat Centrality and Continuity

## Status
Implemented and shipped. 206 tests, clean build.

## Problem

The chat works, but it doesn't feel central. Three specific gaps:

1. **Re-entry friction**: Chat auto-opens on project init, but for an existing project there's no natural way back in. Users must find `morticus.openChat` in the command palette. The chat feels like a side panel you visit, not the home surface of Morticus.

2. **Ephemeral post-accept tasks**: After accepting draft state in kickoff, suggested tasks are shown as webview cards. If the user closes the chat and reopens it, those cards are gone — the session's `draftTasks` array was cleared on accept (line 647 of chat-panel.ts). The user loses the suggestions they hadn't yet acted on.

3. **Minor continuity gaps**: The `ChatSession.draftTasks` comment says "created on state acceptance" which is stale (they're NOT auto-created anymore). No doc alignment with 4A.5 behavior.

## Scope

This is intentionally small — three concrete changes with minimal blast radius.

### 1. Guarded auto-open chat on project reopen

**Current behavior**: Chat auto-opens only on `initializeProject`. For an existing project (activated via `workspaceContains:.morticus/project.json`), nothing opens automatically. The user sees the sidebar trees and must manually open the chat.

**New behavior**: On extension activation, if the project is already initialized AND no Morticus webview panel is already visible/restored, auto-open the chat panel. Central, not intrusive.

**Guards**:
- Only auto-open if no Morticus webview is already visible (VS Code may restore panels from previous session via `retainContextWhenHidden`)
- Only fire once per activation (not on every workspace folder change)
- No workspace folder → no auto-open
- Future: may become a user setting (`morticus.chat.autoOpenOnProjectOpen`) but not in 4A.6

**Implementation**: In `src/extension.ts`, after the existing `if (initialized)` block, check if `chatPanel` already exists / is visible, and only then execute `morticus.openChat`. The `registerCommands` function needs to expose a way to check chat panel visibility, or the logic can be placed after command registration using a simple flag.

### 2. Persist pending suggested tasks with stable identity

**Current behavior**: On draft state acceptance, `handleAcceptDraftState` captures `this.session.draftTasks` into a local variable, then clears `this.session.draftTasks = []` and saves the session. The captured tasks are sent to the webview as `postAcceptTasks` — but only to the live webview. If the user closes the panel and reopens, those tasks are gone.

**New behavior**: Store pending suggested tasks on the ChatSession so they survive close/reopen. Each suggested task has a stable `suggestionId` for lifecycle operations.

**Design**:

#### Stable identity via `suggestionId`

Title-based matching for create/dismiss is too brittle — titles can be edited, and two tasks could share a title. Instead:

- Add `suggestionId: string` to `DraftTask` (optional field — only populated for tasks stored in `pendingSuggestedTasks`).
- When tasks move from `draftTasks` → `pendingSuggestedTasks` on accept, assign each a `suggestionId` (a short random ID, e.g. `nanoid(12)` — not a branded ID type, just a string for lifecycle tracking).
- Create/dismiss operations reference `suggestionId`, not title.
- The webview sends `suggestionId` in confirm/dismiss messages. The backend matches on it.
- `draftTasks` (kickoff accumulation) do NOT have `suggestionId` — it's only assigned at the moment of acceptance.
- The chat adapter does NOT produce `suggestionId` — it's a client-side lifecycle concern, not a Claude output.

#### Lifecycle

- **On accept**: move `draftTasks` → `pendingSuggestedTasks` (assign `suggestionId` to each). Clear `draftTasks`. Save session.
- **On chat reopen** (in `loadSession`): if `session.pendingSuggestedTasks.length > 0`, send them as `postAcceptTasks` so the webview re-renders the cards.
- **On task creation from a suggested card**: remove that task from `pendingSuggestedTasks` by `suggestionId` and save.
- **On dismiss from a suggested card**: remove from `pendingSuggestedTasks` by `suggestionId` and save.
- This reuses the existing webview card rendering — minimal UI changes (just pass `suggestionId` through).

**Why not a separate store?** `ChatSession` already persists in `.morticus/chat/main.json` and already has a `draftTasks` field for kickoff. Adding `pendingSuggestedTasks` keeps the lifecycle clear: `draftTasks` is kickoff-only (accumulated during conversation), `pendingSuggestedTasks` is post-accept (drained as user acts).

### 3. Doc and comment cleanup

- Update `ChatSession.draftTasks` comment to clarify it's kickoff-only, not auto-created
- Add `pendingSuggestedTasks` with clear comment
- Update `createChatSession` to initialize `pendingSuggestedTasks: []`
- Align build-log and todo with 4A.6 status

---

## File-Level Impact

### Modified Files

| File | Change | Lines |
|---|---|---|
| `src/domain/chat.ts` | Add `suggestionId?: string` to `DraftTask`. Add `pendingSuggestedTasks: DraftTask[]` to `ChatSession`. Update `createChatSession`. Update comments. | ~10 |
| `src/extension.ts` | Guarded auto-open chat on activation for initialized projects (only if no Morticus panel already visible). | ~8 |
| `src/ui/webviews/chat-panel.ts` | **Accept handler**: move draftTasks → pendingSuggestedTasks (assign suggestionIds). **loadSession**: re-send pendingSuggestedTasks on reopen. **Confirm/dismiss handlers**: match by suggestionId, drain from pendingSuggestedTasks. Webview JS: pass suggestionId in confirm/dismiss messages. | ~35 |
| `docs/todo.md` | Mark 4A.6 items as done | ~8 |
| `docs/build-log.md` | Add 4A.6 entry (after implementation) | — |

### New Files

| File | Purpose |
|---|---|
| `test/unit/domain/chat-pending-tasks.test.ts` | Tests for pendingSuggestedTasks lifecycle and suggestionId |

### Not Changed

| File | Reason |
|---|---|
| `src/storage/chat-store.ts` | No changes needed — it persists whatever is on `ChatSession`, and `pendingSuggestedTasks` is just another field. |
| `src/runtime/chat-adapter.ts` | No changes — parsing and prompt building are unaffected. `suggestionId` is not a Claude output. |
| `package.json` | No new commands or views. |

---

## Verification Plan

### Unit Tests
1. `createChatSession` initializes `pendingSuggestedTasks` as empty array
2. `DraftTask` with `suggestionId` serializes/deserializes correctly
3. After accept, `pendingSuggestedTasks` contains the former `draftTasks` with `suggestionId` assigned
4. After dismiss by `suggestionId`, correct task is removed from `pendingSuggestedTasks`
5. After create by `suggestionId`, correct task is removed from `pendingSuggestedTasks`
6. Dismiss/create with unknown `suggestionId` is a no-op (no crash)

### Manual E2E
7. Init new project → kickoff → describe project → get suggested tasks → accept → cards appear → close chat → reopen → cards still appear
8. Create one suggested task → close chat → reopen → remaining suggested tasks still visible, created one is gone
9. Dismiss a suggested task → close → reopen → dismissed task is gone
10. Existing initialized project → close VS Code → reopen workspace → chat opens automatically (only if no panel was restored)
11. All existing tests still pass

---

## What This Does NOT Do

- Does not add a sidebar chat tree view (over-scoped for 4A.6)
- Does not add chat transcript persistence beyond what already exists (messages are already persisted in ChatSession)
- Does not change the chat adapter, prompts, or structured output contract
- Does not add any new commands or views
- Does not touch the kickoff flow — only the post-accept suggested task lifecycle
- Does not add a user setting for auto-open (future — noted for later)

---

## After 4A.6

The next step is one narrow 4B slice: **4B.1 — "What should we do next?"**

Inputs: canonical state (goal, phase, phaseGoal, nextStep, risks), active tasks, recently completed tasks, awaiting review tasks.

Output: grounded strategic suggestion + optionally 1-2 draft tasks. No direct mutation.

This builds on the enriched steering context from 4A.5 (TaskContext, buildTaskContextSection) and the chat-as-home-surface from 4A.6.
