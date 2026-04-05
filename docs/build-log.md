# Build Log

## 2026-03-10: Phase 1 — Foundation + First Loop

### What was built

1. **Project scaffold**: package.json (VS Code extension manifest), tsconfig.json, esbuild bundler, vitest, .gitignore, directory structure.

2. **Domain layer** (`src/domain/`): Pure TypeScript types with zero external dependencies.
   - Branded ID types (ProjectId, TaskId, RunId, etc.) with generators
   - CanonicalProjectState with `createInitialState()` and `applyDeltaOperations()`
   - TaskNode with `TaskStatus`, `TASK_TRANSITIONS`, `canTransition()`, `transitionTask()`
   - StateDelta with typed `DeltaOperation` union (add/remove/set for each state field)
   - TaskSpec, TaskIntent, ContextPack, MergePolicy
   - TaskRun, NormalizedOutput, ProposedDelta
   - DurableMemory, MemoryEntry, MemoryCategory
   - EvidenceRef, EvidenceType
   - MorticusError with typed error codes

3. **Storage layer** (`src/storage/`): Local JSON persistence in `.morticus/` directory.
   - `json-backend.ts`: Atomic JSON read/write using temp-file-rename pattern
   - `StateStore`: Versioned state snapshots (full snapshots, not diff chains)
   - `TaskStore`, `DeltaStore`, `SpecStore`, `RunStore`, `MemoryStore`: CRUD for each entity
   - `ProjectStore`: Facade with `initialize()` that creates the full directory structure

4. **Compiler layer** (`src/compiler/`): Deterministic task spec compilation.
   - `policy.ts`: Maps task type → permissions (discovery=read-only, implementation=write, validation=read+test)
   - `spec-resolver.ts`: Deterministic function: TaskNode + State + Memory → TaskSpec
   - `context-pack.ts`: Assembles canonical state summary + memory + scope into text payload
   - `intent-extractor.ts`: STUB — passes through manual TaskIntent

5. **Review layer** (`src/review/`): Deterministic validation and delta application.
   - `delta-builder.ts`: Converts ProposedDelta → typed StateDelta with DeltaOperations
   - `validator.ts`: Checks stale base version, scope violations
   - `reconciler.ts`: STUB for Phase 1
   - `delta-applier.ts`: Applies accepted delta to state, persists both
   - `normalizer.ts`: STUB — empty output templates

6. **Extension UI** (`src/ui/`): VS Code integration.
   - `extension.ts`: Activation on `.morticus/` presence or init command
   - `commands.ts`: initializeProject, openStatePanel, createTask, compileTaskSpec, runTask, reviewDelta, refreshAll
   - `state-tree-provider.ts`: Sidebar tree showing canonical state fields
   - `task-tree-provider.ts`: Sidebar tree showing tasks with status icons
   - `state-panel.ts`: Webview for viewing/editing canonical state with diff-based delta computation
   - `review-panel.ts`: Webview showing delta operations with accept/reject
   - `status-bar.ts`: Shows project name + state version

### Key design choices

- **Full state snapshots**: Each state version is a complete JSON snapshot, not a diff chain. Simple reads, trivial at MVP scale.
- **Atomic writes**: Temp-file-rename prevents corruption on crash.
- **Phase 1 stubs**: Intent extraction (manual form), output normalization (empty templates), reconciler (returns empty). Interfaces are stable for Phase 2 upgrade.
- **runTask in Phase 1**: Skips actual Claude CLI execution. Uses VS Code input boxes to manually enter proposed delta fields. Still exercises the full delta → validate → review → apply pipeline.
- **No framework for webviews**: Raw HTML/CSS with postMessage protocol. Can add Lit/Preact later if needed.

### Validation

- 38 tests across 6 test files (domain, storage, compiler, review, integration)
- Integration test covers full init → task → compile → run → review → merge loop
- Extension builds in ~24ms with esbuild
- Build output: 45KB bundled

---

## 2026-03-11: Phase 2 — Runtime Layer

### What was built

1. **Claude CLI adapter** (`src/runtime/claude-adapter.ts`): Spawns `claude --print`, captures stdout, handles timeout and abort signals. Caches binary path after first lookup.

2. **Prompt builder** (`src/runtime/prompt-builder.ts`): Pure function rendering ContextPack into a prompt string. Includes structured output contract with `---MORTICUS-OUTPUT-START---` / `---MORTICUS-OUTPUT-END---` markers.

3. **Output normalizer** (`src/runtime/output-normalizer.ts`): Parses Claude's raw output for structured JSON between markers. Converts to typed `NormalizedOutput` with `ProposedDelta`. Falls back gracefully (zero confidence) when markers are missing.

4. **Run controller** (`src/runtime/run-controller.ts`): Full run lifecycle orchestration: create run → transition task → prepare worktree → build prompt → call Claude → persist raw output → collect artifacts → normalize → build delta → validate → link to task.

5. **Worktree manager** (`src/runtime/worktree-manager.ts`): Creates git worktrees for implementation tasks, passes through workspace root for read-only tasks.

6. **Artifact collector** (`src/runtime/artifact-collector.ts`): Captures git diff for implementation tasks after Claude executes in worktree.

### Key design choices

- **Single-shot `--print` mode**: No persistent Claude process. Each task run is a single prompt → single response. Consistent with fresh-from-snapshot principle.
- **Structured output contract**: The prompt includes a verbatim JSON template that Claude must fill in. The normalizer parses exactly this format. No ambiguity.
- **Error recovery**: On failure after run creation, run.status = 'failed', error re-thrown to UI. Task stays at 'running' — user can archive it.

### Validation

- 43 new tests (prompt-builder: 12, output-normalizer: 19, claude-adapter: 6, runtime integration: 6)
- 84 total tests, all passing (~1.6s)

---

## 2026-03-11: Phase 3 — Knowledge Accumulation & Project History

### What was built

1. **Extended MemoryEntry** (`src/domain/durable-memory.ts`): Added provenance fields (origin, sourceTaskId, sourceRunId, sourceDeltaId, sourceOperationType), review status (reviewed), and dedup field (normalizedValue). Auto-extracted entries default to `active: false`, `reviewed: false`.

2. **Context metrics** (`src/domain/task-run.ts`): ContextMetrics interface (estimatedTokens, activeMemoryEntryCount, stablePrefixLength) snapshotted at run creation for historical accuracy.

3. **Memory store CRUD** (`src/storage/memory-store.ts`): addEntry, updateEntry, removeEntry, getEntry methods with version bumping.

4. **Run store listing** (`src/storage/run-store.ts`): list(), getRawOutput(), getNormalizedOutput() for browsing run history.

5. **State version listing** (`src/storage/state-store.ts`): VersionSummary interface, listVersions() for state history timeline.

6. **Task retry** (`src/domain/task.ts`): `createRetryTask` pure function — new draft task from rejected/archived, with parentTaskId provenance.

7. **State diff** (`src/domain/state-diff.ts`): `diffStates` pure function comparing two state snapshots, `isDiffEmpty` helper.

8. **Knowledge extractor** (`src/review/knowledge-extractor.ts`): Deterministic extraction of `add_decision` operations into memory entries. Category: `architecture_invariant`. Dedup on `category + normalizedValue`.

9. **UI panels and tree views**:
   - `memory-tree-provider.ts`: Sidebar tree grouped by category with origin/active/reviewed badges
   - `run-tree-provider.ts`: Sidebar tree showing runs sorted by date
   - `memory-panel.ts`: Full CRUD webview. Active toggle disabled until reviewed. Editing auto-extracted content converts to `origin: 'user'`, `normalizedValue: null`.
   - `run-detail-panel.ts`: Read-only webview using `contextMetrics` snapshot (not mutable current spec).
   - `history-panel.ts`: Command-driven panel with version timeline and state diffs.

10. **Review panel accept hook**: On delta accept, runs `extractKnowledge` + `deduplicateEntries`, adds new memory entries, prompts user to review.

11. **Commands**: openMemoryPanel, addMemoryEntry, openHistoryPanel, openRunDetail, archiveTask, retryTask, editTask. Context menus for all task states.

### Key design choices

- **Active toggle gating**: Auto-extracted memory entries cannot be activated until reviewed. Prevents unreviewed auto-memory from polluting context packs.
- **Dedup on normalizedValue**: Content includes variable attribution text ("Source: task X"), so dedup uses the raw value separately.
- **Context metrics snapshot**: Run detail shows the metrics from when the run was created, not the current (possibly changed) state.
- **Editing auto-extracted entries**: Changing content converts origin to 'user' and clears normalizedValue. The user now owns it.
- **History as command-driven panel**: No sidebar tree — avoids sidebar bloat.

---

## 2026-03-12: Phase 4A — Conversational Onboarding + Task Drafting

### What was built

1. **Chat domain types** (`src/domain/chat.ts`): `DraftCanonicalState`, `DraftTask`, `ChatTurnResult`, `ChatMessage`, `ChatSession`, `createChatSession`, `mergeDraftState`. Branded IDs for `ChatSessionId`, `ChatMessageId`.

2. **Phase model fields**: `phaseGoal: string` and `phaseExitCriteria: string[]` on `CanonicalProjectState`. Delta operations: `set_phase_goal`, `add_phase_exit_criterion`, `remove_phase_exit_criterion`. State diff updated. State panel, state tree, and context-pack compiler all include phaseGoal.

3. **Chat adapter** (`src/runtime/chat-adapter.ts`): Single-shot per turn. Builds mode-specific system prompts (kickoff: extract project fields; steering: draft tasks, work-spawning rule). Structured output contract with `---MORTICUS-CHAT-START---` / `---MORTICUS-CHAT-END---` markers. `parseChatTurnResult` with full sanitization and graceful degradation.

4. **Chat storage** (`src/storage/chat-store.ts`): Single main session at `.morticus/chat/main.json`. Simple CRUD via json-backend.

5. **Chat panel** (`src/ui/webviews/chat-panel.ts`): Full webview with kickoff mode (draft state preview, accept button) and steering mode (draft task cards with confirm/edit/cancel). Mode auto-detection from canonical state. `handleAcceptDraftState` creates v1, transitions to steering. `handleConfirmTask` creates TaskNode. `handleEditTask` opens prefilled VS Code input boxes.

6. **Wiring**: `morticus.openChat` command. Auto-open chat on project init. Package.json updated.

### Key design choices

- **One `ChatTurnResult` per turn**: No separate classifier/drafter layers. Classification, extraction, and drafting all happen inside the Claude call via system prompt + structured output contract.
- **`DraftCanonicalState`**: Dedicated type instead of `Partial<CanonicalProjectState>`. All fields optional, accumulated across turns via `mergeDraftState` (arrays replace, scalars overwrite).
- **Graceful degradation**: Missing markers or malformed JSON → response-only mode. No crash, no data loss.
- **No initial-state delta review**: First canonical state from kickoff accepted directly (nothing to diff against).
- **Work-spawning rule**: Steering prompt instructs Claude to propose tasks for substantial requests rather than doing work inline.

### Validation

- 32 new tests (chat domain: 8, chat adapter: 17, phase fields: 7)
- 171 total tests, all passing (~1.1s)
- Build: 130KB, 14ms

---

## 2026-03-12: Phase 4A.5 — Conversational UX Consolidation

### What was built

1. **Chat UX improvements** (`src/ui/webviews/chat-panel.ts`): Welcome/system messages for kickoff and steering modes. Draft state diff indicators (`.field.changed` CSS class comparing previous vs current turn). Two-step accept confirmation (Accept → Confirm/Cancel). Post-accept system message with guidance. Missing-goal hint when no goal set.

2. **Inline task card editing**: Replaced sequential VS Code input boxes with inline editable fields on the task card itself. Edit mode: title/goal/taskType/scopePaths become inputs, buttons become Save/Cancel. No modal interruption.

3. **Enriched steering context** (`src/domain/chat.ts`, `src/runtime/chat-adapter.ts`): `TaskContext` type with active tasks, recently completed, and awaiting review. `buildTaskContextSection` renders context into steering prompt. `sendChatTurn` accepts optional `taskContext` parameter. Chat panel builds TaskContext from store before each steering turn.

4. **Kickoff suggested tasks**: `draftTasks?: DraftTask[]` on `ChatTurnResult`. Separate kickoff output contract requesting draftTasks array. `mergeDraftTasks` with merge-by-normalized-title semantics (case-insensitive, trimmed). Suggested tasks shown in kickoff draft preview with dismiss (×) buttons. Post-accept: shown as individual cards with Create/Edit/Dismiss — NOT auto-created as TaskNodes.

5. **Navigation and feedback**: Toast actions with "Open Tasks Panel" / "Open State Panel" buttons. Non-optimistic task card state (wait for backend `taskCreated` / `taskCreateFailed` messages). Task ID shown in chat after creation.

### Key design choices

- **No auto-create on accept**: Kickoff suggested tasks are NOT automatically created as TaskNodes when the user accepts draft state. They're shown as cards post-accept, and the user explicitly creates each one. Prevents unwanted task clutter.
- **Merge semantics for suggested tasks**: `mergeDraftTasks` matches by normalized title (lowercase, trimmed). Existing unmatched tasks are preserved. Users can dismiss individual suggestions. This replaces wholesale replacement across turns.
- **Separate output contracts**: Kickoff contract requests `draftState` + `draftTasks[]`. Steering contract requests `draftTask` (singular). Clear, non-overlapping expectations per mode.
- **Non-optimistic UI**: Task card shows "Creating..." state and waits for backend confirmation before showing success. Handles failure gracefully.

### Validation

- 24 new tests (mergeDraftTasks: 8, draftTasks parsing: 5, buildStateSummary: 6, buildTaskContextSection: 5)
- 195 total tests, all passing (~2s)
- Build: 146KB, 14ms

---

## 2026-03-12: Phase 4A.6 — Chat Centrality and Continuity

### What was built

1. **Guarded auto-open chat** (`src/extension.ts`): On extension activation for initialized projects, auto-open the chat panel. Fires once per activation — the chat is the home surface, not a hidden command-palette action.

2. **Persistent pending suggested tasks** (`src/domain/chat.ts`, `src/ui/webviews/chat-panel.ts`): Added `pendingSuggestedTasks: DraftTask[]` to `ChatSession`. On kickoff accept, draft tasks move here with a `suggestionId` assigned for stable lifecycle tracking. Cards survive chat close/reopen. Drained by `suggestionId` on create or dismiss.

3. **Stable task identity via `suggestionId`** (`src/domain/chat.ts`, `src/domain/ids.ts`): Optional `suggestionId` field on `DraftTask`. Assigned at accept time (not during kickoff accumulation, not by Claude). `generateSuggestionId()` uses the existing `makeId` pattern. Create/dismiss operations reference `suggestionId`, not title — avoids brittle title-based matching.

4. **Backward compatibility**: Sessions saved before 4A.6 (without `pendingSuggestedTasks`) are migrated on load with an empty array fallback.

### Key design choices

- **Central, not intrusive**: Auto-open fires once per activation, not on every window event. Future: may become a `morticus.chat.autoOpenOnProjectOpen` setting.
- **`suggestionId` over title matching**: Titles can be edited and two tasks could share a title. A stable ID prevents wrong-task removal.
- **No new stores**: `pendingSuggestedTasks` is just another field on the existing `ChatSession` persisted in `main.json`.

### Validation

- 11 new tests (pendingSuggestedTasks lifecycle: 9, generateSuggestionId: 2)
- 206 total tests, all passing (<1s)
- Build: 148KB, 14ms

---

## 2026-03-18: Phase 4B.1 — "What should we do next?"

### What was built

1. **Phase exit criteria in state summary** (`src/runtime/chat-adapter.ts`): `buildStateSummary` now includes `phaseExitCriteria` as a bullet list. Strategic reasoning requires knowing the acceptance criteria for the current phase — this field existed on `CanonicalProjectState` but was never rendered into the prompt.

2. **Recently completed task goals** (`src/domain/chat.ts`, `src/runtime/chat-adapter.ts`, `src/ui/webviews/chat-panel.ts`): `TaskContext.recentlyCompleted` now includes `goal: string`. The task context section renders goals inline so Claude can reason about what was accomplished, not just what was named.

3. **Multi-task strategic suggestions** (`src/runtime/chat-adapter.ts`): Steering output contract now includes `draftTasks` (array, 0-2 tasks) alongside the existing `draftTask` (singular). `draftTask` is for direct "create a task to..." requests. `draftTasks` is for strategic "what next" suggestions. The parser already handled both — no parsing changes needed.

4. **Strategic reasoning in steering prompt** (`src/runtime/chat-adapter.ts`): 7-point strategic reasoning protocol added to the steering system prompt guidelines. When the user asks about priorities or what to do next, Claude analyzes project goal, phase, exit criteria, task activity, risks, and nextStep to produce a grounded recommendation with optional task proposals.

5. **`draftTasks` on ChatMessage + webview rendering** (`src/domain/chat.ts`, `src/ui/webviews/chat-panel.ts`): `ChatMessage` now carries `draftTasks?: DraftTask[]` for persistence across chat close/reopen. The webview renders multiple task cards per assistant message using the existing `renderDraftTaskCard` function in steering mode (Confirm/Edit/Cancel).

### Key design choices

- **No new mode**: "What next" is a behavior within steering mode, not a separate chat mode. Claude decides when to apply strategic reasoning based on the user's question.
- **Reuse `draftTasks` in steering**: The same `draftTasks` array type used in kickoff mode is reused for steering strategic suggestions. The parser already handles it. No accumulation semantics — each "what next" response is standalone.
- **No direct mutation**: Strategic suggestions are informational + optional task proposals. No deltas, no state changes. The user creates tasks explicitly from the suggested cards.

### Validation

- 5 new tests (phaseExitCriteria in summary: 2, recently completed goals: 1, steering draftTasks parsing: 2)
- 211 total tests, all passing (<1s)
- Build: 149KB, 14ms

---

## 2026-03-18: Phase 4B.2 — Chat-Driven State Updates

### What was built

1. **Nullable `StateDelta.taskId`** (`src/domain/state-delta.ts`): `taskId` is now `TaskId | null`. Chat-originated deltas have no task — this is purely provenance. `createStateDelta` and `buildDelta` accept null. The review pipeline doesn't use `taskId` functionally.

2. **Optional spec in validator** (`src/review/validator.ts`): `validateDelta` now accepts `spec?: TaskSpec`. When no spec is provided (chat deltas), scope and read-only checks are skipped. Stale version check still runs — it's source-agnostic.

3. **Null taskId in review pipeline** (`src/ui/webviews/review-panel.ts`, `src/review/knowledge-extractor.ts`): ReviewPanel uses "Chat proposal" as the fallback title when `taskId` is null. Knowledge extractor accepts null taskId — memory entries from chat deltas will have `sourceTaskId: null`.

4. **`draftDelta` on chat types** (`src/domain/chat.ts`): `ChatTurnResult` and `ChatMessage` gain `draftDelta?: DeltaOperation[]`. Import added for `DeltaOperation` from `state-delta.ts`.

5. **Steering output contract + prompt** (`src/runtime/chat-adapter.ts`): `draftDelta` added to the steering output contract with documentation of all 14 valid operation types. System prompt gains state mutation guidance: Claude produces operations when the user explicitly requests state changes. Includes guidance for exact value matching on removals.

6. **Delta operation sanitizer** (`src/runtime/chat-adapter.ts`): `sanitizeDeltaOperation` validates each operation from Claude's output — checks type against 14 valid types, validates `value` vs `path` field depending on operation type (known_file ops use `path`, all others use `value`).

7. **Delta preview cards in chat** (`src/ui/webviews/chat-panel.ts`): New `renderDeltaCard` function renders operations as color-coded items (green=add, red=remove, blue=set) with a "Send to Review" button. Clicking sends the operations to the backend, which creates a `StateDelta`, validates against current state, saves it, and hands it to the ReviewPanel via the `onDeltaProposed` callback.

8. **Chat-to-review wiring** (`src/ui/commands.ts`): `ChatPanel` constructor now accepts an `onDeltaProposed` callback. The command registration provides the callback that creates/opens the ReviewPanel and calls `showDelta`.

### Key design choices

- **Reuse existing review pipeline**: Chat deltas go through the exact same ReviewPanel used for task-produced deltas. No new review UI — the delta just originates from chat instead of a task run.
- **Operations, not snapshots**: Claude produces typed `DeltaOperation[]` directly (e.g., `{ type: "add_constraint", value: "..." }`), not state snapshots that would need diffing. Maps directly to what the review pipeline expects.
- **No inline editing**: Delta operations are accepted or rejected in the ReviewPanel as-is. Inline editing in chat is deferred.
- **Confidence 1.0 for chat deltas**: User-initiated state changes get confidence 1.0 (vs task-produced deltas which carry the run's confidence score).

### Validation

- 12 new tests (sanitizeDeltaOperation: 6, draftDelta parsing: 4, validator no-spec: 2)
- 223 total tests, all passing (<1s)
- Build: 154KB, 15ms

---

### Next 4B candidates (deferred)

- Phase transitions from chat → draft delta → review (now just `set_phase` + `set_phase_goal` via existing 4B.2 mechanism)
- Memory update proposals from chat → draft memory entry

---

## 2026-03-18: Phase 5A — Schema Migration + Context Slicing

Two independent infrastructure slices addressing storage durability and context efficiency.

### Slice 1: Schema Migration

**Problem**: `project.schemaVersion = 1` existed but with zero migration logic. When any persisted type shape changes, existing `.morticus/` data would silently break.

**What was built**:

1. **Migration infrastructure** (`src/storage/migrator.ts`): Forward-only migration runner. `MigrationStep` interface takes `(morticusPath) => Promise<void>`, allowing each step to transform any files in `.morticus/`. `MIGRATIONS` registry is empty — steps added as real schema changes arise.

2. **Crash safety**: `project.schemaVersion` updated AFTER each step succeeds. If a crash interrupts mid-step, the version hasn't advanced, so the step re-runs. Each migration must be idempotent by contract.

3. **Version guard**: `runMigrations` throws `SCHEMA_VERSION_TOO_NEW` if the project was created by a newer extension version.

4. **Testability**: `runMigrationsWithSteps` exported separately — tests inject their own step functions without touching the global registry.

5. **Integration**: `ProjectStore.ensureMigrated()` runs once per session (idempotent flag). Called both at extension activation and inside `getProject()` as a safety net.

### Slice 2: Context Slicing

**Problem 1 — Memory duplication**: `buildStablePrefix` and `buildMemoryEntries` were called independently, producing the same strings. `prompt-builder.ts` rendered both — every active memory entry appeared twice in the final prompt.

**Problem 2 — No filtering**: All 7 memory categories included for all task types regardless of relevance. A discovery task received `test_convention` entries.

**Problem 3 — No token budget**: `estimatedTokens` tracked but never enforced. Large projects would produce unbounded context packs.

**What was built**:

1. **Deduplication fix** (`src/compiler/context-pack.ts`): Memory entries built ONCE, placed in `stablePrefix` only. `relevantMemoryEntries` always `[]`. No prompt-builder changes needed — existing `length > 0` guard handles it.

2. **Category filtering** (`ContextPackOptions`): `includeCategories` (whitelist) and `excludeCategories` (blacklist) with null defaults preserving existing behavior. Filter pipeline: `active → includeCategories → excludeCategories → maxMemoryEntries`.

3. **Token budget** (`ContextPackOptions.maxTokens`): Priority-based trimming when over budget — knownFiles first, then risks, decisions, stablePrefix. Never trims taskGoal, scopeDescription, or constraints. Deterministic, at most 4 iterations.

4. **Task-type defaults** (`src/compiler/spec-resolver.ts`): Discovery tasks now `excludeCategories: ['test_convention']`. Validation tasks now `excludeCategories: ['domain_glossary']`.

### Key design choices

- **Empty MIGRATIONS registry**: The migration infrastructure is dormant until needed. First real migration step added when someone actually changes a persisted type shape.
- **Memory in stablePrefix only**: This is the prompt-caching-friendly zone. After category filtering, the included set varies per task, but the key architectural property is structural separation, not immutability.
- **Null defaults everywhere**: All new `ContextPackOptions` fields default to null (no filtering, no budget), so existing behavior is 100% preserved unless the caller opts in.
- **Never trim safety-critical content**: taskGoal, scopeDescription, and constraints survive even the tightest token budget.

### Validation

- 25 new tests (migrator: 9, context-pack: 14, spec-resolver: 2)
- 248 total tests, all passing (<1s)
- Build: 157KB, 11ms
- Lint: clean

---

## 2026-03-19: Phase 6 — Chat as Coherent Home Surface

**Problem**: UX fragmentation — 4 tree views, 7 webview panels, 14 commands, and a task lifecycle requiring 4 separate manual clicks (Create → Compile → Run → Review). Chat panel was a dead end after review.

**What was built**:

1. **Project snapshot in chat** (WS1): Compact always-visible state summary at the top of steering mode — goal, phase, next step, active/review task counts, state version. `buildProjectSnapshot()` reads current state + task list. Included in init message and refreshable via `refreshSnapshot()`.

2. **Create & Run flow** (WS2): One-click task lifecycle from chat. "Create & Run" button on every task card (alongside existing "Create Draft") triggers: create task → compile spec → run via RunController → open review panel. Progress indicators update in real-time ("Compiling spec...", "Running task...", "Run complete — review ready (confidence: 85%)").

3. **Post-review routing** (WS3): `onReviewComplete` callback on ReviewPanel fires after accept/reject with outcome details (decision, new version, summary, task title). `createReviewPanel` helper in commands.ts routes outcomes back to chat as system messages ("State updated to v2. 3 operations applied.") and refreshes the snapshot.

4. **Kickoff completeness cues** (WS4): `renderCompleteness()` shows warn/hint/note indicators below draft state fields (missing goal = warning, no phase = hint, no constraints = note). Accept button shows dynamic summary text ("Accept Draft State (goal set, phase set, 3 constraints)").

### Files changed

| File | Changes |
|---|---|
| `src/domain/chat.ts` | `ProjectSnapshot` interface (added in prior session) |
| `src/ui/webviews/chat-panel.ts` | Snapshot UI (CSS/HTML/JS/TS), dual task buttons, `handleConfirmAndRunTask`, completeness cues, `postSystemMessage`/`refreshSnapshot` public methods, `onRunComplete` constructor param |
| `src/ui/webviews/review-panel.ts` | `onReviewComplete` callback, taskTitle lookup in reject path |
| `src/ui/commands.ts` | `createReviewPanel` helper with review→chat routing, `onRunComplete` callback wiring |

### Validation

- 248 tests, all passing (<1s)
- Build: 166KB, 65ms
- Lint: clean

---

## 2026-03-19: Phase 4B.3 — Chat-Driven Phase Transitions

**Problem**: Users could update individual state fields from chat (4B.2), but phase transitions — moving from "design" to "implementation" — had no dedicated guidance. Claude would only set the phase name without composing a complete transition (new goal, cleared old criteria, new criteria, next step). Additionally, clearing exit criteria required N individual `remove_phase_exit_criterion` operations with exact text matching.

**What was built**:

1. **`clear_phase_exit_criteria` delta operation**: New valueless operation type that resets `phaseExitCriteria` to `[]`. Added to `DeltaOperation` union, `applyDeltaOperations`, `sanitizeDeltaOperation` (valueless path), `VALID_DELTA_TYPES`, and the steering output contract.

2. **Steering prompt phase transition guidance**: Dedicated instruction block teaching Claude to compose complete phase transitions (set_phase + set_phase_goal + clear_phase_exit_criteria + add_phase_exit_criterion + set_next_step). Also instructs Claude to consider suggesting phase transitions when exit criteria appear met during "what to do next" analysis.

3. **Delta card rendering fix**: Both chat-panel.ts and review-panel.ts now handle valueless operations cleanly (no trailing colon/space for `clear_phase_exit_criteria`).

### Files changed

| File | Changes |
|---|---|
| `src/domain/state-delta.ts` | +`clear_phase_exit_criteria` to DeltaOperation union |
| `src/domain/canonical-state.ts` | +case in applyDeltaOperations |
| `src/runtime/chat-adapter.ts` | +VALID_DELTA_TYPES, +sanitizer valueless path, +output contract text, +steering prompt phase transition guidance |
| `src/ui/webviews/chat-panel.ts` | Delta card renders valueless ops cleanly |
| `src/ui/webviews/review-panel.ts` | Review panel renders valueless ops cleanly |

### Validation

- 6 new tests (phase-fields: 3, chat-adapter sanitizer: 2, draftDelta parsing: 1)
- 254 total tests, all passing (<1s)
- Build: 167KB, 53ms
- Lint: clean

---

## 2026-03-19: Phase 4B (Remaining) + 4C — Chat Intelligence & Task Workspace

### What was built

Four workstreams completing the chat intelligence features and adding a task workspace panel:

**WS1: Memory Update Proposals from Chat (4B.4)**
- `DraftMemoryEntry` interface in `src/domain/chat.ts` with category, title, content
- `draftMemory?: DraftMemoryEntry[]` on `ChatTurnResult` and `ChatMessage`
- `sanitizeDraftMemoryEntry()` in chat-adapter.ts — validates category, requires title+content
- Parser integration: draftMemory array parsed from structured JSON output
- Output contract: draftMemory field documented in steering output schema
- Steering prompt guidance: propose draftMemory for conventions, standards, domain terms
- Memory card rendering in chat-panel.ts (purple-accented cards with Add/Dismiss)
- `handleConfirmMemory()` — creates MemoryEntry with origin='user', active=true, reviewed=true

**WS2: Task Detail Panel (4C)**
- `listByTask(taskId)` on RunStore — filter runs by task
- New `src/ui/webviews/task-detail-panel.ts` (~160 lines):
  - Shows task metadata, goal, status badge (color-coded by status)
  - Compiled spec summary (tools, write permissions, est. tokens, compiled timestamp)
  - Run history with duration and truncated run ID
  - Candidate delta display with color-coded operations
  - Contextual action bar (Compile/Run/Review/Archive/Retry based on status)
- `morticus.openTaskDetail` command registered in commands.ts
- Package.json: added command definition
- Task tree items now click to open the detail panel (command on TreeItem)

**WS3: Deterministic Intent Pre-Classification (4B.5)**
- New `src/runtime/intent-classifier.ts`:
  - `classifyIntent(text, mode)` — regex-based classification of simple state/task queries
  - `generateLocalResponse(intent, state, taskContext)` — formats state fields or task lists
  - Kickoff mode always delegates to Claude
  - Handles: goal, phase, nextStep, constraints, decisions, risks, exit criteria, active tasks, awaiting review
- Integration in chat-panel.ts `handleSendMessage()` — short-circuits before Claude call

**WS4: Transcript Compaction (4B.6)**
- Enhanced `formatMessages()` in chat-adapter.ts with token budget:
  - Max 20 messages from the tail (unchanged cap)
  - 12K token budget with front-trimming
  - Minimum 6 messages preserved (3 turns of context)

### Key files changed

| File | Changes |
|---|---|
| `src/domain/chat.ts` | +DraftMemoryEntry, +draftMemory on ChatTurnResult and ChatMessage |
| `src/runtime/chat-adapter.ts` | +sanitizeDraftMemoryEntry, +parser, +output contract, +prompt guidance, +formatMessages token budget (exported) |
| `src/runtime/intent-classifier.ts` | NEW: classifyIntent, generateLocalResponse |
| `src/ui/webviews/chat-panel.ts` | +memory card rendering, +confirmMemory handler, +intent pre-classification, +draftMemory on assistant message |
| `src/ui/webviews/task-detail-panel.ts` | NEW: task workspace webview |
| `src/storage/run-store.ts` | +listByTask() |
| `src/ui/commands.ts` | +TaskDetailPanel import, +morticus.openTaskDetail command |
| `src/ui/tree-views/task-tree-provider.ts` | +command on TaskItem click |
| `package.json` | +openTaskDetail command |
| `test/unit/runtime/chat-adapter.test.ts` | +memory sanitizer (4), +draftMemory parsing (4), +transcript compaction (4) |
| `test/unit/runtime/intent-classifier.test.ts` | NEW: 19 tests (classifyIntent + generateLocalResponse) |

### Validation

- 31 new tests (memory: 8, intent classifier: 19, transcript compaction: 4)
- 285 total tests, all passing (<4s)
- Build: 185KB, 27ms
- Lint: clean

---

## 2026-03-19: Phase 5 — Checkpoint + Resume from State

### What was built

**Goal**: Let users go down bad paths without polluting future context. Resume from any prior state version, archive active tasks, and compile fresh context from the chosen snapshot.

**What this is**: checkpoint (named bookmarks on state versions) + resume (repoint current state to any historical version, archiving active tasks). Version history forms a DAG via `parentVersion`.

**What this is NOT**: git-style branching. No named branches, no merge operations, no divergent branch tree UI. That's deferred to Phase 12 (Generation Navigation UI).

1. **Domain types** (`src/domain/canonical-state.ts`, `src/domain/checkpoint.ts`, `src/domain/ids.ts`):
   - `parentVersion: StateVersion | null` on `CanonicalProjectState` — tracks derivation lineage (which version this state was derived from, not chronological predecessor)
   - `Checkpoint` interface with id, version, label, createdAt
   - `CheckpointId` branded type and `generateCheckpointId()`

2. **Storage layer** (`src/storage/state-store.ts`, `src/storage/checkpoint-store.ts`, `src/storage/store.ts`):
   - `getNextVersion()` — scans version files, returns max+1 (prevents collision after resume)
   - `setCurrentVersion()` — repoints current.json without creating version file
   - `parentVersion` added to `VersionSummary`
   - `CheckpointStore` — simple JSON persistence at `.morticus/checkpoints.json` (list, add, remove)
   - `ProjectStore` gains `checkpoints` sub-store

3. **Schema migration** (`src/storage/migrator.ts`):
   - `CURRENT_SCHEMA_VERSION` bumped from 1 to 2
   - v1→v2 migration step: backfills `parentVersion` on existing state snapshots (null for v1, version-1 for others)
   - Idempotent: skips snapshots that already have parentVersion

4. **Resume orchestrator** (`src/review/resume-orchestrator.ts`, new):
   - `resumeFromVersion(store, targetVersion)` — verifies target exists, archives all non-terminal tasks, repoints current version
   - Returns `ResumeResult` with resumed version and archived task IDs
   - No UI dependencies — pure orchestration

5. **Version collision fix** (`src/review/delta-applier.ts`, `src/ui/webviews/state-panel.ts`):
   - Both now use `getNextVersion()` instead of relying on `current.version + 1`
   - After resuming from v1 when v2-v3 exist, new deltas produce v4 (not v2)

6. **History panel** (`src/ui/webviews/history-panel.ts`):
   - "Resume from here" button per version (not shown on current)
   - "Save checkpoint" button per version (not shown if already checkpointed)
   - Current version badge (green "current" label)
   - Checkpoint labels displayed next to versions
   - "resumed from vN" label for non-linear versions (orange accent)
   - parentVersion-aware diffs (uses actual parent, not always version-1)
   - `onResume` and `onCheckpoint` callbacks from constructor

7. **Commands** (`src/ui/commands.ts`, `package.json`):
   - `morticus.resumeFromVersion` — previews affected tasks by name and count, modal confirmation, detailed chat system message with archived task names, snapshot refresh
   - `morticus.createCheckpoint` — prompts for label, persists to CheckpointStore
   - History panel wired to both commands via callbacks

### Files changed

| File | Change |
|---|---|
| `src/domain/canonical-state.ts` | +parentVersion on interface, createInitialState, applyDeltaOperations |
| `src/domain/checkpoint.ts` | NEW: Checkpoint interface |
| `src/domain/ids.ts` | +CheckpointId, +generateCheckpointId |
| `src/storage/state-store.ts` | +getNextVersion, +setCurrentVersion, +parentVersion on VersionSummary |
| `src/storage/checkpoint-store.ts` | NEW: CheckpointStore class |
| `src/storage/store.ts` | +checkpoints sub-store |
| `src/storage/migrator.ts` | CURRENT_SCHEMA_VERSION=2, +v1→v2 migration |
| `src/review/resume-orchestrator.ts` | NEW: resumeFromVersion() |
| `src/review/delta-applier.ts` | Fix: getNextVersion() for safe versioning |
| `src/ui/webviews/state-panel.ts` | Fix: getNextVersion() for safe versioning |
| `src/ui/webviews/history-panel.ts` | +resume/checkpoint buttons, current badge, parentVersion diffs |
| `src/ui/commands.ts` | +resumeFromVersion, +createCheckpoint commands |
| `package.json` | +2 commands |

### Validation

- Tests cover: parentVersion lineage, getNextVersion/setCurrentVersion, checkpoint CRUD, resume orchestration, schema migration v1→v2, plus integrated corner cases: resume→accept delta→correct version+parentVersion, multiple sequential resumes, checkpoint persistence across resumes, current pointer coherence
- Build: 194KB
- Lint: clean

---

## 2026-03-20: Phase 6 — Scratchpad Mode v1

**Problem**: When users need to brainstorm, research alternatives, or explore "what if" scenarios, doing so in the main chat risks polluting the strategic trunk with exploratory noise. There's no way to think freely and then selectively bring back only the useful conclusions.

**What was built**:

A temporary exploratory side-workspace ("scratchpad") that is structurally separate from the main chat. The scratchpad has its own session, adapter, and storage. Normal turns produce response-only output (no mutation parsing) — mutations are structurally impossible during exploration. Only a structured handoff crosses back to the main chat.

1. **Domain types** (`src/domain/scratchpad.ts`, `src/domain/ids.ts`):
   - `ScratchpadSession` with id, parentChatSessionId, parentContextSummary, origin, status, messages, handoff
   - `ScratchpadHandoff` — summary, keyFindings, unresolvedQuestions, optional candidateTask, optional candidateDelta (no candidateMemory in v1)
   - `ScratchpadOrigin` — goal/phase/phaseGoal frozen at spawn time
   - `parseScratchpadHandoff()` — defensive parser handling missing/malformed fields from Claude output
   - `ScratchpadId` branded type and `generateScratchpadId()`

2. **Storage** (`src/storage/scratchpad-store.ts`, `src/storage/store.ts`):
   - One file per session at `.morticus/scratchpad/<id>.json`
   - `getActive()` returns the single active session (v1: one at a time)
   - Wired into `ProjectStore.scratchpad`

3. **Runtime adapter** (`src/runtime/scratchpad-adapter.ts`, `src/runtime/chat-adapter.ts`):
   - `sendScratchpadTurn()` — response only, no structured output parsing
   - `requestScratchpadHandoff()` — requests and parses structured handoff
   - Separate markers: `---MORTICUS-SCRATCHPAD-HANDOFF-START/END---`
   - `buildParentContextSummary()` — compiles compact frozen context from state, memory, recent messages, task context

4. **Scratchpad panel** (`src/ui/webviews/scratchpad-panel.ts`):
   - Amber/orange visual theme for clear differentiation from main chat
   - Origin chip showing "From: Main Chat", goal snippet, phase
   - "End Scratchpad" button triggers handoff generation
   - Handoff card with action buttons: Create Task, Send to Review, Archive, Discard, Continue Exploring
   - Auto-archive on panel close without handoff (with informational toast)
   - `ScratchpadHandoffAction` discriminated union type for dispatching actions back to commands

5. **Chat panel integration** (`src/ui/webviews/chat-panel.ts`):
   - `injectDraftTask()` — injects candidate task card from external source (e.g. scratchpad handoff)
   - `routeDeltaToReview()` — routes delta through existing review flow
   - "Scratchpad" button in input area (steering mode only, amber-themed)
   - `openScratchpad` message handler fires the VS Code command

6. **Command wiring** (`src/ui/commands.ts`, `package.json`):
   - `morticus.openScratchpad` — checks for existing active scratchpad (reopens) or creates new session with frozen parent context
   - Handoff action routing: create_task → injects into chat, send_draft_update → routes through existing ReviewPanel, archive → system message, discard → toast

### Key design choices

- **Structurally separate from main chat**: Scratchpad has its own session, adapter, and storage. Not a new mode on the existing ChatSession.
- **Response-only adapter**: `sendScratchpadTurn()` returns `{ response: string }` — no structured output parsing. Mutations are impossible by construction, not by instruction.
- **Frozen parent context**: Context summary built at spawn time and never updated. The scratchpad sees a snapshot, not a live feed.
- **Handoff as the only bridge**: Raw scratchpad transcript stays in the scratchpad. Only the structured handoff (summary, findings, questions, optional candidates) crosses back.
- **Send to Review routes through existing flow**: `candidateDelta` in the handoff goes through `ChatPanel.routeDeltaToReview()` → `handleReviewDelta()` → ReviewPanel. No new review path.
- **Auto-archive, not auto-discard**: If the user closes the panel via X without doing a handoff, the session is archived (not lost). They can reopen it later.

### Files changed

| File | Change |
|---|---|
| `src/domain/ids.ts` | +ScratchpadId, +generateScratchpadId |
| `src/domain/scratchpad.ts` | NEW: ScratchpadSession, ScratchpadHandoff, ScratchpadOrigin, createScratchpadSession, parseScratchpadHandoff |
| `src/storage/scratchpad-store.ts` | NEW: ScratchpadStore (save, get, getActive, list) |
| `src/storage/store.ts` | +scratchpad sub-store |
| `src/runtime/scratchpad-adapter.ts` | NEW: sendScratchpadTurn, requestScratchpadHandoff, parseScratchpadHandoffResponse |
| `src/runtime/chat-adapter.ts` | +buildParentContextSummary |
| `src/ui/webviews/scratchpad-panel.ts` | NEW: ScratchpadPanel, ScratchpadHandoffAction |
| `src/ui/webviews/chat-panel.ts` | +injectDraftTask, +routeDeltaToReview, +scratchpad button, +openScratchpad handler |
| `src/ui/commands.ts` | +morticus.openScratchpad command with full handoff routing |
| `package.json` | +openScratchpad command |

### Validation

- 20 new tests (scratchpad domain: 8, adapter handoff parsing: 6, buildParentContextSummary: 6)
- 326 total tests, all passing (<1s)
- Build: 227KB, 24ms
- Lint: clean

---

## 2026-03-19: Chat Home Surface — Tightening Pass

**Problem**: The "Chat as Coherent Home Surface" implementation had several rough edges discovered during review.

**Issues found and fixed**:

1. **`ProjectSnapshot` in wrong layer**: Was defined in `src/domain/chat.ts` but is purely a view model — never stored, never used by runtime/compiler/review. Moved to `src/ui/webviews/chat-panel.ts` as a local interface.

2. **Task creation logic duplicated**: `handleConfirmTask()` and `handleConfirmAndRunTask()` duplicated 15 lines of task creation (get project, compute readOnly, createTask, save, drain pendingSuggestedTasks). Extracted `createTaskFromDraft()` shared helper. Both methods now call it.

3. **Snapshot not refreshed on reject**: `createReviewPanel()` in commands.ts called `chatPanel.refreshSnapshot()` on accept but NOT on reject. After rejection, `awaitingReviewCount` in the snapshot became stale. Added `refreshSnapshot()` to the reject branch.

4. **Task status stuck after review**: ReviewPanel accepted/rejected the *delta* but never transitioned the *task*. Tasks remained in `awaiting_review` forever after review. Added `transitionTask(task, 'merged')` on accept and `transitionTask(task, 'rejected')` on reject (only when `delta.taskId` is non-null and task is still `awaiting_review`).

5. **Phase numbering drift in docs**: todo.md had phases in chaotic order (5A → 6 → 4B.3 → 4B → 4C → 5). Reorganized into logical order. Removed fake "Phase 6" numbering — this is "Chat as Coherent Home Surface" without a phase number since it's an intermediate strengthening step, not a roadmap phase. Updated roadmap.md current state and sequencing to reflect reality.

### Files changed

| File | Change |
|---|---|
| `src/domain/chat.ts` | Removed `ProjectSnapshot` interface |
| `src/ui/webviews/chat-panel.ts` | +local `ProjectSnapshot` interface, +`createTaskFromDraft()` helper, simplified `handleConfirmTask` and `handleConfirmAndRunTask` |
| `src/ui/webviews/review-panel.ts` | +`transitionTask` import, +task→merged on accept, +task→rejected on reject |
| `src/ui/commands.ts` | +`chatPanel.refreshSnapshot()` on reject branch |
| `docs/todo.md` | Reorganized phase order, unnumbered "Chat as Home Surface", updated entries |
| `docs/build-log.md` | +tightening pass entry |
| `roadmap.md` | Updated current state, gaps, sequencing |

## 2026-03-20: Phase 9 — Context Slicing and Cost Governance

### What was built

Per-surface context policies that control which state fields, memory entries, and token budgets are used for each context surface (task runs, chat steering, chat kickoff, scratchpad). Scope-based filtering narrows knownFiles, decisions, and risks to task-relevant subsets. Keyword-based relevance scoring filters memory entries. Context manifests record what was included/excluded and why, persisted into run metrics for debugging.

### Key design decisions

1. **Pure domain layer**: All context policy types and scoring functions live in `src/domain/context-policy.ts` with zero external dependencies. Profiles are resolved deterministically from surface + task type + scope paths.

2. **Profile-driven, override-friendly**: `resolveContextProfile()` returns default settings per surface. `spec-resolver.ts` maps profiles to `ContextPackOptions`, but callers can still override individual fields. No breaking changes to existing call sites.

3. **Scope filtering is path-based for files, keyword-based for text**: `filterByScope()` uses path prefix matching for knownFiles. `filterByScopeKeywords()` tokenizes scope paths and matches by keyword overlap for decisions/risks — appropriate since these are natural language.

4. **Relevance scoring is deterministic**: `scoreKeywordRelevance()` tokenizes text, removes stopwords, and counts keyword matches. No LLM. Threshold of 1 means "at least one keyword must match."

5. **Manifest for observability**: Every context pack now carries a `ContextManifest` recording: which state fields were included/excluded, scope filter effects, memory inclusion/exclusion with reasons, and any trimming applied. `buildContextDiagnostics()` renders this as human-readable text, persisted in `ContextMetrics.contextDiagnostics`.

### Profile defaults

| Surface | Tokens | Decisions | Risks | KnownFiles | ExitCriteria | Memory | Scope filter |
|---|---|---|---|---|---|---|---|
| task_run (discovery) | 8K | No | No | Yes | No | excl. test_convention | If scope paths |
| task_run (implementation) | 16K | Yes | Yes | Yes | No | All | If scope paths |
| task_run (validation) | 12K | Yes | No | Yes | Yes | excl. domain_glossary | If scope paths |
| chat_steering | 6K sys / 12K conv | Yes | Yes | Yes | Yes | Max 20 | No |
| chat_kickoff | 2K sys / 12K conv | No | No | No | No | All | No |
| scratchpad | 4K | No | No | No | No | Max 15 | No |

### Files changed

| File | Change |
|---|---|
| `src/domain/context-policy.ts` | NEW: types + pure scoring/filtering/profile functions |
| `src/domain/task-spec.ts` | +`includePhaseExitCriteria`, `memoryRelevanceThreshold`, `relevanceKeywords`, scope filter options on `ContextPackOptions`; +`contextManifest` on `ContextPack` |
| `src/domain/task-run.ts` | +`memoryIncluded`, `memoryExcluded`, `contextDiagnostics` on `ContextMetrics` |
| `src/domain/chat.ts` | +`contextTokenEstimate` on `ChatTurnResult` |
| `src/compiler/context-pack.ts` | Scope filtering, relevance scoring, manifest generation, phaseExitCriteria, exported `buildStateSummary` |
| `src/compiler/spec-resolver.ts` | Uses `resolveContextProfile` + `extractRelevanceKeywords` instead of hardcoded defaults |
| `src/runtime/chat-adapter.ts` | Profile-driven memory limiting, conversation token budget, context token estimate |
| `src/runtime/scratchpad-adapter.ts` | Profile-driven memory limiting |
| `src/runtime/run-controller.ts` | Persists manifest diagnostics into `ContextMetrics` |
| `src/ui/webviews/run-detail-panel.ts` | Displays memory counts, expandable context diagnostics |
| `test/unit/domain/context-policy.test.ts` | NEW: 23 tests |
| `test/unit/compiler/context-pack.test.ts` | +11 tests (scope filtering, relevance scoring, manifest, phaseExitCriteria) |
| `test/unit/compiler/spec-resolver.test.ts` | Updated 2 tests to isolate category filtering from relevance filtering |

### Metrics

- Tests: 362 (was 328, +34)
- Bundle: 244KB
- Lint: clean

## 2026-03-21: Phase 8A — Transcript Import / Migration with Minimal Archive Foundation

### What was built

End-to-end import pipeline for bringing external transcripts and planning docs into Morticus's structured model. Users can import `.md` or `.txt` files, have them parsed deterministically into chunks, extract structured project data via Claude, review and selectively accept state, memory entries, and tasks — all through a multi-step wizard webview. Raw imported content is archived for later retrieval.

### Key design decisions

1. **Import never auto-applies**: Everything goes through review. State changes route through the existing ReviewPanel (for post-kickoff) or create initial state directly (pre-kickoff). Memory entries are created as `active: false, reviewed: false`. Tasks appear as draft cards in chat.

2. **Deterministic parse + LLM extract**: The pipeline splits cleanly. Parsers are pure functions (no LLM) that detect format and chunk content. Extraction uses a single-shot Claude call with structured markers, reusing existing sanitizers (`sanitizeDraftState`, `sanitizeDraftTask`, `sanitizeDraftMemoryEntry`) for defensive parsing.

3. **Bookend strategy for large transcripts**: If estimated tokens exceed 30K, the extractor takes chunks from the beginning and end (~15K each), runs a primary extraction, then processes overflow chunks with the summary from pass 1 as context. Pass 2 failures are non-fatal.

4. **Conflict detection is pure**: `detectImportConflicts()` compares imported draft state against existing canonical state. Scalar fields use word-overlap scoring for severity (override/warning/info). Array fields check for exact-match duplicates (case-insensitive).

5. **Archive as persistent artifact**: Each import creates an `ArchiveRecord` with metadata, chunks, extraction results, conflicts, and acceptance log. Raw content stored separately as `source.txt`. Storage layout: `.morticus/archive/<archiveId>/record.json` + `source.txt`.

6. **Schema migration v2→v3**: Adds `sourceArchiveId: null` to all existing memory entries. Idempotent — skips entries that already have the field.

### Import flow

1. User runs `Morticus: Import Transcript` → file picker (`.md`, `.txt`)
2. Parse: format auto-detected (markdown transcript, text chat dump, planning doc), content chunked
3. Preview: source info, chunk preview in ImportPanel
4. Extract: Claude call with extraction prompt → structured JSON parsed with defensive sanitizers
5. Review: state fields (with conflict badges), memory entries (with duplicate detection), tasks — all with checkboxes
6. Apply: selected items route through appropriate paths (delta review, memory store, draft task injection)
7. Archive: record persisted with acceptance log, chat receives summary message

### Files changed

| File | Change |
|---|---|
| `src/domain/import.ts` | NEW: all import domain types + `createArchiveRecord()` factory |
| `src/domain/ids.ts` | +`ArchiveId` branded type + `generateArchiveId()` |
| `src/domain/durable-memory.ts` | +`'imported'` origin, +`sourceArchiveId` field |
| `src/domain/errors.ts` | +`IMPORT_PARSE_ERROR`, `IMPORT_EXTRACTION_ERROR` |
| `src/runtime/transcript-parser.ts` | NEW: `detectImportFormat`, `parseMarkdownTranscript`, `parseTextChatDump`, `parsePlanningDoc`, `parseImportSource` |
| `src/runtime/import-extractor.ts` | NEW: extraction prompt, response parsing, bookend chunking strategy |
| `src/runtime/import-conflict-detector.ts` | NEW: pure conflict detection with word-overlap severity scoring |
| `src/runtime/chat-adapter.ts` | Exported `sanitizeDraftState`, `sanitizeDraftTask` |
| `src/storage/archive-store.ts` | NEW: `ArchiveStore` (save, get, list, saveRawContent, getRawContent) |
| `src/storage/store.ts` | +`archive: ArchiveStore` on ProjectStore |
| `src/storage/migrator.ts` | v2→v3 migration for `sourceArchiveId` backfill, `CURRENT_SCHEMA_VERSION = 3` |
| `src/ui/webviews/import-panel.ts` | NEW: multi-step import wizard webview |
| `src/ui/commands.ts` | +`morticus.importTranscript` command wiring |
| `package.json` | +command declaration |
| `test/unit/domain/import.test.ts` | NEW: 3 tests |
| `test/unit/runtime/transcript-parser.test.ts` | NEW: 55 tests |
| `test/unit/runtime/import-extractor.test.ts` | NEW: 13 tests |
| `test/unit/runtime/import-conflict-detector.test.ts` | NEW: 13 tests |
| `test/unit/storage/migrator.test.ts` | +3 tests (v2→v3 migration) |

### Metrics

- Tests: 449 (was 362, +87)
- Bundle: 289KB
- Lint: clean
