# Project: Project-State Control Plane

## Mission
Build a VS Code extension and local orchestration layer for long-running AI-assisted software work.

## Core product thesis
The product is not a generic AI IDE. It is a control plane for project truth — and a cost governance layer for agentic development.

The system must:
- maintain canonical project state separate from task-local chats
- compile deterministic task specs from user intent + repo facts + policy
- compile intentionally minimal context packs per run, avoiding transcript replay
- support provider-backed task execution (initially Claude-first, later Codex too)
- normalize task outputs into typed state deltas
- run deterministic review/reconciliation before canonical state updates
- preserve evidence/provenance for accepted claims

Context governance is not just about reliability. Without it, long-running AI workflows repeatedly pay for stale transcript history, dead-end explorations, repeated setup explanations, and oversized prompts across retries and branches. Each task run should be compiled from the smallest context that is still sufficient and reliable — not the longest available history.

## Interaction model

The product is:
- **chat-first** at the point of interaction
- **state-first** underneath
- **task-first** for execution
- **review-first** for canonical mutation

**Task chats do the work.** The main chat steers the project. Canonical state stores what the project currently believes. Phases describe what kind of work should happen next.

The chat panel has two modes. **Kickoff mode** (no canonical state yet): user describes the project conversationally, system drafts canonical state, user accepts. **Steering mode** (canonical state exists): user drafts tasks conversationally, system produces `ChatTurnResult` with optional `draftTask`, user confirms.

**Work-spawning rule:** If a chat request requires substantial exploration or implementation, the system should propose a task rather than doing the work inline. The strategic trunk stays clean.

## Architectural priorities
1. Canonical project state is the main product object
2. Task chats are workspaces, not truth
3. No task output mutates canonical state directly
4. Deterministic review gates canonical mutation
5. Use LLMs for intent extraction, summarization, drafting, and explanation
6. Use deterministic code for policies, task contracts, state application, and checks
7. Keep the first version local-first and single-user
8. Do not overbuild autonomy, swarms, or cloud infra
9. Each task run is compiled from a minimal, intentional context pack — not replayed history
10. Fresh-run-from-snapshot is a core execution pattern: new runs start from chosen state versions, not accumulated transcript
11. Chat turns produce one structured ChatTurnResult — not free-form prose
12. If a chat request needs substantial work, propose a task rather than doing work inline

## MVP boundary
The first useful version should include:
- canonical state model
- task model
- task spec compiler
- intentionally minimal context pack compilation with token estimation
- local storage
- one provider adapter
- merge review
- state delta application
- basic repo reconciliation
- conversational project kickoff (chat → draft state → review → accept)
- conversational task spawning (chat → draft task → review → create)

## Product constraints
- prefer clarity over cleverness
- prefer typed schemas over prose blobs
- prefer small vertical slices over broad scaffolding
- avoid building a full editor fork
- avoid hidden magic when a deterministic step is possible
- context packs should be minimal but sufficient — do not truncate what is needed for reliable task execution
- raw chat/log volume is ephemeral; only distilled outputs survive into project state
- every chat turn that proposes mutation must produce typed fields in ChatTurnResult (draftState or draftTask), not free-form prose
- if a chat request requires substantial work, propose a task rather than doing it inline

## Implementation preferences
- TypeScript
- VS Code extension
- local JSON or SQLite for early persistence
- git worktrees where useful
- strong typing and schema validation
- code should be modular and production-minded

## Working style
When planning:
- decompose into phases
- identify assumptions and open questions
- flag what is speculative versus solid

When implementing:
- start with the smallest end-to-end slice
- write files in a clean structure
- explain key design choices briefly
- avoid premature abstraction

When uncertain:
- inspect the repo and propose options
- do not invent existing code or files
