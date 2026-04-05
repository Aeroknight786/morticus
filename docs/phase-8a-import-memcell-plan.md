# Phase 8A — Transcript Import (MemCell-Native, JSONL-First)

## Context

Morticus now has: MemCell foundation (7A), MemCell-aware context slicing (7B), multi-provider LLM support with Codex CLI (7C), strategic chat, checkpoint + resume, scratchpad v1 (546 tests, ~311KB bundle). The biggest onboarding friction is that users with existing Claude/ChatGPT/Cursor work must start from scratch. Phase 8A lets them import prior transcripts into Morticus's structured model.

**Primary import path**: Claude CLI JSONL files (`~/.claude/projects/<hash>/<id>.jsonl`). These have explicit roles, structured messages, and timestamps — no heuristic parsing needed. Markdown and text formats are secondary.

**MemCell-native**: Imported transcript chunks become MemCells via the existing `memory-extractor.ts` pipeline. No separate extraction path — import reuses the same single-LLM-call extraction that task completion uses.

**LLM provider**: All LLM calls use `runLlm()` from `llm-provider.ts`, which dispatches to the configured provider (Codex CLI default, Claude CLI also supported).

**Design principle**: Import never auto-applies. Everything goes through review.

---

## 1. What Already Exists (from prior partial work)

| File | Status | What's there |
|---|---|---|
| `src/domain/import.ts` | ✅ Complete | All types: `ImportSourceType`, `ArchiveRecord`, `ImportChunk`, etc. |
| `src/domain/ids.ts` | ✅ Complete | `ArchiveId` branded type + generator |
| `src/domain/errors.ts` | ✅ Complete | `IMPORT_PARSE_ERROR`, `IMPORT_EXTRACTION_ERROR` |
| `src/runtime/transcript-parser.ts` | ⚠️ Partial | 3 parsers + auto-detect. **Missing**: `parseClaudeCliJsonl()`, `'claude_cli_jsonl'` format |
| `src/runtime/import-extractor.ts` | ⚠️ Needs revision | Uses `runLlm()` ✅ but produces `DraftMemoryEntry[]` — needs to also produce MemCells |
| `src/runtime/import-conflict-detector.ts` | ✅ Complete | Compares extraction vs existing state |
| `src/storage/archive-store.ts` | ✅ Complete | `save()`, `get()`, `list()`, `saveRawContent()`, `getRawContent()` |
| `src/ui/webviews/import-panel.ts` | ⚠️ Exists | Multi-step wizard, but needs MemCell integration |
| `src/ui/commands.ts` | ⚠️ Partial | Import command may need wiring |
| `test/unit/runtime/transcript-parser.test.ts` | ⚠️ Partial | Tests for 3 parsers. Needs JSONL parser tests |
| `test/unit/domain/import.test.ts` | ✅ Complete | Factory function tests |
| `src/runtime/memory-extractor.ts` | ✅ Complete | `extractMemCell()`, `createAndExtractMemCell()`, `shouldForceSplit()` |
| `src/runtime/memory-retrieval.ts` | ✅ Complete | BM25 + RRF retrieval with recency boost |
| `src/storage/memcell-store.ts` | ✅ Complete | `save()`, `get()`, `list()`, `listBySource()` |

---

## 2. What Must Be Built / Changed

### 2.1 Add Claude CLI JSONL Parser (~80 lines)

**File**: `src/runtime/transcript-parser.ts`

**`ImportSourceType` extension** in `src/domain/import.ts`:
```typescript
// Add 'claude_cli_jsonl' to the union
export type ImportSourceType = 'markdown_transcript' | 'text_chat_dump' | 'planning_doc' | 'claude_cli_jsonl';
```

**`detectImportFormat` extension**:
- If file extension is `.jsonl` OR first non-empty line parses as JSON with a `type` field → `'claude_cli_jsonl'`
- This check runs BEFORE the existing markdown/text heuristics

**`parseClaudeCliJsonl(content: string): TranscriptChunk[]`**:

Claude CLI JSONL entry shapes:
```jsonl
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]},"uuid":"...","timestamp":"..."}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."},{"type":"tool_use","id":"...","name":"Read","input":{...}}]},...}
{"type":"tool","content":[{"type":"tool_result","tool_use_id":"...","content":"..."}],...}
{"type":"system","subtype":"init","cwd":"...","tools":[...],...}
```

Parsing rules:
- `type === 'system'` → skip (metadata only)
- `type === 'tool'` → skip (tool results are noise for extraction)
- `type === 'user' | 'assistant'` → extract text blocks from `message.content[]`
  - `{"type":"text","text":"..."}` → include text as-is
  - `{"type":"tool_use","name":"..."}` → compress to `[tool: <name>]`
  - All other content block types → skip
- Output one `TranscriptChunk` per user/assistant entry
- Preserve `timestamp` if available (useful for MemCell boundary detection)

**Wire into `parseImportSource()`**: Add `case 'claude_cli_jsonl': return parseClaudeCliJsonl(content);`

### 2.2 Make Import Extraction MemCell-Native (~60 lines changed)

**File**: `src/runtime/import-extractor.ts`

The current extractor produces `DraftMemoryEntry[]` (flat memory entries). The revised version should ALSO produce MemCells.

**Strategy**: After the existing extraction pass (which produces `draftState`, `candidateMemory`, `candidateTasks`), group the transcript chunks into MemCell-sized windows and run each through `extractMemCell()` from `memory-extractor.ts`.

**New function**: `extractImportMemCells(chunks: TranscriptChunk[], source: string): Promise<MemCell[]>`

```typescript
import { createAndExtractMemCell } from './memory-extractor.js';
import { shouldForceSplit } from './memory-extractor.js';

// Groups consecutive chunks into MemCell-sized windows based on force-split thresholds.
// Each window becomes one MemCell via the standard extraction pipeline.
async function extractImportMemCells(
  chunks: TranscriptChunk[],
  source: string,
): Promise<MemCell[]> {
  const windows = groupChunksIntoWindows(chunks); // split at 8192 token / 50 message boundaries
  const cells: MemCell[] = [];
  for (const window of windows) {
    const rawContent = window.map(c => `[${c.role}]: ${c.content}`).join('\n');
    const cell = await createAndExtractMemCell(source, 'task_completed', rawContent, rawContent.length / 4);
    if (cell) cells.push(cell);
  }
  return cells;
}
```

**Extend `ImportExtractionResult`** in `src/domain/import.ts`:
```typescript
export interface ImportExtractionResult {
  // ... existing fields ...
  memCellIds: MemCellId[];  // IDs of MemCells created during extraction
}
```

**Extend `extractFromTranscript()`**: After the existing extraction, call `extractImportMemCells()` for transcript-type chunks. Store resulting MemCells via `memcellStore.save()`. Return their IDs in the result.

### 2.3 Update ArchiveRecord for MemCell Tracking (~5 lines)

**File**: `src/domain/import.ts`

Add to `AcceptedItemRef`:
```typescript
export interface AcceptedItemRef {
  type: 'state' | 'memory' | 'task' | 'memcell';  // add 'memcell'
  label: string;
  acceptedAt: string;
}
```

### 2.4 Update Import Panel for MemCells (~30 lines)

**File**: `src/ui/webviews/import-panel.ts`

After extraction, show a new section: **"Extracted Memory Cells"** — list of MemCells with episodic summary and event count. Each has an Accept/Dismiss toggle (accepted MemCells get `extracted: true` and are persisted; dismissed ones are deleted from memcell store).

### 2.5 Wire Import Command (~15 lines)

**File**: `src/ui/commands.ts`

Ensure `morticus.importTranscript` command is registered:
1. Open file picker filtered to `.md`, `.txt`, `.jsonl`
2. Read file content
3. Open ImportPanel with content

**File**: `package.json`

Ensure command declaration exists in `contributes.commands`.

### 2.6 Add JSONL Parser Tests (~80 lines)

**File**: `test/unit/runtime/transcript-parser.test.ts`

New `describe('parseClaudeCliJsonl')` block:
- Parses user messages with text content
- Parses assistant messages, extracts text blocks
- Compresses tool_use blocks to `[tool: <name>]`
- Skips system entries
- Skips tool result entries
- Handles malformed JSON lines (skip with warning)
- Handles empty content arrays
- Handles mixed content types (text + tool_use)
- Preserves message ordering

New `describe('detectImportFormat')` additions:
- Detects `.jsonl` content as `'claude_cli_jsonl'`
- Detects JSON-per-line with `type` field as JSONL even without extension hint

### 2.7 Add Import MemCell Extraction Tests (~60 lines)

**File**: `test/unit/runtime/import-extractor.test.ts`

- `extractImportMemCells` groups chunks into windows by token threshold
- `extractImportMemCells` produces one MemCell per window
- `extractFromTranscript` returns `memCellIds` in result
- Integration: full pipeline from JSONL parse → extraction → MemCells

### 2.8 Schema Migration (~10 lines)

**File**: `src/storage/migrator.ts`

If `sourceArchiveId` on `MemoryEntry` was not added in a prior migration, add a migration step. Check current schema version — if v4 already handles `memCellId`, this may need v4→v5 for `sourceArchiveId: null` backfill on existing memory entries.

---

## 3. Implementation Order

| Step | What | Depends on | ~Lines |
|---|---|---|---|
| 1 | Add `'claude_cli_jsonl'` to `ImportSourceType` | None | 3 |
| 2 | Add `parseClaudeCliJsonl()` to `transcript-parser.ts` + update `detectImportFormat` and `parseImportSource` | Step 1 | 80 |
| 3 | Add JSONL parser tests | Step 2 | 80 |
| 4 | Add `memCellIds` to `ImportExtractionResult`, `'memcell'` to `AcceptedItemRef.type` | None | 5 |
| 5 | Add `extractImportMemCells()` to `import-extractor.ts` + wire into `extractFromTranscript()` | Steps 2, 4 | 60 |
| 6 | Add import MemCell extraction tests | Step 5 | 60 |
| 7 | Update ImportPanel with MemCell section | Steps 4, 5 | 30 |
| 8 | Wire import command in `commands.ts` + `package.json` (if not already done) | Step 7 | 15 |
| 9 | Schema migration for `sourceArchiveId` if needed | None | 10 |
| 10 | Verify: `npm run lint && npm test && npm run build` | All | 0 |

**Estimated total: ~340 new/changed lines across 8 files.**

---

## 4. Import UX Flow

### Step 1 — Initiate
User runs `Morticus: Import Transcript` from command palette. File picker opens, filtered to `.md`, `.txt`, `.jsonl`.

### Step 2 — Parse & Preview
ImportPanel opens. File is read, format auto-detected (JSONL preferred), deterministic parsing produces chunks. Panel shows:
- Source info: filename, format, line count, estimated tokens, turn count
- Scrollable chunk preview (collapsed by default)
- **"Extract Project Data"** button

### Step 3 — Extraction (via `runLlm`)
User clicks Extract. Two extraction passes run (both via `runLlm()` — Codex or Claude per user setting):

**Pass A — Project data extraction** (existing `extractFromTranscript`):
- Produces `draftState`, `candidateMemory`, `candidateTasks`, `summary`
- Uses bookend strategy for large transcripts (first+last chunks, then middle)

**Pass B — MemCell extraction** (new `extractImportMemCells`):
- Groups chunks into windows (≤8192 tokens or ≤50 messages each)
- Each window → one `createAndExtractMemCell()` call
- Produces episodic summaries + atomic event facts per window

### Step 4 — Review Results
Panel shows four reviewable sections:

1. **Draft State** — Fields with conflict highlighting if project has existing state
2. **Candidate Memory** — Legacy flat entries with Accept/Dismiss (deduped against existing)
3. **Candidate Tasks** — Draft tasks with Accept/Dismiss
4. **Extracted MemCells** — Episodic summaries + event counts with Accept/Dismiss

### Step 5 — Apply Selected
- State fields → ReviewPanel (delta) or direct accept (pre-kickoff)
- Memory entries → `store.memory.addEntry()` with `origin: 'imported'`, `sourceArchiveId`
- Tasks → `chatPanel.injectDraftTask()` as draft cards
- MemCells → accepted ones kept in memcell store; dismissed ones deleted

### Step 6 — Completion
Archive record → `completed`. Chat receives system message.

---

## 5. Claude CLI JSONL Details

### Location
`~/.claude/projects/<hash>/<id>.jsonl` — each file is one conversation.

### Entry types
| `type` field | Action |
|---|---|
| `system` | Skip — contains init metadata (cwd, tools, model) |
| `user` | Parse → `TranscriptChunk` with `role: 'user'` |
| `assistant` | Parse → `TranscriptChunk` with `role: 'assistant'` |
| `tool` | Skip — tool results are noise |

### Content block handling
Assistant messages have `content: Array<{type, ...}>`:
- `{"type":"text","text":"..."}` → include text
- `{"type":"tool_use","name":"Read","input":{...}}` → compress to `[tool: Read]`
- `{"type":"thinking","text":"..."}` → skip (internal reasoning)

### Why JSONL is better than markdown
- Roles are typed fields, not regex-matched strings
- No ambiguous preambles or mixed formats
- Timestamps available for ordering and MemCell boundary detection
- Tool use is structured (can skip or compress selectively)
- No false-positive role detection in code blocks

---

## 6. What NOT to Do

- Do NOT create a separate extraction pipeline for imports — reuse `memory-extractor.ts`
- Do NOT auto-apply anything — all imports go through review
- Do NOT remove the existing markdown/text parsers — they're secondary paths
- Do NOT add vector/embedding infrastructure — BM25+RRF is sufficient
- Do NOT add multi-file batch import — one file at a time
- Do NOT add import from URLs or APIs — file-based only
- Do NOT change prompt formats per provider — both CLIs accept the same prompt
- Domain types must stay pure (no VS Code imports)

---

## 7. Verification

```bash
npm run lint   # clean
npm test       # all 546+ tests pass + new tests
npm run build  # clean, bundle size ≤ 320KB
```

### Manual E2E

1. Export a Claude CLI conversation to `.jsonl` (or find one in `~/.claude/projects/`)
2. Run `Morticus: Import Transcript` → select the `.jsonl` file
3. ImportPanel shows: detected format `claude_cli_jsonl`, chunk count, turn count
4. Click "Extract Project Data"
5. Review: draft state, memory entries, tasks, **MemCells with episodic summaries**
6. Accept some items, dismiss others
7. Verify accepted MemCells appear in memory retrieval
8. Verify archive record persisted at `.morticus/archive/<id>/`
9. Switch provider setting between Codex and Claude — both should work

---

## 8. Key Files to Read Before Starting

| Priority | File | Why |
|---|---|---|
| 1 | `CLAUDE.md` | Architecture and conventions |
| 2 | `src/runtime/transcript-parser.ts` | Existing parsers — add JSONL parser here |
| 3 | `src/runtime/import-extractor.ts` | Current extraction — extend with MemCell production |
| 4 | `src/runtime/memory-extractor.ts` | MemCell extraction pipeline to reuse |
| 5 | `src/domain/import.ts` | Domain types — extend `ImportSourceType`, `ImportExtractionResult` |
| 6 | `src/runtime/llm-provider.ts` | `runLlm()` dispatch — already used by import-extractor |
| 7 | `src/storage/memcell-store.ts` | Where extracted MemCells are persisted |
| 8 | `src/ui/webviews/import-panel.ts` | UI wizard — add MemCell section |
| 9 | `src/ui/commands.ts` | Command wiring |
| 10 | `test/unit/runtime/transcript-parser.test.ts` | Existing parser tests — add JSONL tests |
