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
- Suggested kickoff tasks as post-accept suggestions
- Enriched steering context with task activity

## Current gaps
- Chat is not yet the obvious long-term home surface
- Post-accept suggested tasks need strong persistence and continuity
- Main strategic trunk is still shallow
- "What should we do next?" does not yet exist
- Task runs still feel closer to jobs than true task workspaces
- Branch/discard/resume from state is not yet real
- Archive / retrieval / scratchpad are not yet built
- Context slicing is still immature relative to the long-term vision
- Reconciliation against repo reality is still minimal

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

## Durable Memory
Long-lived project knowledge that can influence future runs.

## Archive
Transcript and run history outside hot context, retrievable when relevant.

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

## Phase 7 — Archive and Retrieval Layer

### Goal
Keep transcripts and historical work available without bloating active model context.

### Deliverables
- archive task transcripts
- archive trunk history
- archive scratchpads
- archive run outputs / review discussions
- hybrid retrieval:
  - keyword
  - vector
  - metadata
- archive summaries and source links

### Rules
- archive is not canonical state
- retrieved material must be selective and compact
- do not automatically stuff archive into live context

### Why this phase matters
This is critical for restartability, long project continuity, and cost control.

---

## Phase 8 — Transcript Import / Migration

### Goal
Reduce onboarding friction by importing prior AI work and compiling it into Morticus structures.

### Inputs
- markdown transcripts
- chat dumps
- text notes
- prior planning docs

### Outputs
- draft canonical state
- candidate durable memory
- candidate tasks
- archive records
- ambiguity / conflict report

### Rules
- imported material is not truth by default
- import is compilation + review, not trust
- provenance must be preserved

### Why this phase matters
This is a strong adoption wedge.

---

## Phase 9 — Context Slicing and Cost Governance

### Goal
Reduce cost and improve quality by sending only relevant slices of state, memory, and archive into each run.

### Deliverables
- state slicing for subtasks
- memory slicing
- archive slice retrieval
- stable prompt prefixes
- stronger token estimation / cost visibility
- fresh-run-from-snapshot patterns everywhere

### Rules
- do not send full canonical state into every subtask
- choose relevance by task type, scope, subsystem, phase, and risks
- optimize for the smallest sufficient context

### Why this phase matters
This is both a quality and economics layer.

---

## Phase 10 — Shadow Analysis Runs

### Goal
Allow important retrieved/async material to be studied without bloating the active context.

### Deliverables
- bounded secondary analysis runs
- same base state/task context
- narrow analysis objective
- compressed structured return:
  - summary
  - evidence
  - candidate delta
  - candidate follow-up task

### Rules
- no direct mutation from shadow runs
- use sparingly
- no uncontrolled recursive spawning

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

## Near-term priority
1. Phase 4A.6
2. Phase 4B.1
3. Phase 4B.2
4. Phase 4B.3
5. Phase 4C

## Mid-term priority
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8
10. Phase 9

## Longer-term priority
11. Phase 10
12. Phase 11
13. Phase 12
14. Phase 13

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

---

# Immediate Next Step

The next planned implementation target should be:

## Phase 4A.6 — Chat Centrality and Continuity

After that:

## Phase 4B.1 — "What should we do next?"

Do not jump to broad 4B all at once.
