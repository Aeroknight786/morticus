# Phase 7B — Context Slicing v2 (MemCell-Aware) Implementation Plan

## Context

Phase 7A landed the MemCell foundation: domain types, BM25/RRF retrieval (`memory-retrieval.ts`), MemCell extraction (`memory-extractor.ts`), storage (`memcell-store.ts`), and basic wiring into `context-pack.ts` and `run-controller.ts`.

Currently, context-pack supplements flat memory entries with MemCell episodic summaries when available, but:
- `scoreKeywordRelevance()` is still the primary scoring path for flat `MemoryEntry` filtering
- `resolveContextProfile()` has no memory type preferences (episodic vs event)
- No temporal weighting — a MemCell from day 1 ranks equally with one from yesterday
- `resolveTaskSpec()` doesn't pass MemCells through to `buildContextPack()`
- `ContextManifest` doesn't report MemCell retrieval diagnostics (which MemCells were selected, scores, types)

This phase closes those gaps.

---

## 1. Key Files to Read Before Starting

| Priority | File | Why |
|---|---|---|
| 1 | `CLAUDE.md` | Architecture and conventions |
| 2 | `src/compiler/context-pack.ts` | Current `buildContextPack()`, `buildMemoryEntries()`, MemCell supplement logic |
| 3 | `src/domain/context-policy.ts` | `resolveContextProfile()`, `ContextManifest`, `MemorySlicePolicy`, `scoreKeywordRelevance()` |
| 4 | `src/compiler/spec-resolver.ts` | `resolveTaskSpec()` — maps profile → `ContextPackOptions`, calls `buildContextPack()` |
| 5 | `src/runtime/memory-retrieval.ts` | `retrieveMemCells()`, `scoreBM25()`, `rrfFusion()`, `tokenize()` |
| 6 | `src/domain/durable-memory.ts` | `MemCell`, `MemoryType`, `MemoryEntry` types |
| 7 | `src/domain/task-spec.ts` | `ContextPack`, `ContextPackOptions` interfaces |
| 8 | `src/runtime/chat-adapter.ts` | `sendChatTurn()` — uses `resolveContextProfile()` for chat surfaces |
| 9 | `src/runtime/scratchpad-adapter.ts` | Uses `resolveContextProfile('scratchpad')` |
| 10 | `test/unit/compiler/context-pack.test.ts` | Existing context-pack tests |
| 11 | `test/unit/domain/context-policy.test.ts` | Existing context-policy tests |

---

## 2. Implementation Steps (in order)

### Step 1: Extend MemorySlicePolicy with type preferences (~15 lines)

**`src/domain/context-policy.ts`** — add to `MemorySlicePolicy`:

```typescript
export interface MemorySlicePolicy {
  // ... existing fields ...

  // Preferred MemCell memory type for this surface.
  // 'episodic' = compact narrative summaries (good for broad context)
  // 'event' = atomic facts (good for precision queries)
  // null = fuse both via RRF (default)
  preferredMemoryType: MemoryType | null;

  // Maximum MemCell results to include alongside flat entries.
  maxMemCellResults: number;
}
```

Import `MemoryType` from `../domain/durable-memory.js` (already a sibling domain file — both are domain-pure).

### Step 2: Update resolveContextProfile with memory type defaults (~30 lines)

**`src/domain/context-policy.ts`** — update each case in `resolveContextProfile()`:

| Surface | Task Type | preferredMemoryType | maxMemCellResults | Rationale |
|---|---|---|---|---|
| `task_run` | `discovery` | `'episodic'` | 3 | Discovery needs narrative overview, not precision |
| `task_run` | `validation` | `'event'` | 5 | Validation needs precise facts and constraints |
| `task_run` | `implementation` | `null` (fused) | 5 | Implementation benefits from both |
| `chat_steering` | — | `'episodic'` | 3 | Strategic trunk needs summaries |
| `chat_kickoff` | — | `null` | 0 | No MemCell context needed for kickoff |
| `scratchpad` | — | `'episodic'` | 3 | Exploration benefits from narrative context |

### Step 3: Add temporal weighting to MemCell retrieval (~30 lines)

**`src/runtime/memory-retrieval.ts`** — add recency boost:

```typescript
export interface RetrievalOptions {
  // ... existing fields ...
  recencyBoostDays?: number;  // MemCells newer than this get a boost (default: 7)
}
```

In `retrieveMemCells()`, after BM25/RRF scoring, apply a recency multiplier:
- MemCells from the last `recencyBoostDays` days get a `1.2x` score multiplier
- MemCells from the last 1 day get a `1.5x` multiplier
- Older MemCells are unchanged (1.0x)

This is a simple post-score adjustment, not a separate ranking signal. Keep it deterministic.

### Step 4: Add MemCell diagnostics to ContextManifest (~20 lines)

**`src/domain/context-policy.ts`** — extend `ContextManifest`:

```typescript
export interface ContextManifest {
  // ... existing fields ...

  // MemCell retrieval diagnostics
  memCellsAvailable: number;          // total extracted MemCells passed in
  memCellsIncluded: number;           // how many made it into context
  memCellRetrievalType: MemoryType | 'fused' | null;  // which retrieval mode was used
  memCellTopScore: number | null;     // highest BM25/RRF score (for debugging)
}
```

### Step 5: Thread MemCells through resolveTaskSpec (~20 lines)

**`src/compiler/spec-resolver.ts`** — add `memCells` parameter:

```typescript
export function resolveTaskSpec(
  task: TaskNode,
  state: CanonicalProjectState,
  memory: DurableMemory,
  packOptions: Partial<ContextPackOptions> = {},
  memCells?: MemCell[],  // NEW
): TaskSpec {
  // ... existing profile resolution ...

  const contextPack = buildContextPack(state, memory, task, {
    ...profileOptions,
    ...packOptions,
  }, memCells);  // pass through

  // ...
}
```

Update callers:
- `src/ui/commands.ts` line ~154: load MemCells from `store.memcells.list()` and pass
- `src/ui/webviews/chat-panel.ts` line ~1136: same

### Step 6: Upgrade buildMemoryEntries to use profile type preferences (~40 lines)

**`src/compiler/context-pack.ts`** — update `buildMemoryEntries()`:

Currently the MemCell supplement block is hardcoded:
```typescript
if (memCells && memCells.length > 0 && taskGoal) {
  const results = retrieveMemCells(memCells, taskGoal, {
    topK: 5,
    memoryType: 'episodic',
  });
  // ...
}
```

Change to use resolved profile preferences:
```typescript
// Accept profile preferences as parameters
function buildMemoryEntries(
  memory: DurableMemory,
  opts: ContextPackOptions,
  memCells?: MemCell[],
  taskGoal?: string,
  memCellPreferences?: { preferredType: MemoryType | null; maxResults: number },
): MemoryBuildResult {
```

Use `memCellPreferences.preferredType` for `memoryType` and `memCellPreferences.maxResults` for `topK`.

Thread the preferences from `buildContextPack()` — resolve them from the profile's `memorySlice.preferredMemoryType` and `memorySlice.maxMemCellResults`.

### Step 7: Add ContextPackOptions fields for MemCell preferences (~10 lines)

**`src/domain/task-spec.ts`** — extend `ContextPackOptions`:

```typescript
export interface ContextPackOptions {
  // ... existing fields ...

  // Preferred MemCell memory type (null = fuse both via RRF)
  preferredMemCellType: MemoryType | null;
  // Maximum MemCell results to supplement flat entries
  maxMemCellResults: number;
}
```

Update `DEFAULT_OPTIONS` in `context-pack.ts`:
```typescript
preferredMemCellType: null,
maxMemCellResults: 5,
```

Update `spec-resolver.ts` profile mapping to include:
```typescript
preferredMemCellType: profile.memorySlice.preferredMemoryType,
maxMemCellResults: profile.memorySlice.maxMemCellResults,
```

### Step 8: Populate MemCell manifest fields (~15 lines)

**`src/compiler/context-pack.ts`** — in `buildContextPack()`, populate the new manifest fields:

```typescript
pack.contextManifest = {
  // ... existing fields ...
  memCellsAvailable: memCells?.filter(c => c.extracted).length ?? 0,
  memCellsIncluded: memCellsIncludedCount,   // track in buildMemoryEntries
  memCellRetrievalType: opts.preferredMemCellType ?? (memCellsIncludedCount > 0 ? 'fused' : null),
  memCellTopScore: memCellTopScore,           // track in buildMemoryEntries
};
```

Update `buildMemoryEntries` to return these counts alongside the existing `MemoryBuildResult`.

### Step 9: Update buildContextDiagnostics (~10 lines)

**`src/domain/context-policy.ts`** — in `buildContextDiagnostics()`, add MemCell lines:

```typescript
if (manifest.memCellsAvailable > 0) {
  lines.push(`  MemCells: ${manifest.memCellsIncluded}/${manifest.memCellsAvailable} included`);
  if (manifest.memCellRetrievalType) {
    lines.push(`    Retrieval: ${manifest.memCellRetrievalType}`);
  }
  if (manifest.memCellTopScore !== null) {
    lines.push(`    Top score: ${manifest.memCellTopScore.toFixed(3)}`);
  }
}
```

### Step 10: Update run-detail-panel diagnostics display (~10 lines)

**`src/ui/webviews/run-detail-panel.ts`** — the context diagnostics section already uses `buildContextDiagnostics()`. If any additional HTML formatting is needed for the new fields, update here. Likely no change needed since the diagnostics render as preformatted text.

### Step 11: Tests (~200 lines)

**`test/unit/domain/context-policy.test.ts`** — add tests for:
- `resolveContextProfile` returns `preferredMemoryType` and `maxMemCellResults` per surface/taskType
- `buildContextDiagnostics` includes MemCell lines when `memCellsAvailable > 0`
- `buildContextDiagnostics` omits MemCell lines when `memCellsAvailable === 0`

**`test/unit/compiler/context-pack.test.ts`** — add tests for:
- `buildContextPack` with MemCells populates manifest MemCell fields
- `buildContextPack` with `preferredMemCellType: 'episodic'` only includes episodic summaries
- `buildContextPack` with `preferredMemCellType: 'event'` only includes event content
- `buildContextPack` with `preferredMemCellType: null` uses RRF fusion
- `buildContextPack` with no MemCells sets `memCellsAvailable: 0`
- `buildContextPack` respects `maxMemCellResults` limit
- MemCell supplement text appears in stablePrefix

**`test/unit/compiler/spec-resolver.test.ts`** — add tests for:
- `resolveTaskSpec` with MemCells parameter threads them to context pack
- `resolveTaskSpec` without MemCells works unchanged (backward compat)

**`test/unit/runtime/memory-retrieval.test.ts`** — add tests for:
- `retrieveMemCells` with `recencyBoostDays` boosts recent cells
- `retrieveMemCells` without recency option works unchanged

---

## 3. What NOT to Do

- Do NOT replace `scoreKeywordRelevance()` entirely — it's still used for flat `MemoryEntry` filtering when no MemCells exist. Keep it as the fallback path.
- Do NOT change the existing category-based filtering logic (`includeCategories`, `excludeCategories`). That still operates on flat entries.
- Do NOT add vector embeddings or cosine similarity
- Do NOT change the trimming priority order (knownFiles → phaseExitCriteria → risks → decisions → memory)
- Do NOT modify `memory-extractor.ts` or `memcell-store.ts` — those are Phase 7A complete
- Do NOT add new UI panels or commands
- Do NOT change the chat-adapter or scratchpad-adapter MemCell integration — they don't use `buildContextPack()` directly. Their memory limiting works differently (sliding window, entry count). MemCell awareness for chat/scratchpad is a future enhancement.
- Domain types must stay pure (no VS Code or Node imports)

---

## 4. Verification

```bash
npm run lint   # clean
npm test       # all existing 494 tests pass + new tests pass
npm run build  # clean
```

---

## 5. Estimated Scope

| Component | ~Lines |
|---|---|
| MemorySlicePolicy extension | 15 |
| Profile resolver updates | 30 |
| Temporal weighting in retrieval | 30 |
| ContextManifest extension | 20 |
| Thread MemCells through spec-resolver + callers | 20 |
| buildMemoryEntries upgrade | 40 |
| ContextPackOptions extension | 10 |
| Manifest population | 15 |
| Diagnostics update | 10 |
| Run-detail-panel (minor) | 10 |
| Tests | 200 |
| **Total** | **~400** |

Plus modifications to existing files: `context-policy.ts`, `context-pack.ts`, `task-spec.ts`, `spec-resolver.ts`, `memory-retrieval.ts`, `commands.ts`, `chat-panel.ts`, `run-detail-panel.ts`.
