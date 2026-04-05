# Morticus Roadmap

## Status
This roadmap reflects the current state of Morticus after:
- canonical state + durable memory + task model foundation
- real Claude-backed task execution
- review/merge flow
- run history / state history / memory provenance
- chat-first kickoff and conversational task drafting
- 4A.5 UX consolidation
- 4A.6 planning direction (chat centrality + continuity)

This document is intentionally execution-oriented. It is meant to guide phased implementation, not just describe aspirations.

---

# Product Thesis

Morticus is not a generic AI IDE and not just another chat wrapper.

It is a control plane for long-running AI-assisted software work.

Core principles:
- chat-first at the point of interaction
- state-first underneath
- task-first for execution
- review-first for canonical mutation

The system should let a builder:
- start naturally from conversation
- convert conversation into typed project state and typed tasks
- execute bounded work in separate task contexts
- review what survives
- archive or discard what does not
- return later without losing the plot

---

# Current State of the Product

## Working now
- Canonical project state
- Durable memory with provenance
- Task lifecycle and task spec compilation
- Claude-backed task execution
- Review/merge pipeline
- State history and run history
- Conversational kickoff drafting of initial state
- Conversational task drafting
- Inline task card editing
- Better kickoff acceptance flow
- Suggested kickoff tasks as post-accept suggestions (persistent across reopen)
- Enriched steering context with task activity
- "What should we do next?" — grounded strategic suggestions from state + task status
- Chat-driven state updates (draft delta → review panel)
- Chat-driven phase transitions (compose complete transition deltas)
- Chat-driven memory proposals (draft memory → review)
- Intent pre-classification (deterministic fast path before Claude)
- Transcript compaction / token-budget sliding window
- Task Detail Panel (metadata, spec summary, run history, candidate delta, action buttons)
- Checkpoint + resume from state (named bookmarks, repoint current, archive active tasks)
- Schema migration (forward-only, v1→v2 parentVersion backfill)
- Context slicing (category filters, token budgets, priority trimming)
- Chat as home surface (project snapshot, create & run, review outcomes routed to chat, kickoff completeness cues)

## Current gaps
- Memory is flat (single-type entries) — needs multi-type structured memory (EverMemOS-inspired MemCell model)
- Archive / retrieval / scratchpad are not yet built
- Context slicing can be deeper (per-subsystem, per-risk relevance)
- Reconciliation against repo reality is still minimal
- No shadow analysis runs
- No transcript import / migration (8A in progress — Claude CLI JSONL primary)
- No generation tree navigation UI

---

# Guiding Product Model

## Main Chat
Strategic trunk of the project.
Used for:
- steering
- asking what to do next
- spawning tasks
- phase movement
- high-level state shaping

Should remain relatively clean.

## Task Workspace
Bounded work surface.
Used for:
- exploration
- implementation
- validation
- agent execution
- local task history

Should not directly become project truth without review.

## Scratchpad
Temporary exploratory side-space.
Used for:
- messy thought
- side analysis
- vague planning
- rough comparison

Should produce structured handoff on exit:
- draft task
- draft canonical update
- memory candidate
- archive only
- discard

## Canonical State
What the project currently believes.

## Durable Memory (EverMemOS-Inspired)
Multi-type structured memory with boundary-aware extraction:
- **Episodic**: what happened — compact narrative summaries of sessions, task runs, reviews
- **Event**: atomic facts — individual decisions, constraints, conventions (current `MemoryEntry`)

Memory is extracted from MemCells (boundary-detected interaction chunks), not from flat entries. One LLM call per MemCell produces both types. Foresight and profile extraction (from EverMemOS) are not ported — canonical state `risks`/`nextStep` and `CanonicalProjectState` already serve those roles with review-gating.

## Archive
Transcript and run history outside hot context, retrievable when relevant. MemCells serve as the archive unit.

---

# Phase Plan

---

## Phase 4A.6 — Chat Centrality and Continuity

### Goal
Make chat feel like the central surface of Morticus, not an attached webview, and preserve continuity of kickoff suggestions across reopen.

### Deliverables
- stronger chat re-entry behavior on project reopen
- persisted post-accept suggested tasks
- create / edit / dismiss lifecycle survives close/reopen
- small continuity and feedback fixes

### Key requirements
- do not auto-open chat aggressively in a way that feels intrusive
- only auto-open if sensible (no restored Morticus webview, first activation in session, etc.)
- suggested tasks must not be removed by title matching; use stable suggestion identity
- comments/docs aligned with actual behavior

### Why this phase matters
4B strategic behavior should not be built on top of a chat surface that still feels secondary or fragile.

### Verification
- reopen project and naturally return to chat
- starter task suggestions survive close/reopen
- create/dismiss actions persist correctly
- no regression to existing flows

---

## Phase 4B.1 — "What should we do next?"

### Goal
Make the main chat useful as a strategic trunk without broadening into a giant reasoning surface.

### Inputs
- canonical state
- phase
- phaseGoal
- nextStep
- top risks
- active tasks
- recently completed tasks
- awaiting review

### Outputs
- grounded strategic answer
- optionally 1–2 draft tasks
- no direct mutation

### Rules
- if the answer implies substantial exploration or implementation, prefer proposing a task
- do not perform deep work inline
- do not mutate state automatically

### Why this phase matters
This is the first real strategic-trunk feature. It should make returning to the project feel intelligent.

### Verification
- user asks "what should we do next?"
- system responds using actual project state and task context
- optionally offers actionable draft tasks
- no mutation unless explicitly confirmed later

---

## Phase 4B.2 — Chat-Driven State Updates

### Goal
Let the user update project truth naturally from the main chat while preserving governed review.

### Examples
- "Add a decision: use bitboards"
- "Record this risk"
- "Update next step"
- "We should preserve local auth middleware"

### Flow
chat
→ typed draft delta
→ review panel
→ accept / reject
→ canonical state update

### Rules
- no direct mutation from chat
- chat produces structured draft only

### Why this phase matters
This is how the strategic trunk begins to genuinely govern state.

---

## Phase 4B.3 — Chat-Driven Phase Transitions

### Goal
Let the user move naturally between phases from the main chat.

### Examples
- "We're done with rules. Move to engine architecture."
- "Enter AI implementation phase."
- "Let's shift focus to validation."

### Flow
chat
→ draft phase delta
→ review
→ accepted phase update

### Fields
- phase
- phaseGoal
- maybe nextStep
- optional later: phaseExitCriteria

### Rules
- keep phase model lightweight
- avoid bureaucracy

---

## Phase 4C — Task Workspace Strengthening

### Goal
Make a task feel like a real local workspace, not just a background job.

### Deliverables
- better live task-run UX
- clear task-local history
- current step / progress
- files touched
- logs / test outputs / artifacts
- easier rerun / refine / retry flow

### Long-term direction
Move from:
- task = executable unit

toward:
- task = executable unit + inspectable working context

### Why this phase matters
This is one of the biggest "non-mid" unlocks.

---

## Phase 5 — Branch / Discard / Resume from State

### Goal
Let the user go down bad paths without polluting future context.

### Deliverables
- branch from state snapshot
- discard branch cleanly
- resume from prior accepted state
- compile fresh context from snapshot
- do not inherit useless transcript bulk

### Rules
- branch the project state / task execution context, not just chat history
- archive bad branches if useful
- canonical truth should remain clean

### Why this phase matters
This is one of the strongest differentiators in the product.

---

## Phase 6 — Scratchpad Mode

### Goal
Create a temporary side-thinking layer that does not pollute canonical state or the strategic trunk.

### Interaction model
- spawn scratchpad from main chat or task workspace
- background clouds / dims
- popup scratchpad opens
- user explores freely
- on exit, system produces structured handoff:
  - draft task
  - draft state update
  - memory candidate
  - archive only
  - discard

### Rules
- scratchpad is temporary
- scratchpad does not directly mutate canonical state
- parent context receives only distilled handoff

### Why this phase matters
This gives the user a place for messy thought without destroying the architecture.

---

## Phase 7A — MemCell Foundation (EverMemOS-Inspired)

### Goal
Establish the MemCell as Morticus's atomic memory unit. This is the architectural foundation that import, context slicing, archive, and retrieval all build on. Must land before any of those phases.

### Why this must come first
- Import (Phase 8) needs to produce MemCells, not flat chunks — building both separately means building twice
- Context slicing (Phase 9) needs memory types and BM25/RRF — the current `scoreKeywordRelevance` is a placeholder
- Archive storage needs MemCells as the retrieval unit
- Scratchpad v2 needs MemCell output on exit
- `TranscriptChunk` in import and `MemCell` in the memory engine are the same abstraction

### Key Concepts (from EverMemOS, Apache 2.0)
- **MemCell**: Boundary-detected memory unit. A coherent chunk of interaction, not an arbitrary slice. Created at natural boundaries (task completion, review acceptance, chat topic shift) or force-split thresholds (8192 tokens / 50 messages).
- **Multi-type extraction**: From each MemCell, extract in a single LLM call:
  - **Episodic**: Narrative summary of what happened ("benchmarked bitboards vs mailbox, chose bitboards for 3x perf")
  - **Event Log**: Atomic facts — individual decisions, constraints, conventions (maps to current `MemoryEntry`)
- **BM25 + RRF retrieval**: Proper term-frequency scoring and reciprocal rank fusion. Replaces `scoreKeywordRelevance`.
- **Type-aware retrieval**: Episodic summaries for broad context, event log for precision facts.

### What we extract (simplified from EverMemOS)
EverMemOS extracts 4 types (episodic, foresight, event log, profile) via 3-4 parallel LLM calls per MemCell. Morticus extracts 2 types (episodic + events) in 1 LLM call. Rationale:
- **Foresight** (predictions): Canonical state `risks` + `nextStep` already captures this, review-gated. LLM-speculative predictions are lower value for software projects.
- **Profile** (progressive model): `CanonicalProjectState` IS the progressive project profile. A second LLM-generated profile would conflict.
- **Episodic + Event Log**: High value. Episodic gives compact narrative summaries for context packing. Events give searchable atomic facts. One extraction call produces both.

### Natural Boundaries in Morticus (MemCell Sources)
| Event | Boundary Type |
|---|---|
| Task run completion | Natural — one MemCell per run |
| Review acceptance | Natural — decisions become events |
| Chat session turn (long) | Force-split at 8192 tokens / 50 messages |
| Scratchpad exit | Natural — handoff produces MemCell |
| Import chunk processing | Pre-chunked by transcript parser |

### Deliverables

**Domain (~60 lines)**
- `MemCell` type with boundary metadata, source reference, timestamp
- `MemoryType` union: `'episodic' | 'event'`
- `BoundaryReason` union: `'task_completed' | 'review_accepted' | 'force_split' | 'topic_shift' | 'scratchpad_exit' | 'import_chunk'`
- `memCellId` link on `MemoryEntry`

**Runtime (~230 lines)**
- `memory-extractor.ts`: MemCell extraction — single LLM call → episodic summary + atomic events
- Boundary detection: force-split thresholds + natural boundary hooks
- Replaces current `knowledge-extractor.ts` single-pass pattern

**Retrieval (~100 lines)**
- `memory-retrieval.ts`: BM25 tokenizer + index, RRF fusion algorithm
- Replaces `scoreKeywordRelevance` in context-pack

**Storage (~70 lines)**
- `memcell-store.ts`: MemCell persistence, retrieval by time range / source / keyword
- Wired into `ProjectStore`

**Wiring (~60 lines)**
- `run-controller.ts`: trigger MemCell creation on task completion
- `chat-adapter.ts`: boundary detection for long sessions

**Tests (~300 lines)**

### Architecture Placement
```
src/domain/durable-memory.ts    → MemCell type, MemoryType, BoundaryReason, memCellId on MemoryEntry
src/runtime/memory-extractor.ts → NEW: MemCell extraction (replaces knowledge-extractor pattern)
src/runtime/memory-retrieval.ts → NEW: BM25 index + RRF fusion
src/compiler/context-pack.ts    → Type-aware memory selection, BM25/RRF scoring
src/storage/memcell-store.ts    → NEW: MemCell persistence
```

### What This Does NOT Include
- No MongoDB / Elasticsearch / Milvus / Redis (local JSON storage)
- No Docker infrastructure dependency
- No vector embeddings (keyword retrieval via BM25 is sufficient for v1)
- No foresight or profile extraction (canonical state handles these)
- No external API dependency for core memory operations

### Design Principle
Port EverMemOS's **memory model and extraction logic** (Apache 2.0), not its infrastructure. Morticus stays local-first and review-gated. MemCell extraction is LLM-assisted; boundary detection, retrieval, and storage are pure TypeScript.

### Why this phase matters
This is the foundation everything else builds on. Import produces MemCells. Context slicing consumes them by type. Archive stores them. Retrieval searches them. Without this, each downstream phase invents its own memory abstraction.

---

## Phase 7B — Context Slicing v2 (MemCell-Aware)

### Goal
Upgrade context slicing (Phase 9 v1) to use MemCell types and BM25/RRF retrieval instead of flat keyword matching.

### What changes from v1
| v1 (current) | v2 (MemCell-aware) |
|---|---|
| `scoreKeywordRelevance()` keyword overlap | BM25 term-frequency scoring + RRF fusion |
| Category-based filtering (`architecture`, `convention`, etc.) | Type-based filtering (`episodic` for summaries, `event` for precision) |
| No temporal awareness | Recency weighting — newer MemCells preferred for active work |
| `ContextManifest` tracks included/excluded counts | Manifest tracks memory types included, BM25 scores, temporal range |
| `resolveContextProfile()` returns category + keyword config | Profile returns type preferences per surface + retrieval strategy |

### Deliverables
- `resolveContextProfile()` extended with memory type preferences per surface
- `buildMemoryEntries()` uses BM25/RRF from `memory-retrieval.ts`
- Episodic summaries preferred for task context (compact, narrative)
- Event entries preferred for precision queries (atomic, searchable)
- Temporal weighting in retrieval scoring
- Updated `ContextManifest` with type + score diagnostics

### Dependencies
- Phase 7A (MemCell types, BM25/RRF retrieval, memory type on entries)

### Why this phase matters
v1 context slicing works but uses crude keyword matching on flat entries. MemCell-aware slicing selects the right *type* of memory for each surface at higher relevance with lower token cost.

---

## Phase 8 — Transcript Import / Migration (MemCell-Native)

### Goal
Reduce onboarding friction by importing prior AI work and compiling it into Morticus's MemCell-based memory model.

### Key change from original design
Import chunks map directly to MemCells. `TranscriptChunk` and `DocSection` become MemCell inputs, not a separate abstraction. Extraction produces episodic summaries + atomic events per MemCell, using the same `memory-extractor.ts` from Phase 7A. No separate `ImportExtractionResult` type — import reuses the MemCell pipeline.

### Primary source (Phase 8A): Claude CLI JSONL
Claude CLI stores conversations as JSONL at `~/.claude/projects/<hash>/<id>.jsonl`.
Each line is a structured message event with explicit roles, tool use, and timestamps.
This is the cleanest import path and the default target for Phase 8A.

The JSONL format gives us:
- no heuristic format detection needed
- roles are typed fields, not regex-matched strings
- tool use / tool results are structured (can skip or compress)
- timestamps for ordering and provenance

### Secondary sources (Phase 8B, lower priority)
- markdown transcripts (heading-based or bold-prefix)
- plain text chat dumps (`User:` / `Assistant:` prefixes)
- prior planning docs (section-based extraction)

### Import pipeline (MemCell-native)
```
File → parse/chunk → boundary detection → MemCell creation
                                            ↓
                              MemCell extraction (episodic + events)
                                            ↓
                              Conflict detection vs canonical state
                                            ↓
                              Import panel → selective review/accept
```

### Outputs
- MemCells (archived, searchable)
- Draft canonical state (from episodic summaries)
- Candidate memory entries (from event extraction, origin: 'imported')
- Candidate tasks
- Conflict report

### Rules
- imported material is not truth by default
- import is compilation + review, not trust
- provenance must be preserved (`sourceArchiveId`, `memCellId`)
- tool use content should be compressed or skipped by the extractor

### Dependencies
- Phase 7A (MemCell types, extraction pipeline, storage)

### Why this phase matters
This is a strong adoption wedge. Claude CLI JSONL means any user who has been planning in Claude Code can migrate their prior thinking directly into Morticus's structured memory.

---

## Phase 8B — Scratchpad v2 (MemCell Output)

### Goal
Upgrade scratchpad exit to produce MemCells instead of flat handoff objects. Scratchpad sessions become searchable, retrievable memory after exit.

### What changes
- Scratchpad exit runs MemCell extraction (episodic summary + events) on the session
- Archived scratchpad = MemCell with `boundaryReason: 'scratchpad_exit'`
- Handoff still produces typed fields (draft task, draft delta, memory candidate) but these now link to the source MemCell

### Dependencies
- Phase 7A (MemCell extraction pipeline)

---

## Phase 9 v1 — Context Slicing and Cost Governance (DONE)

### Status: Complete (v1)
Basic context slicing with category filters, scope-based filtering, keyword relevance scoring, token budgets, priority trimming. See Phase 7B for the MemCell-aware upgrade.

### What v1 delivered
- `ContextProfile` per surface with state/memory/token policies
- `resolveContextProfile()` maps surface + taskType → defaults
- `scoreKeywordRelevance()` for basic keyword matching
- `ContextManifest` tracking what was included/excluded
- Scope-based filtering for knownFiles, decisions, risks

---

## Phase 10 — Shadow Analysis Runs

### Goal
Allow important retrieved/async material to be studied without bloating the active context.

### Deliverables
- bounded secondary analysis runs
- same base state/task context
- narrow analysis objective
- MemCell-based retrieval to select analysis targets
- compressed structured return:
  - summary
  - evidence
  - candidate delta
  - candidate follow-up task

### Rules
- no direct mutation from shadow runs
- use sparingly
- no uncontrolled recursive spawning

### Dependencies
- Phase 7A (MemCell retrieval for selecting relevant historical material)

### Why this phase matters
This unlocks strong retrieval and historical reuse without context explosion.

---

## Phase 11 — Reconciliation Against Repo Reality

### Goal
Make project truth checked, not just remembered.

### Deliverables
- merge-time checks
- stale-state detection
- scope validation
- evidence validation
- diff-to-delta checks
- repo / test / config reconciliation
- drift detection over accepted state

### Conflict classes
- scope conflict
- stale-state conflict
- evidence conflict
- constraint conflict

### Why this phase matters
This is one of the deepest trust and differentiation layers.

---

## Phase 11.5 — Spoken Record Layer (EverMemOS-Inspired)

### Goal
Persistent, searchable record of all conversational interaction. Not authoritative — feeds reconciliation checks against canonical state.

### What it captures
Everything that canonical state intentionally discards:
- **Reasoning**: why decisions were made, alternatives considered, arguments for/against
- **Failed experiments**: approaches that were tried and abandoned, and why
- **Correction patterns**: repeated mistakes, things the agent keeps getting wrong
- **Evolving understanding**: how the team's mental model shifted over time

### Relationship to canonical state
```
Canonical State  →  What IS true (authoritative, review-gated)
Durable Memory   →  What should be remembered (curated facts)
Spoken Record    →  What was SAID (comprehensive, not authoritative)
```

The spoken record never overrides canonical state. When retrieval surfaces spoken material that contradicts a canonical decision, that's a **reconciliation flag**, not an automatic update.

### Use cases
- "Did we ever discuss X?" → search spoken record, get context
- "Why did we decide Y?" → MemCell with the conversation that produced decision Y
- "Has understanding drifted?" → compare recent spoken record against canonical state
- "The agent keeps making the same mistake" → pattern detection across spoken MemCells

### Implementation
- Full EverMemOS-style memory ingestion: every chat turn, task run, review, scratchpad → MemCells → stored
- BM25/RRF retrieval over the full spoken record
- Reconciliation consumer compares spoken record trends against canonical state
- Optional: agentic multi-round retrieval (sufficiency check → refined queries → merge)

### Dependencies
- Phase 7A (MemCell foundation)
- Phase 11 (reconciliation — the primary consumer)

### Why this phase matters
This closes the gap between "what we decided" and "why we decided it." Without it, the reasoning behind canonical state evaporates with chat transcripts.

---

## Phase 12 — Generation Navigation UI

### Goal
Turn Morticus into a navigable work-state environment, not just a chat + sidebar system.

### Deliverables
- generation tree
- parent/current/child generation panes
- generation summary cards
- bottom generation scrubber / slider
- BFS / DFS-like navigation through branches
- breadcrumbs and path awareness

### Rules
- do not load full transcripts by default
- summary-first, expand-on-demand
- keep the UI fast and intuitive

### Why this phase matters
This is a major UI differentiator and part of the product becoming OS-like.

---

## Phase 13 — Team / Enterprise Layer

### Goal
Support shared project truth, policy, and governance across multiple users.

### Deliverables
- shared canonical state
- org memory
- permissions / admin controls
- auditability
- role-aware review
- billing / deployment strategy later

### Note
Do not prioritize before the single-user product clearly works.

---

# Sequencing Guidance

## Completed
1. Phase 4A.6 — Chat Centrality and Continuity
2. Phase 4B.1 — "What should we do next?"
3. Phase 4B.2 — Chat-Driven State Updates
4. Phase 4B.3 — Chat-Driven Phase Transitions
5. Phase 4C — Task Workspace Strengthening
6. Phase 5 — Checkpoint + Resume from State
7. Phase 5A — Schema Migration + Context Slicing
8. Chat as Coherent Home Surface (project snapshot, create & run, review outcomes, completeness cues)
9. Phase 6 — Scratchpad Mode (v1)
10. Phase 9 — Context Slicing and Cost Governance (v1)

## Next (dependency-ordered)
11. **Phase 7A — MemCell Foundation** ← architectural prerequisite for everything below
12. Phase 7B — Context Slicing v2 (MemCell-aware, replaces v1 keyword matching)
13. Phase 8A — Transcript Import (Claude CLI JSONL, MemCell-native)
14. Phase 8B — Scratchpad v2 (MemCell output on exit)

## Longer-term
15. Phase 10 — Shadow Analysis Runs (consumes MemCells)
16. Phase 11 — Reconciliation Against Repo Reality
17. Phase 11.5 — Spoken Record Layer (EverMemOS-inspired persistent conversational memory, feeds reconciliation)
18. Phase 12 — Generation Navigation UI
19. Phase 13 — Team / Enterprise Layer

---

# Hard Rules for Implementation

## Do not overbuild
Do not implement broad future-phase architecture before the smallest real slice is working.

## Preserve review boundaries
No chat, scratchpad, retrieval, or shadow analysis should mutate canonical truth directly.

## Keep chat roles distinct
- main chat steers
- task workspace executes
- scratchpad explores

## Avoid transcript re-bloat
Do not let archive, scratchpad, or main chat become giant context blobs again.

## Favor typed drafts
Conversation should produce typed drafts, not hidden magic.

## Favor sliced context
Never assume full canonical state belongs in every subtask.

## MemCells are the universal memory unit
All memory flows through MemCells. Import produces MemCells. Tasks produce MemCells on completion. Scratchpads produce MemCells on exit. Context slicing consumes MemCells by type. Archive stores MemCells. Do not build parallel memory abstractions.

---

# Immediate Next Step

The next planned implementation target should be:

## Phase 7A — MemCell Foundation

Architectural prerequisite for import, context slicing v2, scratchpad v2, shadow analysis, and reconciliation. Establishes the MemCell as the atomic memory unit across all Morticus subsystems.
