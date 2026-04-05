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

## Phase 4A — Done: Chat Foundation
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

## Phase 4B — Done: Strategic Trunk

### 4B.1 — "What should we do next?"
- [x] `phaseExitCriteria` added to `buildStateSummary` (strategic reasoning needs exit criteria visibility)
- [x] `goal` added to `TaskContext.recentlyCompleted` (Claude needs completed task goals to reason about progress)
- [x] `draftTasks` (plural) added to steering output contract (multi-task strategic suggestions)
- [x] Strategic reasoning guidelines in steering system prompt (7-point grounded reasoning protocol)
- [x] `draftTasks` on `ChatMessage` + webview rendering of multi-task cards in steering mode
- [x] Tests (5 new — phaseExitCriteria, recently completed goals, steering draftTasks parsing — 211 total)

### 4B.2 — Chat-Driven State Updates
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

### 4B.3 — Chat-Driven Phase Transitions
- [x] `clear_phase_exit_criteria` delta operation (type, state application, sanitizer, output contract)
- [x] Steering prompt: dedicated phase transition guidance (compose complete transition, suggest when criteria met)
- [x] Delta card rendering: handle valueless operations (chat-panel.ts + review-panel.ts)
- [x] Tests (6 new — clear operation: 3, full transition composition: 1, sanitizer valueless: 2, draftDelta parsing: 1 — 254 total)

### 4B.4 — Chat-Driven Memory Proposals
- [x] `DraftMemoryEntry` type on `ChatTurnResult` and `ChatMessage`
- [x] Memory cards in chat with confirm/dismiss
- [x] `sanitizeDraftMemoryEntry` parser in chat-adapter
- [x] Tests (memory sanitizer: 4, draftMemory parsing: 4)

### 4B.5 — Intent Pre-Classification
- [x] `classifyIntent` deterministic classifier (state_query, task_query, greeting, delegate)
- [x] `generateLocalResponse` for fast-path responses without Claude
- [x] Tests (intent classifier: 19)

### 4B.6 — Transcript Compaction
- [x] Token-budget sliding window in `formatMessages`
- [x] Tests (transcript compaction: 4)

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

## Chat as Coherent Home Surface — Done (tightened)

- [x] `ProjectSnapshot` view model (moved from domain layer to `chat-panel.ts` — it's a display type, not domain)
- [x] Snapshot UI in chat panel — compact grid below mode bar, `buildProjectSnapshot()`, `refreshSnapshot()`
- [x] Kickoff completeness cues — `renderCompleteness()` with warn/hint/note levels, dynamic accept button text
- [x] Dual task card buttons — "Create Draft" + "Create & Run" (blue) with progress indicators
- [x] `handleConfirmAndRunTask()` — one-click create → compile spec → run → open review
- [x] `createTaskFromDraft()` shared helper (eliminates duplication between Create Draft and Create & Run)
- [x] `onRunComplete` callback on ChatPanel constructor, wired in commands.ts
- [x] `onReviewComplete` callback on ReviewPanel — fires on accept/reject with outcome details
- [x] ReviewPanel transitions task to `merged`/`rejected` on accept/reject (was stuck at `awaiting_review`)
- [x] `postSystemMessage()` and `refreshSnapshot()` public methods on ChatPanel
- [x] `createReviewPanel` helper in commands.ts — routes review outcomes back to chat
- [x] Snapshot refreshes on both accept AND reject (reject was missing)

## Phase 6 — Done: Scratchpad Mode v1

Temporary exploratory side-workspace for brainstorming and research, separate from the strategic trunk.

- [x] `ScratchpadId` branded type and `generateScratchpadId()` (`src/domain/ids.ts`)
- [x] `ScratchpadSession`, `ScratchpadHandoff`, `ScratchpadOrigin`, `ScratchpadStatus` domain types (`src/domain/scratchpad.ts`)
- [x] `createScratchpadSession()` pure constructor
- [x] `parseScratchpadHandoff()` defensive parser for Claude's structured output (no candidateMemory in v1)
- [x] `ScratchpadStore` — one file per session at `.morticus/scratchpad/<id>.json`, `getActive()` for v1 single-session constraint
- [x] `ProjectStore.scratchpad` sub-store wiring
- [x] `sendScratchpadTurn()` — response only, no mutation parsing (structurally prevents mutation leakage)
- [x] `requestScratchpadHandoff()` — requests and parses structured handoff with separate markers
- [x] `parseScratchpadHandoffResponse()` — extracts handoff JSON between `---MORTICUS-SCRATCHPAD-HANDOFF-START/END---` markers
- [x] `buildParentContextSummary()` — frozen parent context built at spawn time (goal/phase/memory/recent messages)
- [x] `ScratchpadPanel` webview with amber/orange visual theme, origin chip, auto-archive on close-without-handoff
- [x] Handoff card with action buttons: Create Task, Send to Review, Archive, Discard, Continue Exploring
- [x] `ScratchpadHandoffAction` discriminated union type for dispatching handoff actions
- [x] `ChatPanel.injectDraftTask()` — injects candidate task card into main chat from external source
- [x] `ChatPanel.routeDeltaToReview()` — routes candidate delta to ReviewPanel (does not display in chat)
- [x] "Scratchpad" button in chat input area (steering mode only)
- [x] `morticus.openScratchpad` command — creates session with frozen context, handles all handoff action routing
- [x] Tests (8 domain scratchpad, 6 adapter handoff parsing, 6 buildParentContextSummary — 326 total)

## Phase 9 — Done: Context Slicing and Cost Governance

- [x] `ContextSurface`, `StateSlicePolicy`, `MemorySlicePolicy`, `TokenBudget`, `ContextProfile` domain types (`src/domain/context-policy.ts`)
- [x] `ContextManifest`, `TrimmedField` diagnostic types for what was included/excluded and why
- [x] Pure scoring functions: `tokenize`, `scoreKeywordRelevance`, `filterByScope`, `filterByScopeKeywords`, `extractRelevanceKeywords`
- [x] `resolveContextProfile(surface, taskType?, scopePaths?)` — per-surface context policies (task_run, chat_steering, chat_kickoff, scratchpad)
- [x] `buildContextDiagnostics(manifest)` — human-readable diagnostics string
- [x] `ContextPackOptions` extended: `includePhaseExitCriteria`, `memoryRelevanceThreshold`, `relevanceKeywords`, `scopeFilterKnownFiles`, `scopePaths`, `scopeFilterDecisions`, `scopeFilterRisks`
- [x] `ContextPack.contextManifest` — populated by context compiler with inclusion/exclusion details
- [x] `ContextMetrics` extended: `memoryIncluded`, `memoryExcluded`, `contextDiagnostics`
- [x] `ChatTurnResult.contextTokenEstimate` — token estimate for chat turns
- [x] `context-pack.ts`: scope filtering (knownFiles path prefix, decisions/risks keyword overlap), relevance scoring pipeline, manifest generation, phaseExitCriteria support
- [x] `spec-resolver.ts`: uses `resolveContextProfile` instead of hardcoded task-type defaults
- [x] `chat-adapter.ts`: profile-driven memory limiting, conversation token budget, context token estimate
- [x] `scratchpad-adapter.ts`: profile-driven memory limiting
- [x] `run-controller.ts`: persists manifest/diagnostics into `ContextMetrics`
- [x] `run-detail-panel.ts`: displays memory included/excluded, context diagnostics (expandable)
- [x] Tests (23 context-policy, 11 context-pack scope/relevance/manifest/phaseExitCriteria — 362 total)

## Phase 8A — Done: Transcript Import / Migration with Minimal Archive Foundation

- [x] `import.ts` domain types: `ImportSourceType`, `ImportSourceMeta`, `TranscriptChunk`, `DocSection`, `ImportChunk`, `ImportExtractionResult`, `ImportConflict`, `ArchiveRecord`, `AcceptedItemRef`, `createArchiveRecord()`
- [x] `ArchiveId` branded type + `generateArchiveId()` in `ids.ts`
- [x] `MemoryOrigin` extended with `'imported'`, `sourceArchiveId: ArchiveId | null` on `MemoryEntry`
- [x] `IMPORT_PARSE_ERROR`, `IMPORT_EXTRACTION_ERROR` error codes
- [x] `transcript-parser.ts`: `detectImportFormat`, `parseMarkdownTranscript`, `parseTextChatDump`, `parsePlanningDoc`, `parseImportSource` — deterministic, no LLM
- [x] `import-extractor.ts`: extraction prompt + response parsing with reused sanitizers, bookend strategy for large transcripts
- [x] `import-conflict-detector.ts`: pure conflict detection with word-overlap severity scoring
- [x] Exported `sanitizeDraftState`, `sanitizeDraftTask` from `chat-adapter.ts`
- [x] `archive-store.ts`: `ArchiveStore` (save, get, list, saveRawContent, getRawContent) + wired into `ProjectStore`
- [x] Schema migration v2→v3: `sourceArchiveId: null` backfill on existing memory entries
- [x] `import-panel.ts`: multi-step import wizard webview (parse → extract → review → apply)
- [x] `morticus.importTranscript` command in `commands.ts` + `package.json`
- [x] Tests (55 parser, 13 extractor, 13 conflict detector, 3 domain, 3 migrator — 449 total)

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
