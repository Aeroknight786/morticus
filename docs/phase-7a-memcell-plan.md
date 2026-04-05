# Phase 7A — MemCell Foundation Implementation Plan

## Context

Morticus is a VS Code extension for long-running AI-assisted software work. It maintains canonical project state, compiles task specs, and gates state mutation behind reviewed deltas. Read `CLAUDE.md` for full architecture and conventions.

The MemCell is Morticus's atomic memory unit, inspired by EverMemOS (Apache 2.0). This is the architectural foundation that import, context slicing, archive, and retrieval all build on.

A MemCell is a **bounded unit of interaction** — a coherent chunk of conversation or work, created at natural boundaries (task completion, review acceptance, chat topic shift) or force-split thresholds (8192 tokens / 50 messages). From each MemCell, a single LLM call extracts:
- **Episodic summary**: Compact narrative of what happened
- **Event entries**: Atomic facts — individual decisions, constraints, conventions (maps to existing `MemoryEntry`)

---

## 1. Key Files to Read Before Starting

| Priority | File | Why |
|---|---|---|
| 1 | `CLAUDE.md` | Architecture, conventions, hard rules |
| 2 | `src/domain/durable-memory.ts` | Current `MemoryEntry`, `MemoryOrigin`, `MemoryCategory` types |
| 3 | `src/domain/ids.ts` | Branded ID pattern — use for `MemCellId` |
| 4 | `src/review/knowledge-extractor.ts` | Current single-pass extraction from task runs (this pattern gets replaced) |
| 5 | `src/compiler/context-pack.ts` | Current `buildMemoryEntries()` with `scoreKeywordRelevance()` (scoring gets replaced by BM25/RRF) |
| 6 | `src/runtime/claude-adapter.ts` | `runClaude()` for LLM calls |
| 7 | `src/runtime/run-controller.ts` | Task completion flow — where MemCell creation hooks in |
| 8 | `src/storage/store.ts` | `ProjectStore` facade, sub-store wiring pattern |
| 9 | `src/storage/memory-store.ts` | Sub-store implementation pattern to follow |
| 10 | `roadmap.md` | Phase 7A section — full rationale |

---

## 2. Implementation Steps (in order)

### Step 1: Domain Types (~60 lines)

**`src/domain/durable-memory.ts`** — extend with:

```typescript
export type MemCellId = string & { readonly __brand: 'MemCellId' };

export type MemoryType = 'episodic' | 'event';

export type BoundaryReason =
  | 'task_completed'
  | 'review_accepted'
  | 'force_split'
  | 'topic_shift'
  | 'scratchpad_exit'
  | 'import_chunk';

export interface MemCell {
  id: MemCellId;
  source: string;                     // e.g. "task:task_abc", "chat:session_xyz", "import:arch_123"
  boundaryReason: BoundaryReason;
  timestamp: string;                  // ISO 8601
  tokenCount: number;
  rawContent: string;                 // the interaction text that was chunked
  episodicSummary: string | null;     // filled by extraction
  events: string[];                   // atomic facts, filled by extraction
  relatedDecisionIds: string[];       // links to canonical state decisions
  relatedTaskIds: string[];           // links to tasks
  extracted: boolean;                 // false until LLM extraction runs
  createdAt: string;
  updatedAt: string;
}

export function createMemCell(
  id: MemCellId,
  source: string,
  boundaryReason: BoundaryReason,
  rawContent: string,
  tokenCount: number
): MemCell;
```

Add `memCellId: MemCellId | null` to existing `MemoryEntry` interface.

**`src/domain/ids.ts`** — add:
```typescript
export type MemCellId = string & { readonly __brand: 'MemCellId' };
export function generateMemCellId(): MemCellId { return makeId('mc') as MemCellId; }
```

### Step 2: MemCell Storage (~70 lines)

**`src/storage/memcell-store.ts`** — NEW sub-store following the pattern in existing sub-stores:

```typescript
export class MemCellStore {
  save(cell: MemCell): Promise<void>;           // write to .morticus/memcells/<id>.json
  get(id: MemCellId): Promise<MemCell | null>;
  list(): Promise<MemCell[]>;                   // all cells, sorted by timestamp desc
  listBySource(sourcePrefix: string): Promise<MemCell[]>;  // e.g. "task:" prefix
  update(id: MemCellId, patch: Partial<MemCell>): Promise<void>;
}
```

Storage path: `.morticus/memcells/<id>.json`

Wire into `ProjectStore` in `src/storage/store.ts` as `memcells: MemCellStore`.

### Step 3: BM25 + RRF Retrieval (~100 lines)

**`src/runtime/memory-retrieval.ts`** — NEW, pure TypeScript, no LLM calls:

```typescript
// Tokenizer
export function tokenize(text: string): string[];
// Lowercase, split on non-alphanumeric, remove stopwords (~30 common English words)

// BM25 index
export interface BM25Index { /* internal */ }
export function buildBM25Index(documents: Array<{ id: string; text: string }>): BM25Index;
export function scoreBM25(index: BM25Index, query: string, topK: number): Array<{ id: string; score: number }>;
// Standard BM25Okapi: k1=1.5, b=0.75

// Reciprocal Rank Fusion (from EverMemOS, Apache 2.0)
export function rrfFusion(
  ...rankedLists: Array<Array<{ id: string; score: number }>>
): Array<{ id: string; score: number }>;
// Formula: score += 1/(k + rank) per list, k=60

// Combined retrieval over MemCells
export function retrieveMemCells(
  cells: MemCell[],
  query: string,
  options?: { topK?: number; memoryType?: MemoryType; minScore?: number }
): Array<{ cell: MemCell; score: number }>;
// Builds BM25 index from episodicSummary + events text, scores, returns ranked
```

### Step 4: MemCell Extraction (~150 lines)

**`src/runtime/memory-extractor.ts`** — NEW, replaces the pattern in `knowledge-extractor.ts`:

```typescript
export interface MemCellExtractionResult {
  episodicSummary: string;
  events: string[];
  relatedDecisionIds: string[];
}

export async function extractMemCell(
  rawContent: string,
  projectContext: { goal: string; phase: string; decisions: string[] },
  config: { claudePath: string; model?: string }
): Promise<MemCellExtractionResult>;

export function shouldForceSplit(tokenCount: number, messageCount: number): boolean;
// Thresholds: 8192 tokens, 50 messages

export async function createAndExtractMemCell(
  source: string,
  boundaryReason: BoundaryReason,
  rawContent: string,
  projectContext: { goal: string; phase: string; decisions: string[] },
  config: { claudePath: string; model?: string }
): Promise<MemCell>;
```

**Extraction prompt** (single LLM call via `runClaude()`, produces both episodic + events):

```
You are extracting structured memory from a chunk of project interaction.

Project context:
- Goal: {goal}
- Phase: {phase}
- Existing decisions: {decisions}

Interaction content:
{rawContent}

Extract:
1. An episodic summary (2-4 sentences, third person, factual narrative of what happened)
2. Atomic event facts (each a single coherent unit — one decision, one constraint, one convention)

Rules:
- Extract ONLY what IS present — do not invent
- Each atomic fact must state WHO decided/said/did WHAT
- Resolve relative references ("this file", "the function") to specific names where possible
- Filter out greetings, acknowledgments, and phatic communication
- If a fact matches an existing decision, note the decision text

Output between markers:
---MEMCELL-EXTRACT-START---
{
  "episodicSummary": "...",
  "events": ["...", "..."],
  "relatedDecisions": ["exact text of matching decisions"]
}
---MEMCELL-EXTRACT-END---
```

Parse with marker extraction (same pattern as `chat-adapter.ts` marker parsing).

### Step 5: Wiring (~60 lines)

**`src/runtime/run-controller.ts`** — on task completion:
- After a task run completes (status → `awaiting_review` or `merged`), create a MemCell from the run's output/transcript
- `source: "task:<taskId>"`, `boundaryReason: 'task_completed'`
- Run extraction, persist MemCell via `store.memcells.save()`
- Generated `MemoryEntry` objects from events get `memCellId` set

**`src/compiler/context-pack.ts`** — integrate BM25/RRF:
- In `buildMemoryEntries()`, when MemCells are available, use `retrieveMemCells()` from `memory-retrieval.ts` instead of `scoreKeywordRelevance()`
- Episodic summaries preferred for task runs (compact context)
- Event entries preferred for precision queries (specific facts)
- Fall back to existing `scoreKeywordRelevance` when no MemCells exist (backward compatibility)

### Step 6: Schema Migration

**`src/storage/migrator.ts`** — add next version migration (check current version number):
- Add `memCellId: null` to all existing `MemoryEntry` objects
- Create `.morticus/memcells/` directory if it doesn't exist

### Step 7: Tests (~300 lines)

| Test File | What |
|---|---|
| `test/unit/domain/memcell.test.ts` | MemCell type construction, `createMemCell()` factory, boundary reasons |
| `test/unit/runtime/memory-retrieval.test.ts` | `tokenize()`, BM25 scoring, RRF fusion, `retrieveMemCells()` combined retrieval |
| `test/unit/runtime/memory-extractor.test.ts` | Extraction prompt marker parsing (mock Claude), `shouldForceSplit()` thresholds |
| `test/unit/storage/memcell-store.test.ts` | CRUD operations, `list()` ordering, `listBySource()` prefix filtering |

### Step 8: Attribution

Create `THIRD_PARTY_NOTICES.md` in project root (if it doesn't exist):

```
EverMemOS — https://github.com/EverMind-AI/EverMemOS
Copyright EverMind AI
Licensed under Apache License 2.0
Adapted: MemCell boundary detection, RRF fusion algorithm, memory extraction prompt patterns
```

---

## 3. What NOT to Do

- Do NOT add MongoDB, Elasticsearch, Milvus, Redis, or any external infrastructure
- Do NOT add vector embeddings or cosine similarity (BM25 keyword retrieval only for v1)
- Do NOT add foresight or profile extraction (canonical state handles those roles)
- Do NOT break existing `MemoryEntry` consumers — `memCellId: null` is backward compatible
- Do NOT remove `knowledge-extractor.ts` yet — wire the new path alongside it
- Do NOT modify import pipeline files (`transcript-parser.ts`, `import.ts`, etc.) — Phase 8A will consume MemCells later
- Do NOT add UI changes, new commands, or new panels
- Domain types must stay pure (no VS Code or Node imports)
- All file I/O through `src/storage/json-backend.ts`

---

## 4. Verification

```bash
npm run lint   # clean
npm test       # all existing tests pass + new tests pass
npm run build  # clean bundle
```

---

## 5. Estimated Scope

| Component | ~Lines |
|---|---|
| Domain types | 60 |
| MemCell storage | 70 |
| BM25 + RRF retrieval | 100 |
| MemCell extraction | 150 |
| Wiring (run-controller, context-pack) | 60 |
| Schema migration | 15 |
| Tests | 300 |
| **Total** | **~755** |

Plus modifications to existing files: `durable-memory.ts`, `ids.ts`, `run-controller.ts`, `context-pack.ts`, `store.ts`, `migrator.ts`.
