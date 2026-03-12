# Project-State Control Plane for AI-Assisted Software Work

## Working Title
Project-State Control Plane

## Status
Draft PRD / Strategy Memo

## Document Intent
This document captures the product, technical, and business design for a system that governs long-running AI-assisted software work through canonical project state, scoped task chats, deterministic review, and evidence-backed merge into durable working state.

It is intentionally detailed, but not over-closed. The purpose is to create a rigorous shared frame while preserving room for iteration on UX, state models, provider integrations, and downstream business strategy.

---

# 1. Executive Summary

We are not trying to build a generic AI IDE.

We are trying to build a control plane for long-running software work where multiple AI agents, chats, tasks, and implementation attempts can happen without corrupting the project’s canonical state.

The core insight is that current AI coding workflows degrade because they conflate transcript with memory. Long chats accumulate too much temporary reasoning, stale assumptions, dead-end exploration, and repeated setup. This causes the user to lose confidence in what the project currently believes, what is settled, what is still tentative, and what should happen next.

This product solves that by separating:
- canonical project state,
- durable memory,
- task-local execution and chat,
- deterministic post-task review,
- and evidence-backed merge into accepted state.

The product should feel like:
- one persistent project spine,
- many scoped task chats,
- explicit completion and reconciliation,
- and a clean, reviewable state model that survives beyond any one conversation.

The system is not primarily trying to make the model "remember more." Frontier labs already expose strong memory, compaction, and delegation primitives. The wedge is different: we make long-running software work legible, governable, restartable, and reviewable.

The long-term ambition is an operating layer for AI-assisted software projects. The near-term product is a VS Code extension and local orchestration layer that maintains canonical project state, launches scoped tasks, normalizes outputs, checks them against repository reality, and prompts structured review before state updates become canonical.

---

# 2. Product Thesis

## Core Thesis
AI coding breaks down on medium and large projects because transcript history is a poor container for project truth.

Long conversations mix together:
- durable rules,
- current decisions,
- exploratory reasoning,
- command output,
- implementation attempts,
- unresolved questions,
- and stale assumptions.

Over time, the user cannot reliably answer:
- What does the project currently believe?
- What is still tentative?
- What constraints are active?
- Which files matter?
- What happened in a child task?
- What is the real next step?

The product thesis is:

**AI-assisted software work should be organized around canonical project state, scoped task execution, and reviewed state deltas rather than ever-growing chat transcripts.**

## Why This Matters
The user wants to:
- keep a project alive across sessions,
- offload work without losing control,
- let agents explore without poisoning main context,
- review what matters,
- recover quickly after failed attempts,
- and preserve trust in project state.

The core competitive claim is not model intelligence.
It is workflow intelligence and state discipline.

---

# 3. Product Vision

## Long-Term Vision
A project operating system for AI-assisted software work.

This system governs:
- what the project currently knows,
- what is canonical versus tentative,
- how work is scoped and delegated,
- what evidence supports accepted claims,
- what conflicts with reality,
- and what gets merged back into working state.

## Near-Term Vision
A VS Code extension that:
- stores canonical project state,
- lets the user create scoped task nodes,
- attaches task-specific chats or execution runs,
- compiles deterministic task specs,
- reconciles proposed outputs against repo/test/policy facts,
- and prompts structured review before canonical state changes.

## Product One-Liner Options
- Control plane for long-running AI software work
- Project-state layer for coding agents
- Governed task system for AI-assisted coding
- Canonical state and reviewed merge for agent-driven development

---

# 4. Problem Statement

## Current User Pain
Users doing multi-step work with AI assistants often do this:
1. start a promising planning chat,
2. accumulate setup context and project rules,
3. go deep into exploration,
4. realize the chat is bloated,
5. start a fresh chat,
6. hand-write a summary,
7. lose subtle constraints,
8. repeat the cycle.

The result is:
- repeated context loading,
- growing ambiguity,
- state drift,
- poor restartability,
- and low trust in the system.

## Root Cause
The system lacks first-class support for:
- canonical state,
- scoped execution branches,
- durable memory outside transcript,
- evidence-backed merge,
- and deterministic review.

## Opportunity
Build the layer that treats project truth as a governed object, not as an accidental side effect of chat history.

---

# 5. Product Principles

## 5.1 Canonical State Is the Product Object
The main product object is not the chat.
It is the project’s canonical working state.

This state should include:
- goal,
- phase,
- constraints,
- decisions,
- risks,
- key file map,
- linked artifacts,
- next step.

The chat is an interface. The state object is the product.

## 5.2 Task Chats Are Workspaces, Not Truth
Users may work through separate chats for separate tasks.
Those chats are useful and inspectable, but they are not canonical truth.
They are workspaces for exploration, implementation, validation, and reasoning.

## 5.3 Nothing Becomes Canonical Without Review
No task output should mutate accepted project state directly.
A deterministic review layer must normalize task output, reconcile it against reality, and present structured deltas for review.

## 5.4 Durable Memory Is Separate from Working State
The system should clearly separate:
- long-lived project memory,
- current accepted working state,
- and ephemeral task-local chatter.

## 5.5 Repository Reality Matters
Canonical state is not just prose. It must be continuously tested against reality where possible:
- code,
- diffs,
- tests,
- config,
- changed files,
- and task scope contracts.

## 5.6 The User Must Be Able to Parse What Happened
The user should be able to inspect task chats, task steps, artifacts, evidence, and review deltas quickly. Parseability is a product feature.

## 5.7 Determinism Where It Matters
The system may use LLMs for inference, extraction, summarization, and drafting. But permissions, task contracts, scope resolution, completion gating, and merge checks should be driven by typed schemas, policies, and deterministic compiler logic wherever possible.

## 5.8 Free Thought Is Allowed Inside the Guardrails
The product should not over-bureaucratize exploration. It should allow open-ended reasoning inside task workspaces while preserving a clean state boundary between exploration and canonical project truth.

---

# 6. Key Insights Developed So Far

## 6.1 Transcript Is Not Memory
This is the original and central insight.

## 6.2 Branching Alone Is Not Enough
OpenAI, Anthropic, GitHub, and others increasingly expose branching, delegation, memory, and compaction. Those primitives are not sufficient as a moat.

## 6.3 The Real Wedge Is Governed Project State
The system becomes more interesting when it maintains typed, reviewed, versioned project claims and reconciles them against code and artifacts.

## 6.4 Summarization Is Not the Same as Canonical State
Summaries help preserve context. They do not, by themselves, create trustworthy project state.

## 6.5 A Task Chat Can Stay Human-Friendly If Review Is Deterministic
The user can still read and work through chats, while a separate engine determines completion, normalization, reconciliation, and merge readiness.

## 6.6 User Attention Can Improve State Synthesis
Behavioral and explicit attention signals during task chat parsing can help identify what matters. These signals should drive salience and candidate claim extraction, not direct canonical mutation.

---

# 7. Product Scope

## In Scope for the Core Product
- Canonical project state
- Durable memory
- Task creation and task specs
- Separate task chats or task runs
- Completion gating
- Output normalization
- Deterministic review
- State delta review and acceptance
- Evidence links
- Basic repo reconciliation
- Multi-provider task execution model
- Task and project indexing

## Explicitly Out of Scope Initially
- Fully autonomous swarms
- Autonomous durable-memory writes
- Full editor fork
- Enterprise collaboration first
- Deep remote execution first
- Rich analytics as a primary feature
- Opaque self-modifying orchestration

---

# 8. User Types

## 8.1 Individual Technical Builder
Someone shipping code with AI assistance on medium-sized or long-running projects.

Needs:
- restartability,
- clarity,
- scoped work,
- less context pollution.

## 8.2 PM / Technical Operator Using AI Agents
A user orchestrating AI work across a codebase without necessarily wanting to live inside raw CLI agent loops.

Needs:
- visibility,
- task structure,
- separate workspaces,
- controlled merge.

## 8.3 Advanced Engineer on Complex Codebase
Someone using multiple agent tools and wanting state governance, provider-agnostic orchestration, and reviewable truth.

Needs:
- evidence,
- drift detection,
- strong contracts,
- and low ambiguity.

Later, there may be a strong team use case, but the first product should optimize for one user working over time.

---

# 9. User Jobs To Be Done

1. Keep one software project alive across many sessions.
2. Offload scoped work into a separate task chat or run.
3. Read through task work without losing the main project state.
4. See what changed and why before accepting it.
5. Detect when accepted project state no longer matches the repo.
6. Resume work after days away without reloading everything mentally.
7. Use multiple providers without losing one coherent project state.

---

# 10. Core Product Objects

## 10.1 Project
Top-level container holding:
- repo/workspace,
- canonical state,
- durable memory,
- task graph,
- task runs,
- artifacts,
- settings,
- provider configs.

## 10.2 Canonical Project State
Versioned, typed working state.

Contains:
- goal,
- phase,
- constraints,
- accepted decisions,
- active risks,
- known files,
- linked artifacts,
- next step,
- state version,
- timestamps,
- evidence references.

## 10.3 Durable Memory
Long-lived project knowledge.

Examples:
- coding standards,
- environment setup,
- domain glossary,
- architecture invariants,
- workflow preferences,
- test conventions.

## 10.4 Task Node
A unit of work with:
- title,
- goal,
- scope,
- task type,
- provider preference,
- base state version,
- permissions,
- task chat or task runs,
- status,
- artifacts,
- candidate delta,
- review outcome.

## 10.5 Task Chat / Task Run
A human-facing or worker-facing workspace tied to a task.
This may be backed by a provider chat, CLI run, SDK run, or mixed execution loop.

## 10.6 Task Spec
The deterministic task contract.

Contains:
- task id,
- base state version,
- scope paths,
- allowed tools,
- write permissions,
- test requirements,
- output schema,
- stop conditions,
- merge policy.

## 10.7 State Delta
The proposed change to canonical state.

Contains:
- additions,
- removals,
- modifications,
- evidence refs,
- confidence,
- optional artifact links,
- possible conflicts.

## 10.8 Claim Graph
An internal graph of accepted and candidate claims tied to evidence, files, tasks, and supersession relationships.

---

# 11. Memory Model

## 11.1 Durable Memory
Long-lived project-level truths and preferences.
Rarely changed. Explicitly edited or promoted.

## 11.2 Working Memory
Current accepted project state.
Small, active, versioned, highly visible.

## 11.3 Ephemeral Memory
Task-local reasoning, chat, logs, failed attempts, command output, exploration artifacts.
Usually disposable unless promoted via delta, artifact retention, or evidence linkage.

---

# 12. Canonical State Model

A representative structure:

```json
{
  "version": 42,
  "goal": "Add SSO login without breaking local auth",
  "phase": "backend implementation",
  "constraints": [
    "Preserve existing session middleware",
    "Backend-first rollout",
    "Add regression tests",
    "Keep UI changes minimal"
  ],
  "decisions": [
    "Use feature flag for rollout",
    "Do not introduce provider-specific UI logic yet"
  ],
  "risks": [
    "Callback route may bypass existing middleware",
    "Token refresh ownership is not yet decided"
  ],
  "known_files": [
    "src/server/auth.ts",
    "src/server/session.ts",
    "src/ui/login/*"
  ],
  "next_step": "Implement backend config wiring and token validation only",
  "evidence_refs": [
    "task-17:run-2:file:src/server/auth.ts",
    "task-17:run-2:test:auth-regression"
  ],
  "updated_at": "2026-03-10T00:00:00Z"
}
```

This object should back the visible state view.

---

# 13. Claim Model and Evidence Model

## Why Claims Matter
Canonical state should not just be prose. It should be decomposable into claims that can be versioned, supported, superseded, or challenged.

## Claim Types
- constraint
- decision
- risk
- next-step
- file-map item
- architecture observation
- test outcome
- scope contract

## Claim Verification Classes
### Fully Verifiable
- files touched
- scope boundaries
- tests run or not run
- worktree used
- changed files
- config presence

### Partially Verifiable
- architecture path traced
- likely middleware conflict
- likely stale dependency

### Human-Judgment Only
- design is cleaner
- rollout is safer
- implementation is elegant

## Evidence Types
- file refs
- diff refs
- test outputs
- command outputs
- task messages
- user salience anchors
- provider run metadata

## Graph Structure
Nodes:
- project
- task
- run
- claim
- file
- artifact
- state version

Edges:
- derived_from
- supported_by
- supersedes
- conflicts_with
- relates_to
- touched_in
- validated_by

## Hashing
Each normalized claim should have a stable hash from:
- claim type,
- normalized content,
- scope,
- supporting evidence ids.

This helps dedupe, trace supersession, and retrieve by identity.

---

# 14. Task Model

## Task Types
Recommended initial set:
- Discovery
- Implementation
- Validation

Later additions:
- Refactor Review
- Test Triage
- Architecture Audit
- Migration Plan

## Task Lifecycle
- Draft
- Ready
- Running
- Awaiting Completion
- Normalizing Output
- Awaiting Review
- Merged
- Rejected
- Archived

This is slightly stricter than a simple completed state and helps separate execution from review readiness.

## Task Fields
- id
- parent project id
- optional parent task id
- title
- goal
- task type
- scope
- scoped files
- provider
- permissions
- base state version
- status
- artifacts
- completion status
- normalized output
- candidate delta
- review decision

---

# 15. Task Chat Model

## Principle
Users are expected to work through separate task chats.
Those chats should be visible, traversable, and usable as workspaces.

## Important Distinction
Task chats are not themselves canonical state.
They are execution and exploration surfaces attached to a task contract.

## What the User Should Be Able To Do in a Task Chat
- read what the agent is doing,
- steer the task,
- view files and diffs,
- inspect evidence,
- review commands and logs,
- parse long output quickly,
- mark salient moments,
- and later trigger or review state synthesis.

## Completion Boundary
A task chat ends in one of these ways:
- provider indicates it is done,
- user stops and marks ready,
- run exits,
- or completion criteria are met.

The deterministic review engine then takes over.

---

# 16. Deterministic Task Spec Compilation

## High-Level Principle
Use the LLM for intent understanding and proposal.
Use deterministic compiler logic for the actual task contract.

## Pipeline
User request
→ LLM extracts typed TaskIntent
→ deterministic resolver maps intent to TaskSpec
→ policy engine validates permissions and scope
→ system freezes a versioned task contract

## Deterministic Fields
- task id
- base state version
- worktree path
- scope paths
- allowed tools
- write permissions
- test targets
- output schema version
- merge policy
- staleness checks

## Inputs to the Resolver
- canonical state
- durable memory
- task template library
- repo index / file graph
- policy config
- subsystem mapping
- recent file changes
- provider capabilities

## Example Resolver Function
A canonical internal function might look like:

`resolveTaskSpec(intent, state, repoIndex, policyConfig) -> TaskSpec`

The exact implementation can evolve, but this boundary should remain stable.

---

# 17. Output Normalization

## Why It Matters
Task chats and task runs are messy. Review cannot operate on raw transcript.

## Required Normalized Output
- human-readable summary
- machine-readable state delta
- files inspected
- files modified
- artifacts
- unresolved issues
- evidence refs
- confidence
- completion reason

## Suggested Schema
```json
{
  "summary": "OAuth callback path traced; potential middleware bypass found.",
  "inspected_files": ["src/server/auth.ts", "src/server/session.ts"],
  "modified_files": [],
  "proposed_delta": {
    "add_risks": ["OAuth callback may bypass session middleware"],
    "add_known_files": ["src/server/oauth.ts"],
    "set_next_step": "Validate callback path with regression tests"
  },
  "evidence_refs": ["msg_42", "msg_47", "test_1"],
  "confidence": 0.82,
  "completion_reason": "task_goal_met"
}
```

---

# 18. Review Engine

## Core Role
Once a task is considered done, the system should:
1. normalize its outputs,
2. run deterministic checks,
3. classify conflicts and staleness,
4. and prompt structured review.

## Deterministic Review Checks
- base state stale?
- files changed outside scope?
- write performed in read-only task?
- required outputs missing?
- tests required but not run?
- claimed files not present?
- delta unsupported by evidence?
- conflict with current canonical constraints?
- conflict with current repo state?

## Review Outcomes
- accept delta
- accept with edits
- reject delta
- archive task without merge
- promote selected output to durable memory

## Review Is Mandatory for Canonical Mutation
This should remain a core invariant.

---

# 19. State Reconciliation Against Code and Repo Reality

## Motivation
This is a major refinement to the original idea.
The system should periodically or event-driven test accepted project state and candidate deltas against repository reality.

## Code Is Not the Only Truth
Code is not the source of truth for everything.
It is the source of truth for implementation-level facts.
Intent, constraints, rollout preferences, and open risks may live outside code.

## Truth Model
### Implementation Truth
Derived from:
- code,
- diffs,
- config,
- tests,
- file graph,
- CI output.

### Intent Truth
Derived from:
- accepted decisions,
- durable memory,
- user-approved constraints,
- task contracts.

### Working Truth
Current synthesis of the two.

## Conflict Classes
- constraint conflict
- scope conflict
- state drift conflict
- evidence conflict
- staleness conflict

## Example
Accepted state says: preserve existing session middleware.
Patch bypasses the middleware.
This should surface as a high-severity conflict.

## Triggering Reconciliation
Prefer event-driven checks:
- on task completion,
- on merge review,
- on relevant file changes,
- on state changes,
- on test completion.

Background periodic checks may exist later.

---

# 20. Salience-Guided Chat Parsing and State Synthesis

## Motivation
We do not want generic compaction.
We want to help the user parse long task chats quickly and synthesize what matters into candidate project state.

## Feature Concept
A fast-reading transcript window that auto-scrolls or supports rapid chunk traversal. The user can leave lightweight importance signals while scanning.

## Signal Types
### Explicit Signals
- space bar tap for importance
- future variants: risk mark, decision mark, pin, ignore

### Implicit Signals
- dwell time
- revisits
- reverse scrolling
- expansion of diffs or evidence
- copy/select events
- repeated reopening of a chunk

## Design Principle
These signals indicate salience, not canon.
They should drive candidate claim extraction, not direct state mutation.

## Synthesis Pipeline
task chat transcript
→ chunking and segmentation
→ salience scoring
→ candidate region selection
→ LLM-based claim extraction
→ typed candidate delta
→ deterministic review
→ canonical update only after approval

## Product Framing
This is better described as attention-guided state synthesis, not generic summarization.

---

# 21. Retrieval, Indexing, and Access

## Requirements
The project state should be easy to access across:
- exact retrieval,
- graph traversal,
- semantic search,
- state version lookup,
- evidence lookup,
- claim lineage lookup.

## Indexing Strategy
### Exact / Hashed Index
For:
- claims,
- tasks,
- state versions,
- evidence ids.

### Graph Index
For:
- related claims,
- supporting tasks,
- file relationships,
- conflict propagation,
- supersession chains.

### Semantic Index
For:
- fuzzy natural-language recall,
- similar past decisions,
- concept lookup.

## Recommendation
Use a hybrid approach.
Do not rely only on embeddings.

---

# 22. Multi-Provider Architecture

## Principle
The task node is the canonical object, not the provider chat.

Codex, Claude, and future agents should be treated as workers attached to a task.

## Model
task node
→ task spec
→ provider run
→ artifacts and normalized output
→ deterministic review
→ canonical merge

## Why This Matters
Provider-specific chats are private surfaces. The product should not depend on owning their chat panes. The stable objects are:
- task specs,
- task runs,
- diffs,
- logs,
- evidence,
- proposed deltas.

## Task-Run Example
Task 24: Implement OAuth callback validation
- Run A: Codex
- Run B: Claude
- Run C: Claude retry after failing tests

The task node stays stable. Provider runs vary underneath.

---

# 23. UX Principles

## 23.1 Make Canonical State Prominent
Users should always be able to open the project and immediately see:
- goal,
- phase,
- constraints,
- decisions,
- risks,
- next step,
- recent accepted deltas.

## 23.2 Task Chats Should Feel Alive and Readable
The user should be able to inspect what the agent is doing without digging through useless noise.

## 23.3 Review Should Be Faster Than Reconstructing the Task
The user should never feel that merge review is more work than just redoing the thinking themselves.

## 23.4 Only Force Friction Where It Protects Truth
Rigid review is acceptable at the boundary to canonical state. It should not suffocate task execution.

## 23.5 Preserve Optional Free Thought
Exploratory reasoning should be allowed in task workspaces without over-structuring every moment.

---

# 24. Surface Design / Main Screens

## 24.1 Canonical State View
Primary project view.
Contains:
- goal,
- phase,
- constraints,
- decisions,
- risks,
- next step,
- recent accepted deltas,
- state version.

## 24.2 Task Tree / Task List
Contains:
- active tasks,
- status,
- provider,
- last update,
- scope,
- review status.

## 24.3 Task Chat / Task Workspace
Contains:
- provider chat or run log,
- current step,
- files touched,
- evidence references,
- salience parsing mode,
- artifacts.

## 24.4 Merge Review Panel
Contains:
- proposed delta,
- evidence,
- conflicts,
- files touched,
- confidence,
- accept / edit / reject.

## 24.5 Durable Memory Editor
Contains:
- project rules,
- invariants,
- conventions,
- change history.

## 24.6 Artifact / Evidence Viewer
Contains:
- logs,
- tests,
- diffs,
- evidence refs,
- file links.

---

# 25. MVP Definition

## MVP Question
Can a governed task-chat + deterministic review + canonical state model outperform plain long-chat coding workflows on multi-step project work?

## MVP Includes
- single-user local project
- canonical state view
- durable memory store
- task creation
- task spec compiler
- task runs or task chats
- manual or semi-automated output normalization
- merge review with state delta
- local artifact tracking
- git worktree support
- basic provider adapters
- state versioning
- minimal reconciliation checks

## MVP Excludes
- autonomous branching
- deep semantic verification engine
- team sync
- cloud orchestration first
- autonomous durable memory mutation
- heavy analytics
- full editor replacement

---

# 26. MVP Flow

1. User creates project and imports repo.
2. User defines or edits canonical state and durable memory.
3. User creates a task.
4. System compiles task spec.
5. Provider run or task chat starts.
6. User can inspect and steer the task.
7. Task reaches completion criteria.
8. System normalizes output.
9. System runs deterministic checks.
10. User reviews proposed delta.
11. Accepted delta updates canonical state.
12. Task remains as artifact/workspace, but main project truth stays clean.

---

# 27. Technical Architecture

## 27.1 First Shipping Form
VS Code extension plus local service or local runtime.

## 27.2 Major Components
### Extension UI Layer
- task tree
- canonical state panel
- task workspace view
- merge review
- evidence viewer

### Domain Layer
- state types
- task types
- policies
- lifecycle rules

### Compiler Layer
- intent extraction boundary
- task spec resolution
- context pack build
- staleness checks

### Runtime Layer
- worktrees
- provider adapters
- test runner hooks
- artifact capture

### Review Layer
- normalization
- validation
- reconciliation
- delta application

### Storage Layer
- project state store
- durable memory
- tasks/runs
- artifacts
- graph/index store

---

# 28. Storage Model

## Early Version
- local JSON / SQLite for structured state
- filesystem artifacts
- git worktrees
- local index files

## Later Version
- relational store for tasks/runs/reviews
- graph store or graph-like index for claims/evidence
- vector store for fuzzy retrieval
- object storage for logs and artifacts

---

# 29. Data Model Sketch

## Project
- id
- name
- repo_path
- created_at
- updated_at
- current_state_version
- durable_memory_version

## CanonicalStateVersion
- id
- project_id
- version
- state_json
- created_at
- created_from_delta_id

## Task
- id
- project_id
- title
- goal
- task_type
- provider
- base_state_version
- status
- created_at
- updated_at

## TaskSpec
- id
- task_id
- spec_json
- created_at
- compiler_version

## TaskRun
- id
- task_id
- provider
- run_status
- started_at
- ended_at
- artifact_refs
- normalized_output_ref

## StateDelta
- id
- task_id
- delta_json
- evidence_refs
- confidence
- review_status

## Claim
- id
- project_id
- claim_type
- normalized_value
- hash
- status
- current_state_version

## Evidence
- id
- project_id
- evidence_type
- locator
- created_at

---

# 30. Deployment Strategy

## Phase 1
Local desktop extension.
No backend requirement.
Private VSIX distribution.

## Phase 2
Optional local sidecar service for heavier indexing and provider adapters.

## Phase 3
Optional hosted sync/orchestration layer for teams and remote execution.

The first product should absolutely not require cloud infrastructure unless truly necessary.

---

# 31. Business Positioning

## What We Are Not
- not just another chat shell
- not just another coding agent
- not just another memory layer
- not just a better summarizer

## What We Are
A control plane for long-running AI software work.

The product creates trust in what the project currently believes and how that belief changes.

## Market Tension
Frontier labs already expose memory, branching, delegation, and compaction.
That means raw agent capability is increasingly commoditized.

Our opportunity is to productize:
- canonical state,
- evidence-backed merge,
- deterministic review,
- and project truth governance.

## Why This Can Matter
As AI coding workflows get deeper, the pain is not only generation quality. It is coordination quality, restartability, and trust in project state.

That is the layer we are trying to own.

---

# 32. Competitive Reality

## The Hard Truth
This idea is replicable at the pattern level.
Branching, memory, and summarization are not enough as a moat.

## The More Defensible Wedge
The strongest wedge is:
- governed project state,
- reviewed deltas,
- evidence-linked claims,
- drift detection,
- and provider-agnostic task control.

## Strategic Implication
We should not claim superiority because others lack compaction or subagents.
We should claim superiority if we create a better operating model for project truth.

---

# 33. Business Risks

## 33.1 Feature Absorption Risk
Incumbents may absorb parts of the concept into existing IDEs or agent products.

## 33.2 Workflow Friction Risk
If task creation and review feel bureaucratic, users will bypass the system.

## 33.3 False Canonical Confidence Risk
If the state appears authoritative but is stale or wrong, trust collapses.

## 33.4 UX Fragmentation Risk
Too many panels, states, or branches could make the product feel heavier than the problem.

## 33.5 Moat Ambiguity Risk
Without strong reconciliation, evidence, and trust UX, this collapses into a copyable wrapper.

---

# 34. Product Risks

## Over-branching
Too many tasks become overhead.

## State Pollution
Poorly reviewed deltas pollute canonical state.

## Summary Drift
Normalization misses important nuance.

## Provider Incoherence
Multiple provider runs create fragmented task outputs.

## Salience Misfire
Attention signals highlight the wrong content.

## Review Fatigue
Users stop reading deltas if review is too slow or too frequent.

---

# 35. Mitigations

- keep initial task templates simple,
- make review delta-first and fast,
- use event-driven reconciliation,
- separate workspaces from state strictly,
- keep durable memory manual,
- keep state typed and versioned,
- show provenance everywhere,
- and allow free exploration inside task chats.

---

# 36. Success Metrics

## Primary Metrics
- time to recover project context after cold open
- user-rated clarity of current project state
- successful task completions before user feels need to restart
- merge acceptance rate
- rate of stale/conflicting state detected before merge

## Secondary Metrics
- number of tasks per project
- review edit rate
- number of accepted state deltas per week
- frequency of manual context cleaning in alternative workflows
- reuse rate of accepted claims and known files

## Qualitative Signals
- “I know what the project currently believes.”
- “I can go deep without ruining the project context.”
- “I trust what gets merged back.”
- “I can switch providers without losing the plot.”

---

# 37. Recommended MVP Sequence

## Phase 0: Design Foundation
- type system
- task model
- canonical state model
- delta schema
- UI wireframes
- policy config

## Phase 1: Local Working Loop
- extension shell
- canonical state panel
- task list
- task creation
- task spec compiler
- basic provider run
- merge review
- delta application

## Phase 2: Real Provider Integrations
- Codex adapter
- Claude adapter
- task run artifact ingestion
- worktree handling

## Phase 3: Reconciliation
- scope checks
- stale base state checks
- test requirement checks
- diff-to-delta checks

## Phase 4: Salience-Guided State Synthesis
- task transcript parsing mode
- explicit salience signals
- claim extraction from top regions

## Phase 5: Graph + Retrieval Layer
- hashed claims
- evidence graph
- claim lineage
- semantic + graph retrieval

---

# 38. Open Questions

1. How much should task chat UX be provider-native versus extension-owned?
2. Should the first product use provider CLIs, SDKs, or existing IDE extensions?
3. How aggressive should automatic normalization be?
4. How much user intervention should salience parsing require?
5. What is the minimum viable reconciliation engine that already feels meaningful?
6. When does a task need a visible persistent node versus a lightweight ephemeral execution record?
7. How much of the claim graph should be explicit to the user?
8. What is the clearest user-facing language: state, truth, merge, claims, review, project memory?

---

# 39. Suggested Internal Product Language

## Preferred
- canonical state
- task workspace
- deterministic review
- proposed delta
- evidence
- state version
- drift/conflict
- durable memory

## Avoid Overusing
- AI OS
- autonomous swarm
- smart memory
- magic context

These can sound inflated or vague too early.

---

# 40. Product Summary in One Paragraph

We are building a control plane for long-running AI-assisted software work. The system keeps a versioned canonical project state separate from task-local chats and execution, lets users spin up scoped tasks with deterministic contracts, allows those tasks to use different providers for exploration or implementation, then normalizes outputs, reconciles them against code and policy reality, and prompts structured review before any state update becomes canonical. Over time, accepted claims are stored in a hashed, graph-linked project memory that makes the project legible, restartable, and governable.

---

# 41. Final Strategic Position

The product should not win by claiming smarter hidden memory than frontier labs.
It should win by making project state explicit, reviewed, evidence-backed, and durable across long-running work.

The most honest and strongest frame is:

**Frontier tools help the model keep going. We help the project keep its truth straight.**

---

# 42. Appendix: Early Build Heuristic

If we need to aggressively simplify, the first slice should be:
- one project,
- one canonical state object,
- one task list,
- one provider adapter,
- one output normalization path,
- one merge review screen,
- one delta application flow.

Everything else can be layered on top once that loop feels obviously better than plain chat.

