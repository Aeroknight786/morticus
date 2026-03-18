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
