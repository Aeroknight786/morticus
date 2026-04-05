import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LlmRunResult } from '../../../src/runtime/llm-provider.js';
import type { DraftCanonicalState } from '../../../src/domain/chat.js';
import type { ParsedImportExtraction } from '../../../src/runtime/import-extractor.js';
import type { MemCell } from '../../../src/domain/durable-memory.js';
import type { MemCellId } from '../../../src/domain/ids.js';
vi.mock('../../../src/runtime/llm-provider.js', () => ({
  runLlm: vi.fn(),
}));

vi.mock('../../../src/runtime/memory-extractor.js', () => ({
  createAndExtractMemCell: vi.fn(),
  shouldForceSplit: vi.fn((tokens: number, messages: number) => tokens >= 8192 || messages >= 50),
}));

import * as llmProvider from '../../../src/runtime/llm-provider.js';
import * as memoryExtractor from '../../../src/runtime/memory-extractor.js';
import {
  parseExtractionResponse,
  selectChunksForExtraction,
  mergeExtractionResults,
  extractFromTranscript,
  groupChunksIntoWindows,
  extractImportMemCells,
} from '../../../src/runtime/import-extractor.js';
import type { ImportChunk, TranscriptChunk, DocSection } from '../../../src/domain/import.js';

const mockRunLlm = vi.mocked(llmProvider.runLlm);
const mockCreateAndExtractMemCell = vi.mocked(memoryExtractor.createAndExtractMemCell);

function wrapExtraction(payload: Record<string, unknown>): string {
  return `---MORTICUS-IMPORT-START---
${JSON.stringify(payload, null, 2)}
---MORTICUS-IMPORT-END---`;
}

function makeLlmResult(stdout: string): LlmRunResult {
  return {
    stdout,
    exitCode: 0,
    timedOut: false,
  };
}

function makeChunk(index: number, contentLength: number): TranscriptChunk {
  return {
    kind: 'transcript',
    index,
    startLine: index * 10 + 1,
    endLine: (index + 1) * 10,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: 'x'.repeat(contentLength),
  };
}

// ── parseExtractionResponse ──

describe('parseExtractionResponse', () => {
  it('parses a well-formed response with markers', () => {
    const response = `Here is the extraction:
---MORTICUS-IMPORT-START---
{
  "draftState": {
    "goal": "Build an auth system",
    "phase": "implementation",
    "constraints": ["No external deps"],
    "decisions": ["Use JWT tokens"],
    "risks": [],
    "knownFiles": ["src/auth.ts"],
    "nextStep": "Implement login endpoint"
  },
  "candidateMemory": [
    { "category": "architecture_invariant", "title": "JWT for auth", "content": "Use JWT tokens for authentication" }
  ],
  "candidateTasks": [
    { "title": "Add login", "goal": "Implement login endpoint", "taskType": "implementation", "scopePaths": ["src/auth/"] }
  ],
  "summary": "Found auth system project with JWT decision."
}
---MORTICUS-IMPORT-END---`;

    const result = parseExtractionResponse(response);

    expect(result.draftState).not.toBeNull();
    expect(result.draftState!.goal).toBe('Build an auth system');
    expect(result.draftState!.phase).toBe('implementation');
    expect(result.draftState!.constraints).toEqual(['No external deps']);
    expect(result.draftState!.decisions).toEqual(['Use JWT tokens']);
    expect(result.draftState!.knownFiles).toEqual(['src/auth.ts']);
    expect(result.draftState!.nextStep).toBe('Implement login endpoint');
    expect(result.candidateMemory).toHaveLength(1);
    expect(result.candidateMemory[0].title).toBe('JWT for auth');
    expect(result.candidateTasks).toHaveLength(1);
    expect(result.candidateTasks[0].title).toBe('Add login');
    expect(result.candidateTasks[0].taskType).toBe('implementation');
    expect(result.summary).toBe('Found auth system project with JWT decision.');
  });

  it('handles response without markers by finding JSON block', () => {
    const response = `I found the following:
{
  "draftState": { "goal": "Build MVP" },
  "candidateMemory": [],
  "candidateTasks": [],
  "summary": "Simple project."
}`;

    const result = parseExtractionResponse(response);

    expect(result.draftState).not.toBeNull();
    expect(result.draftState!.goal).toBe('Build MVP');
    expect(result.summary).toBe('Simple project.');
  });

  it('returns empty result for completely unparseable response', () => {
    const result = parseExtractionResponse('Just some random text with no JSON at all.');

    expect(result.draftState).toBeNull();
    expect(result.candidateMemory).toEqual([]);
    expect(result.candidateTasks).toEqual([]);
    expect(result.summary).toBe('');
  });

  it('returns empty result for malformed JSON between markers', () => {
    const response = `---MORTICUS-IMPORT-START---
{ this is not valid json }
---MORTICUS-IMPORT-END---`;

    const result = parseExtractionResponse(response);

    expect(result.draftState).toBeNull();
    expect(result.candidateMemory).toEqual([]);
  });

  it('handles null draftState fields', () => {
    const response = `---MORTICUS-IMPORT-START---
{
  "draftState": { "goal": null, "phase": null },
  "candidateMemory": [],
  "candidateTasks": [],
  "summary": ""
}
---MORTICUS-IMPORT-END---`;

    const result = parseExtractionResponse(response);

    // sanitizeDraftState skips null values → empty draft → null
    expect(result.draftState).toBeNull();
  });

  it('filters out invalid memory entries', () => {
    const response = `---MORTICUS-IMPORT-START---
{
  "draftState": null,
  "candidateMemory": [
    { "category": "coding_standard", "title": "Valid", "content": "Good content" },
    { "category": "custom", "title": "", "content": "No title" },
    { "title": "No content" },
    null
  ],
  "candidateTasks": [],
  "summary": "test"
}
---MORTICUS-IMPORT-END---`;

    const result = parseExtractionResponse(response);

    expect(result.candidateMemory).toHaveLength(1);
    expect(result.candidateMemory[0].title).toBe('Valid');
  });

  it('filters out invalid tasks', () => {
    const response = `---MORTICUS-IMPORT-START---
{
  "draftState": null,
  "candidateMemory": [],
  "candidateTasks": [
    { "title": "Valid Task", "goal": "Do something", "taskType": "discovery", "scopePaths": [] },
    { "title": "", "goal": "No title" },
    { "title": "No goal" },
    null
  ],
  "summary": "test"
}
---MORTICUS-IMPORT-END---`;

    const result = parseExtractionResponse(response);

    expect(result.candidateTasks).toHaveLength(1);
    expect(result.candidateTasks[0].title).toBe('Valid Task');
  });

  it('defaults invalid taskType to discovery', () => {
    const response = `---MORTICUS-IMPORT-START---
{
  "draftState": null,
  "candidateMemory": [],
  "candidateTasks": [
    { "title": "Task", "goal": "Goal", "taskType": "unknown_type", "scopePaths": [] }
  ],
  "summary": ""
}
---MORTICUS-IMPORT-END---`;

    const result = parseExtractionResponse(response);

    expect(result.candidateTasks[0].taskType).toBe('discovery');
  });

  it('defaults invalid memory category to custom', () => {
    const response = `---MORTICUS-IMPORT-START---
{
  "draftState": null,
  "candidateMemory": [
    { "category": "invalid_cat", "title": "Entry", "content": "Content" }
  ],
  "candidateTasks": [],
  "summary": ""
}
---MORTICUS-IMPORT-END---`;

    const result = parseExtractionResponse(response);

    expect(result.candidateMemory[0].category).toBe('custom');
  });
});

// ── selectChunksForExtraction ──

describe('selectChunksForExtraction', () => {
  it('returns all chunks when under budget', () => {
    const chunks: ImportChunk[] = [
      makeChunk(0, 400),  // 100 tokens
      makeChunk(1, 400),  // 100 tokens
    ];

    const { primary, overflow } = selectChunksForExtraction(chunks, 1000);

    expect(primary).toHaveLength(2);
    expect(overflow).toHaveLength(0);
  });

  it('applies bookend strategy for large input', () => {
    // 10 chunks of 4000 chars each = 1000 tokens each = 10000 total
    const chunks: ImportChunk[] = Array.from({ length: 10 }, (_, i) => makeChunk(i, 4000));

    const { primary, overflow } = selectChunksForExtraction(chunks, 4000);

    // Should take ~2 from head (2000 tokens) and ~2 from tail (2000 tokens) = ~4000
    expect(primary.length).toBeGreaterThan(0);
    expect(primary.length).toBeLessThan(10);
    expect(overflow.length).toBeGreaterThan(0);
    expect(primary.length + overflow.length).toBe(10);

    // First chunk should be from the beginning, last from the end
    expect(primary[0].index).toBe(0);
    expect(primary[primary.length - 1].index).toBe(9);
  });

  it('handles single large chunk', () => {
    const chunks: ImportChunk[] = [makeChunk(0, 200_000)]; // 50K tokens

    const { primary, overflow } = selectChunksForExtraction(chunks, 30_000);

    expect(primary).toHaveLength(1);
    expect(primary[0].index).toBe(0);
    expect(overflow).toHaveLength(0);
  });

  it('handles empty chunks', () => {
    const { primary, overflow } = selectChunksForExtraction([], 30_000);

    expect(primary).toHaveLength(0);
    expect(overflow).toHaveLength(0);
  });
});

describe('mergeExtractionResults', () => {
  it('keeps first scalar values and unions arrays', () => {
    const current: ParsedImportExtraction = {
      draftState: {
        goal: 'Build pricing engine',
        constraints: ['Use TS'],
        decisions: ['Keep prompts minimal'],
      },
      candidateMemory: [{ category: 'custom', title: 'A', content: 'Alpha' }],
      candidateTasks: [{ title: 'Task A', goal: 'A', taskType: 'discovery', scopePaths: [] }],
      summary: 'First pass.',
    };

    const incoming: ParsedImportExtraction = {
      draftState: {
        goal: 'Ignored later goal',
        phase: 'implementation',
        constraints: ['Use TS', 'No network'],
        decisions: ['Keep prompts minimal', 'Use review flow'],
        nextStep: 'Wire import flow',
      },
      candidateMemory: [{ category: 'custom', title: 'B', content: 'Beta' }],
      candidateTasks: [{ title: 'Task B', goal: 'B', taskType: 'implementation', scopePaths: ['src/'] }],
      summary: 'Second pass.',
    };

    const merged = mergeExtractionResults(current, incoming);

    expect(merged.draftState).toEqual({
      goal: 'Build pricing engine',
      phase: 'implementation',
      constraints: ['Use TS', 'No network'],
      decisions: ['Keep prompts minimal', 'Use review flow'],
      nextStep: 'Wire import flow',
    } satisfies DraftCanonicalState);
    expect(merged.candidateMemory).toHaveLength(2);
    expect(merged.candidateTasks).toHaveLength(2);
    expect(merged.summary).toBe('First pass. Second pass.');
  });
});

describe('extractFromTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: MemCell extraction returns a dummy cell
    mockCreateAndExtractMemCell.mockResolvedValue({
      id: 'mc_test1' as MemCellId,
      source: 'import:extraction',
      boundaryReason: 'import_chunk',
      timestamp: '2026-01-01T00:00:00.000Z',
      tokenCount: 100,
      rawContent: 'test',
      episodicSummary: 'test summary',
      events: [],
      relatedDecisionIds: [],
      relatedTaskIds: [],
      extracted: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as MemCell);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('continues processing overflow even when the previous summary is empty', async () => {
    const chunks: ImportChunk[] = [
      makeChunk(0, 80_000),
      makeChunk(1, 80_000),
      makeChunk(2, 80_000),
    ];

    mockRunLlm
      .mockResolvedValueOnce(makeLlmResult(wrapExtraction({
        draftState: { goal: 'Import pricing engine' },
        candidateMemory: [],
        candidateTasks: [],
        summary: '',
      })))
      .mockResolvedValueOnce(makeLlmResult(wrapExtraction({
        draftState: { phase: 'implementation', constraints: ['No prompt regressions'] },
        candidateMemory: [
          { category: 'workflow_preference', title: 'Use review flow', content: 'Route mutations through review.' },
        ],
        candidateTasks: [],
        summary: 'Second window found constraints.',
      })))
      .mockResolvedValueOnce(makeLlmResult(wrapExtraction({
        draftState: { nextStep: 'Fix import routing' },
        candidateMemory: [],
        candidateTasks: [
          { title: 'Repair import flow', goal: 'Surface imported items', taskType: 'implementation', scopePaths: ['src/ui/'] },
        ],
        summary: 'Third window found a task.',
      })));

    const { result, extractedMemCells } = await extractFromTranscript(chunks, '/tmp');

    expect(mockRunLlm).toHaveBeenCalledTimes(3);
    expect(result.draftState).toEqual({
      goal: 'Import pricing engine',
      phase: 'implementation',
      constraints: ['No prompt regressions'],
      nextStep: 'Fix import routing',
    } satisfies DraftCanonicalState);
    expect(result.candidateMemory).toHaveLength(1);
    expect(result.candidateTasks).toHaveLength(1);
    expect(result.memCellIds).toBeDefined();
    expect(extractedMemCells).toBeDefined();
    expect(result.summary).toBe('Second window found constraints. Third window found a task.');
  });

  it('aggregates multi-window sources larger than twice the token budget', async () => {
    const chunks: ImportChunk[] = Array.from({ length: 7 }, (_, index) => makeChunk(index, 40_000));

    mockRunLlm
      .mockResolvedValueOnce(makeLlmResult(wrapExtraction({
        draftState: { goal: 'Window one' },
        candidateMemory: [],
        candidateTasks: [],
        summary: 'Window one.',
      })))
      .mockResolvedValueOnce(makeLlmResult(wrapExtraction({
        draftState: { phase: 'Window two' },
        candidateMemory: [],
        candidateTasks: [],
        summary: 'Window two.',
      })))
      .mockResolvedValueOnce(makeLlmResult(wrapExtraction({
        draftState: { nextStep: 'Window three' },
        candidateMemory: [],
        candidateTasks: [],
        summary: 'Window three.',
      })));

    const { result } = await extractFromTranscript(chunks, '/tmp');

    expect(mockRunLlm).toHaveBeenCalledTimes(3);
    expect(result.draftState).toEqual({
      goal: 'Window one',
      phase: 'Window two',
      nextStep: 'Window three',
    } satisfies DraftCanonicalState);
    expect(result.summary).toBe('Window one. Window two. Window three.');
  });
});

// ── groupChunksIntoWindows ──

describe('groupChunksIntoWindows', () => {
  it('groups small chunks into a single window', () => {
    const chunks: TranscriptChunk[] = [
      makeChunk(0, 100),
      makeChunk(1, 100),
      makeChunk(2, 100),
    ];
    const windows = groupChunksIntoWindows(chunks);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toHaveLength(3);
  });

  it('splits at token threshold', () => {
    // Each chunk ~5000 tokens (20000 chars / 4). Two chunks = 10000 tokens > 8192 threshold
    const chunks: TranscriptChunk[] = [
      makeChunk(0, 20_000),
      makeChunk(1, 20_000),
      makeChunk(2, 20_000),
    ];
    const windows = groupChunksIntoWindows(chunks);

    expect(windows.length).toBeGreaterThan(1);
    // Each window should contain chunks
    for (const w of windows) {
      expect(w.length).toBeGreaterThan(0);
    }
  });

  it('splits at message count threshold', () => {
    // 60 tiny chunks — shouldForceSplit triggers at >= 50, so split happens
    // when adding the 50th message would push count to 50
    const chunks: TranscriptChunk[] = Array.from({ length: 60 }, (_, i) => makeChunk(i, 10));
    const windows = groupChunksIntoWindows(chunks);

    expect(windows.length).toBe(2);
    // First window has 49 chunks (split triggers before adding the 50th)
    expect(windows[0]).toHaveLength(49);
    expect(windows[1]).toHaveLength(11);
  });

  it('handles empty input', () => {
    const windows = groupChunksIntoWindows([]);
    expect(windows).toHaveLength(0);
  });
});

// ── extractImportMemCells ──

describe('extractImportMemCells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces one MemCell per window', async () => {
    let callCount = 0;
    mockCreateAndExtractMemCell.mockImplementation(async () => {
      callCount++;
      return {
        id: `mc_test${callCount}` as MemCellId,
        source: 'import:extraction',
        boundaryReason: 'import_chunk',
        timestamp: '2026-01-01T00:00:00.000Z',
        tokenCount: 100,
        rawContent: 'test',
        episodicSummary: `Summary ${callCount}`,
        events: [`Event from window ${callCount}`],
        relatedDecisionIds: [],
        relatedTaskIds: [],
        extracted: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as MemCell;
    });

    const chunks: TranscriptChunk[] = [
      makeChunk(0, 100),
      makeChunk(1, 100),
    ];

    const cells = await extractImportMemCells(chunks, 'import:test', '/tmp');

    expect(cells).toHaveLength(1); // small enough for single window
    expect(mockCreateAndExtractMemCell).toHaveBeenCalledTimes(1);
    expect(cells[0].episodicSummary).toBe('Summary 1');
  });

  it('calls createAndExtractMemCell with import_chunk boundary reason', async () => {
    mockCreateAndExtractMemCell.mockResolvedValue({
      id: 'mc_test1' as MemCellId,
      source: 'import:test',
      boundaryReason: 'import_chunk',
      timestamp: '2026-01-01T00:00:00.000Z',
      tokenCount: 100,
      rawContent: 'test',
      episodicSummary: 'summary',
      events: [],
      relatedDecisionIds: [],
      relatedTaskIds: [],
      extracted: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as MemCell);

    const chunks: TranscriptChunk[] = [makeChunk(0, 100)];
    await extractImportMemCells(chunks, 'import:test', '/tmp');

    expect(mockCreateAndExtractMemCell).toHaveBeenCalledWith(
      'import:test',
      'import_chunk',
      expect.any(String),
      expect.objectContaining({ goal: 'Imported transcript' }),
      expect.objectContaining({ workingDirectory: '/tmp' }),
    );
  });

  it('skips windows where extraction fails', async () => {
    mockCreateAndExtractMemCell
      .mockRejectedValueOnce(new Error('LLM failed'))
      .mockResolvedValueOnce({
        id: 'mc_test2' as MemCellId,
        source: 'import:test',
        boundaryReason: 'import_chunk',
        timestamp: '2026-01-01T00:00:00.000Z',
        tokenCount: 100,
        rawContent: 'test',
        episodicSummary: 'second window',
        events: [],
        relatedDecisionIds: [],
        relatedTaskIds: [],
        extracted: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as MemCell);

    // Two windows: first fails, second succeeds
    const chunks: TranscriptChunk[] = [
      makeChunk(0, 20_000), // ~5000 tokens
      makeChunk(1, 20_000), // ~5000 tokens → triggers split
    ];
    const cells = await extractImportMemCells(chunks, 'import:test', '/tmp');

    expect(cells).toHaveLength(1);
    expect(cells[0].episodicSummary).toBe('second window');
  });

  it('handles empty chunks', async () => {
    const cells = await extractImportMemCells([], 'import:test', '/tmp');
    expect(cells).toHaveLength(0);
    expect(mockCreateAndExtractMemCell).not.toHaveBeenCalled();
  });
});
