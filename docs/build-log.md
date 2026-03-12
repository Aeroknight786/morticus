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

## Phase 4 Direction: Conversational Steering

See `docs/phase4-plan.md` for the full plan.

Split into two sub-phases:

**Phase 4A** (next): Conversational onboarding + task drafting.
- Kickoff chat: user describes project → system drafts canonical state → user accepts → v1
- Conversational task drafting: "create a task to..." → draft card → confirm → task created
- One chat panel with mode switching (kickoff → steering)
- Simplified architecture: one `ChatTurnResult` per Claude call, no separate classifier/drafter layers
- phaseGoal added to CanonicalProjectState (lightweight)
- Work-spawning rule: substantial requests → propose a task, don't do work inline

**Phase 4B** (later): Strategic trunk behavior.
- Phase transitions from chat
- State update proposals from chat
- Memory update proposals
- Richer strategic questioning
- Deterministic intent pre-classification
- Chat transcript compaction
