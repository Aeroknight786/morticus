# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Morticus is a VS Code extension and local orchestration layer for long-running AI-assisted software work. It maintains canonical project state separate from task chats, compiles deterministic task specs, and gates state mutation behind reviewed deltas. See `project_state_control_plane_prd.md` for full product design and `AGENTS.md` for project principles.

## Commands

```bash
npm run build          # Bundle extension with esbuild (~24ms)
npm test               # Run all tests with vitest
npm run test:watch     # Watch mode
npm run lint           # TypeScript type checking (tsc --noEmit)
```

Press F5 in VS Code to launch the Extension Development Host.

## Architecture

Six layers with strict dependency direction: `UI → Domain/Compiler/Runtime/Review/Storage`, `Domain → (nothing)`.

- **`src/domain/`** — Pure TypeScript types and functions. Zero dependencies on VS Code or Node APIs. All lifecycle transition rules (`TASK_TRANSITIONS`, `canTransition`, `transitionTask`) and state mutation (`applyDeltaOperations`) are pure functions here. Chat types (`ChatMessage`, `ChatSession`, `ChatTurnResult`) live here too.
- **`src/storage/`** — Local JSON persistence in `.morticus/` directory using atomic temp-file-rename writes. `ProjectStore` is the facade; sub-stores handle state versions, tasks, deltas, specs, runs, memory, and chat sessions.
- **`src/compiler/`** — Deterministic task spec compilation. `spec-resolver.ts` maps TaskNode + CanonicalState + Memory → TaskSpec. `policy.ts` maps task type → permissions. `context-pack.ts` builds the provider prompt payload with intentional minimality and token estimation. No LLM calls.
- **`src/review/`** — `delta-builder.ts` converts ProposedDelta → typed StateDelta. `validator.ts` runs deterministic checks (staleness, scope). `delta-applier.ts` applies accepted deltas to state. `knowledge-extractor.ts` extracts decisions into review-gated memory entries.
- **`src/runtime/`** — Provider adapters and run orchestration. Claude CLI adapter (single-shot `--print`), chat adapter (per-turn single-shot for conversational onboarding and task drafting), worktree manager, artifact collector.
- **`src/ui/`** — VS Code extension layer. Tree views, webview panels (including chat panel), commands, status bar.

### Interaction Model

The product is **chat-first at the point of interaction, state-first underneath**.

- **Kickoff chat**: New projects start with a conversation. The user describes what they want to build, the system drafts canonical state, the user reviews and accepts.
- **Task drafting**: After canonical state exists, the user can draft tasks conversationally. The chat produces a `ChatTurnResult` with an optional `draftTask`; the user confirms before creation.
- **Work-spawning rule**: If a chat request requires substantial exploration or implementation, the system proposes a task rather than doing work inline. The strategic trunk stays clean.
- **Task execution**: Tasks are scoped work units that run in isolation. They inherit context from canonical state + memory via compiled context packs, not from chat transcript.
- **Review boundary**: Nothing becomes canonical without review. Task-produced deltas go through the ReviewPanel. The kickoff chat's "Accept Draft State" creates the first version directly (nothing to diff against).

### Deterministic vs LLM-assisted

| Deterministic | LLM-assisted |
|---|---|
| Task spec resolver, policy engine, delta applier, validator, reconciler, knowledge extractor | Chat adapter (kickoff drafting, task drafting), output normalizer |

### Key Types

Core product object: `CanonicalProjectState` (version, goal, phase, phaseGoal, phaseExitCriteria, constraints, decisions, risks, knownFiles, nextStep).
Unit of work: `TaskNode` with status lifecycle: draft → ready → running → awaiting_completion → normalizing_output → awaiting_review → merged/rejected/archived.
State mutation: `DeltaOperation` typed union (add/remove/set variants for each state field, including phase goal and exit criteria).
Task contract: `TaskSpec` with scope, permissions, tools, context pack.
Context pack: `ContextPack` splits into `stablePrefix` (durable memory, rarely changes) and run-variable content (compiled from current state snapshot). Includes `estimatedTokens` for sizing awareness. Controlled by `ContextPackOptions`.
Chat types: `ChatMessage`, `ChatSession` (with mode: kickoff | steering), `ChatTurnResult` (one structured result per Claude call: response + optional draftState + optional draftTask).

### Context and cost efficiency

Each task run is compiled from a minimal, intentional context pack — not replayed conversation history. This is a first-class architectural concern, not a side benefit.

- `stablePrefix` isolates durable memory and project rules so they are structurally separate from per-run state content
- Discovery tasks default to omitting decisions and risks (smaller prompt, less noise for exploration tasks)
- `estimatedTokens` (chars/4) is tracked per context pack for future cost visibility
- Fresh-run-from-snapshot is the core execution pattern: new runs pull from a chosen canonical state version, not accumulated transcript
- Raw chat and log volume is ephemeral; only distilled outputs survive into canonical state via the delta review path
- Chat context is compiled fresh each turn from current state + active memory + recent messages (sliding window), not replayed from full transcript

**Caution**: do not truncate what is needed for reliable task execution. Bad truncation causes retries and rework, which increases total cost. Optimize for the smallest context that is still sufficient.

### Storage Layout (per-workspace)

`.morticus/` contains `project.json`, `state/versions/vNNN.json`, `state/deltas/`, `tasks/`, `specs/`, `runs/`, `memory/entries.json`, `chat/main.json`.

## Conventions

- Domain types must stay pure (no VS Code or Node imports)
- State snapshots are full JSON (not diff chains)
- All file I/O goes through `src/storage/json-backend.ts`
- Tests go in `test/unit/<layer>/` or `test/integration/`
- Context packs must include `estimatedTokens` and `stablePrefix` — never construct them without these fields
- Chat turns that propose mutations must produce typed fields in `ChatTurnResult` (draftState or draftTask), not free-form prose
- If a chat request requires substantial work, propose a task rather than doing work inline
- Auto-extracted memory entries default to `active: false`, `reviewed: false` — unreviewed auto-memory must NOT influence future runs
- Phase transitions are explicit reviewable deltas, not silent state changes
