# TODO

## Phase 1 — Done
- [x] Project scaffold (package.json, tsconfig, esbuild, vitest)
- [x] Domain types (all core interfaces + pure functions)
- [x] Storage layer (JSON persistence in .morticus/)
- [x] Compiler layer (policy, spec-resolver, context-pack)
- [x] Review layer (validator, delta-builder, delta-applier)
- [x] Extension UI (tree views, webview panels, commands, status bar)
- [x] Integration test (full vertical slice)

## Phase 2 — Done
- [x] Claude CLI adapter (`src/runtime/claude-adapter.ts`) — spawn `claude --print`, capture output
- [x] Run controller (`src/runtime/run-controller.ts`) — orchestrate run lifecycle with fresh-run-from-snapshot
- [x] Git worktree manager (`src/runtime/worktree-manager.ts`) — create/cleanup worktrees
- [x] Artifact collector (`src/runtime/artifact-collector.ts`) — capture git diff, changed files
- [x] Output normalizer — parse structured output between markers
- [x] Prompt builder — render ContextPack into prompt with output contract
- [x] Runtime integration test (mocked Claude, real pipeline)
- [x] Unit tests for prompt-builder, output-normalizer, claude-adapter

## Phase 3 — Done
- [x] Extended MemoryEntry with provenance (origin, sourceTaskId, sourceRunId, sourceDeltaId, reviewed, normalizedValue)
- [x] ContextMetrics on TaskRun (snapshot at run creation for historical accuracy)
- [x] MemoryStore CRUD (addEntry, updateEntry, removeEntry, getEntry)
- [x] RunStore list/getRawOutput/getNormalizedOutput
- [x] StateStore listVersions with VersionSummary
- [x] Context metrics snapshot in RunController
- [x] createRetryTask pure function
- [x] State diff (diffStates, isDiffEmpty)
- [x] Knowledge extractor (decisions only, active:false, dedup on normalizedValue)
- [x] Memory tree provider (sidebar, grouped by category)
- [x] Run tree provider (sidebar, sorted by date)
- [x] Memory panel (CRUD webview, active toggle disabled until reviewed)
- [x] Run detail panel (read-only, uses contextMetrics snapshot)
- [x] History panel (command-driven, version timeline with diffs)
- [x] Commands wired (openMemoryPanel, addMemoryEntry, openHistoryPanel, openRunDetail, archiveTask, retryTask, editTask)
- [x] Review panel accept hook: extractKnowledge + deduplicateEntries on delta accept
- [x] package.json updated (commands, views, menus)

## Phase 4A — Done
- [x] ChatMessage, ChatSession, ChatTurnResult types (`src/domain/chat.ts`)
- [x] ChatSessionId, ChatMessageId branded types (`src/domain/ids.ts`)
- [x] Add phaseGoal, phaseExitCriteria to CanonicalProjectState
- [x] Add set_phase_goal, add/remove_phase_exit_criterion DeltaOperations
- [x] Update applyDeltaOperations, createInitialState, state-diff.ts
- [x] `sendChatTurn` + system prompts + structured output contract + result parsing
- [x] ChatStore with main session persistence
- [x] Chat panel webview (kickoff mode: draft state + accept, steering mode: draft task cards)
- [x] morticus.openChat command, extension registration, auto-open on init
- [x] State panel: phaseGoal field, state tree: phaseGoal display, context-pack: phaseGoal
- [x] Unit tests: chat domain types, chat adapter parsing, phase delta operations (171 tests total)

## Phase 4A.5 — Done: Conversational UX Consolidation
See `docs/phase4a5-plan.md` for full plan.

- [x] WS1: Welcome messages, draft state diff indicators, accept confirmation, post-accept guidance, missing-goal hint
- [x] WS2: Inline task card editing (replace modal input boxes with editable card fields)
- [x] WS3: Enriched steering context (TaskContext type, buildTaskContextSection, chat-adapter integration)
- [x] WS4: Kickoff suggested tasks with merge semantics (draftTasks on ChatTurnResult, mergeDraftTasks, post-accept cards with Create/Edit/Dismiss — NOT auto-created)
- [x] WS5: Toast actions, non-optimistic task cards, task ID in chat
- [x] WS6: Tests (mergeDraftTasks: 8, draftTasks parsing: 5, buildStateSummary: 6, buildTaskContextSection: 5 — 195 tests total)

## Phase 4A.6 — Done: Chat Centrality and Continuity
See `docs/phase4a6-plan.md` for full plan.

- [x] Auto-open chat on activation for existing initialized projects (once per activation, no-op if panel exists)
- [x] `pendingSuggestedTasks: DraftTask[]` on ChatSession with `suggestionId` for stable lifecycle
- [x] Re-render pending suggested task cards on chat reopen
- [x] Drain pendingSuggestedTasks by suggestionId on create/dismiss
- [x] Comment/doc cleanup (draftTasks/pendingSuggestedTasks comments, createChatSession init, backward compat)
- [x] Tests (11 new — pendingSuggestedTasks lifecycle, suggestionId uniqueness/serialization — 206 total)

## Phase 4B.1 — Done: "What should we do next?"

- [x] `phaseExitCriteria` added to `buildStateSummary` (strategic reasoning needs exit criteria visibility)
- [x] `goal` added to `TaskContext.recentlyCompleted` (Claude needs completed task goals to reason about progress)
- [x] `draftTasks` (plural) added to steering output contract (multi-task strategic suggestions)
- [x] Strategic reasoning guidelines in steering system prompt (7-point grounded reasoning protocol)
- [x] `draftTasks` on `ChatMessage` + webview rendering of multi-task cards in steering mode
- [x] Tests (5 new — phaseExitCriteria, recently completed goals, steering draftTasks parsing — 211 total)

## Phase 4B.2 — Done: Chat-Driven State Updates

- [x] `StateDelta.taskId` nullable (`TaskId | null`) for chat-originated deltas
- [x] `validateDelta` spec parameter optional (chat deltas skip scope checks)
- [x] ReviewPanel + knowledge-extractor handle null taskId (fallback to "Chat proposal")
- [x] `draftDelta?: DeltaOperation[]` on `ChatTurnResult` and `ChatMessage`
- [x] Steering output contract + prompt: `draftDelta` field with 14 valid operation types
- [x] `sanitizeDeltaOperation` parser with type validation and value/path field handling
- [x] Delta preview cards in chat webview (color-coded add/remove/set, "Send to Review" button)
- [x] `handleReviewDelta` → creates StateDelta, validates, saves, opens ReviewPanel
- [x] Commands.ts wiring: `onDeltaProposed` callback connects chat panel to review panel
- [x] Tests (12 new — sanitizer: 6, draftDelta parsing: 4, validator no-spec: 2 — 223 total)

## Phase 5A — Done: Schema Migration + Context Slicing

### Slice 1: Schema Migration
- [x] `CURRENT_SCHEMA_VERSION` constant and `MigrationStep` interface (`src/storage/migrator.ts`)
- [x] `runMigrations` — forward-only migration runner with crash-safe step-by-step execution
- [x] `runMigrationsWithSteps` — lower-level runner exported for testability
- [x] `getMigrationSteps` — step filtering and ordering
- [x] `SCHEMA_VERSION_TOO_NEW` and `MIGRATION_ERROR` error codes
- [x] `ProjectStore.ensureMigrated()` — idempotent migration gate (runs once per session)
- [x] `extension.ts` calls `ensureMigrated()` at activation before any store reads
- [x] Tests (9 new — no-op, single step, multi-step, version too new, sub-store migration, idempotency — 248 total)

### Slice 2: Context Slicing
- [x] Fixed memory duplication: entries now in `stablePrefix` only, `relevantMemoryEntries` always `[]`
- [x] `includeCategories` / `excludeCategories` on `ContextPackOptions` (category-based memory filtering)
- [x] `maxTokens` on `ContextPackOptions` (token budget with priority-based trimming)
- [x] `trimToBudget` — deterministic 4-step priority trimming (knownFiles → risks → decisions → stablePrefix)
- [x] Discovery tasks default to `excludeCategories: ['test_convention']`
- [x] Validation tasks default to `excludeCategories: ['domain_glossary']`
- [x] Tests (14 new context-pack, 2 spec-resolver category tests, prompt-builder updates — 248 total)

## Phase 6 — Done: Chat as Coherent Home Surface

- [x] WS1: `ProjectSnapshot` interface in `src/domain/chat.ts`
- [x] WS1: Snapshot UI in chat panel — compact grid below mode bar, `buildProjectSnapshot()`, `refreshSnapshot()`, included in init for steering mode
- [x] WS4: Kickoff completeness cues — `renderCompleteness()` with warn/hint/note levels, dynamic accept button text with summary
- [x] WS2: Dual task card buttons — "Create Draft" + "Create & Run" (blue) with progress indicators
- [x] WS2: `handleConfirmAndRunTask()` — one-click create → compile spec → run → open review
- [x] WS2: `onRunComplete` callback on ChatPanel constructor, wired in commands.ts
- [x] WS3: `onReviewComplete` callback on ReviewPanel — fires on accept/reject with outcome details
- [x] WS3: `postSystemMessage()` and `refreshSnapshot()` public methods on ChatPanel
- [x] WS3: `createReviewPanel` helper in commands.ts — routes review outcomes back to chat as system messages + snapshot refresh

## Phase 4B.3 — Done: Chat-Driven Phase Transitions

- [x] `clear_phase_exit_criteria` delta operation (type, state application, sanitizer, output contract)
- [x] Steering prompt: dedicated phase transition guidance (compose complete transition, suggest when criteria met)
- [x] Delta card rendering: handle valueless operations (chat-panel.ts + review-panel.ts)
- [x] Tests (6 new — clear operation: 3, full transition composition: 1, sanitizer valueless: 2, draftDelta parsing: 1 — 254 total)

## Phase 4B — Done: Strategic Trunk
- [x] "What should we do next?" — grounded strategic suggestion from state + task status (4B.1)
- [x] State update proposals from chat → draft delta → review (4B.2)
- [x] Phase transitions from chat → draft delta → review (4B.3)
- [x] Memory update proposals from chat → draft memory entry (4B.4)
- [x] Deterministic intent pre-classification (fast path before Claude) (4B.5)
- [x] Chat transcript compaction / token-budget sliding window (4B.6)

## Phase 4C — Done: Task Workspace Strengthening

- [x] `listByTask(taskId)` on RunStore (filter runs by task)
- [x] Task Detail Panel webview (`src/ui/webviews/task-detail-panel.ts`)
  - Task metadata, goal, status badge (color-coded)
  - Compiled spec summary (tools, write permissions, est. tokens)
  - Run history with duration and status
  - Candidate delta display with operations
  - Contextual action buttons (Compile / Run / Review / Archive / Retry)
- [x] `morticus.openTaskDetail` command in commands.ts + package.json
- [x] Task tree click → opens Task Detail Panel (tree item command)
- [x] Tests (31 new — memory sanitizer: 4, draftMemory parsing: 4, intent classifier: 19, transcript compaction: 4 — 285 total)

## Phase 5 — Done: Checkpoint + Resume from State

What this IS: checkpoint (named bookmarks) + resume (repoint current state to any historical version).
What this is NOT: git-style branching with named branches, merge operations, or divergent branch UI.
The version history forms a DAG via `parentVersion`, but there is no tree visualization yet (that's Phase 12).

- [x] `parentVersion: StateVersion | null` on `CanonicalProjectState` (tracks derivation lineage, not chronological order)
- [x] `Checkpoint` interface + `CheckpointId` branded type (`src/domain/checkpoint.ts`, `src/domain/ids.ts`)
- [x] `getNextVersion()` on StateStore (scans version files, returns max+1 — prevents collision after resume)
- [x] `setCurrentVersion()` on StateStore (repoints current.json without creating version file)
- [x] `parentVersion` on `VersionSummary` for history UI
- [x] `CheckpointStore` (`src/storage/checkpoint-store.ts`) — JSON persistence at `.morticus/checkpoints.json`
- [x] Schema migration v1→v2 — backfills `parentVersion` on existing state snapshots
- [x] `resumeFromVersion()` orchestrator (`src/review/resume-orchestrator.ts`) — repoints state, archives active tasks
- [x] Version collision fix in `delta-applier.ts` — uses `getNextVersion()` instead of `current.version + 1`
- [x] Version collision fix in `state-panel.ts` — same fix for direct state edits
- [x] History panel: Resume + Checkpoint buttons, current badge, lineage-aware diffs and labels
- [x] `morticus.resumeFromVersion` command (preview of affected tasks, confirmation, chat system message, snapshot refresh)
- [x] `morticus.createCheckpoint` command (label prompt, persists to CheckpointStore)
- [x] Tests (resume→delta→version semantics, multi-resume, checkpoint persistence, parentVersion lineage)

## Later
- [ ] Claim graph (typed claims with evidence, supersession)
- [ ] Hashed claim deduplication
- [ ] Semantic search over project state
- [ ] Multiple provider adapters (Codex)
- [ ] Background periodic reconciliation checks
- [ ] Salience-guided chat parsing
- [ ] Per-task/per-run cost estimation surfaced in UI
- [ ] ContextPackOptions exposed to users via task creation UI
- [x] Stable prefix caching strategy (dedup done in 5A)
- [ ] Multi-session support (branching strategic conversations)
- [x] Schema migration logic (done in 5A)
