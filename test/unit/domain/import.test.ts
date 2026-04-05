import { describe, it, expect } from 'vitest';
import { createArchiveRecord } from '../../../src/domain/import.js';
import type { ImportSourceMeta, TranscriptChunk, DocSection } from '../../../src/domain/import.js';
import { generateArchiveId } from '../../../src/domain/ids.js';

describe('createArchiveRecord', () => {
  const meta: ImportSourceMeta = {
    originalFileName: 'chat.md',
    fileSize: 1024,
    lineCount: 50,
    detectedFormat: 'markdown_transcript',
    detectedTurnCount: 12,
    estimatedTokens: 256,
    importedAt: '2026-03-20T00:00:00.000Z',
  };

  it('creates a record with parsed status and no extraction', () => {
    const id = generateArchiveId();
    const chunks: TranscriptChunk[] = [
      { kind: 'transcript', index: 0, startLine: 1, endLine: 5, role: 'user', content: 'Hello' },
    ];
    const record = createArchiveRecord(id, meta, chunks);
    expect(record.id).toBe(id);
    expect(record.sourceMeta).toBe(meta);
    expect(record.chunks).toEqual(chunks);
    expect(record.extraction).toBeNull();
    expect(record.conflicts).toEqual([]);
    expect(record.status).toBe('parsed');
    expect(record.acceptedItems).toEqual([]);
    expect(record.error).toBeNull();
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();
  });

  it('accepts doc sections as chunks', () => {
    const id = generateArchiveId();
    const chunks: DocSection[] = [
      { kind: 'doc', index: 0, heading: 'Introduction', level: 1, content: 'Overview', startLine: 1, endLine: 3 },
    ];
    const record = createArchiveRecord(id, meta, chunks);
    expect(record.chunks).toHaveLength(1);
    expect(record.chunks[0].kind).toBe('doc');
  });

  it('works with empty chunks', () => {
    const record = createArchiveRecord(generateArchiveId(), meta, []);
    expect(record.chunks).toEqual([]);
    expect(record.status).toBe('parsed');
  });
});
