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

## Phase 4A — Next: Conversational Onboarding + Task Drafting
See `docs/phase4-plan.md` for full plan.

### WS1: Domain types
- [ ] ChatMessage, ChatSession, ChatTurnResult types (`src/domain/chat.ts`)
- [ ] ChatSessionId, ChatMessageId branded types (`src/domain/ids.ts`)
- [ ] Add phaseGoal, phaseExitCriteria to CanonicalProjectState
- [ ] Add set_phase_goal, add/remove_phase_exit_criterion DeltaOperations
- [ ] Update applyDeltaOperations, createInitialState
- [ ] Update state-diff.ts for new phase fields

### WS2: Chat adapter
- [ ] `sendChatTurn` function (`src/runtime/chat-adapter.ts`)
- [ ] System prompts for kickoff and steering modes
- [ ] Structured output contract with markers
- [ ] Result parsing with graceful fallback

### WS3: Chat storage
- [ ] ChatStore with main session persistence (`src/storage/chat-store.ts`)
- [ ] Add chat store to ProjectStore facade

### WS4: Chat UI
- [ ] Chat panel webview (`src/ui/webviews/chat-panel.ts`)
- [ ] Kickoff mode: draft state preview, accept button
- [ ] Steering mode: draft task cards (confirm/edit/cancel)

### WS5: Wiring
- [ ] morticus.openChat command
- [ ] Extension registration, auto-open chat on init
- [ ] package.json updates
- [ ] State panel: show phaseGoal field

### WS6: Tests
- [ ] Unit tests for chat domain types
- [ ] Unit tests for chat adapter (prompt assembly + result parsing)
- [ ] Unit tests for phase delta operations
- [ ] Integration test: kickoff flow
- [ ] Integration test: task drafting flow

## Phase 4B — Later: Strategic Trunk
- [ ] Phase transitions from chat → draft delta → review
- [ ] State update proposals from chat → draft delta → review
- [ ] Memory update proposals from chat → draft memory entry
- [ ] Richer strategic question answering
- [ ] Deterministic intent pre-classification (fast path before Claude)
- [ ] Chat transcript compaction / summarization

## Phase 5+ — Later
- [ ] Claim graph (typed claims with evidence, supersession)
- [ ] Hashed claim deduplication
- [ ] Semantic search over project state
- [ ] Multiple provider adapters (Codex)
- [ ] Background periodic reconciliation checks
- [ ] Salience-guided chat parsing
- [ ] Per-task/per-run cost estimation surfaced in UI
- [ ] ContextPackOptions exposed to users via task creation UI
- [ ] Stable prefix caching strategy
- [ ] Multi-session support (branching strategic conversations)
- [ ] Draft-state task spawning (tasks before canonical state acceptance)
- [ ] Schema migration logic
