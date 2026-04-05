// Deterministic transcript/document parsers.
// No LLM calls — pure text processing.
// Handles markdown transcripts, plain text chat dumps, and planning docs.

import type { ImportSourceType, TranscriptChunk, DocSection, ImportChunk } from '../domain/import.js';

// ── Format detection ──

export function detectImportFormat(content: string): ImportSourceType {
  const lines = content.split('\n').slice(0, 100); // scan first 100 lines

  // JSONL: check first non-empty line for JSON with a `type` field
  const firstNonEmpty = lines.find(l => l.trim().length > 0);
  if (firstNonEmpty) {
    try {
      const parsed = JSON.parse(firstNonEmpty.trim());
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        return 'claude_cli_jsonl';
      }
    } catch {
      // Not JSON — fall through to other heuristics
    }
  }

  // Markdown transcript: heading-based or bold-prefix role markers
  const mdTranscriptPatterns = [
    /^#{1,3}\s+(User|Human|Assistant|Claude|System)\b/im,
    /^\*\*(User|Human|Assistant|Claude|System)[:\s*]/im,
    /^>\s*\*\*(User|Human|Assistant|Claude|System)/im,
  ];
  for (const pattern of mdTranscriptPatterns) {
    if (lines.some(l => pattern.test(l))) return 'markdown_transcript';
  }

  // Plain text chat dump: role prefix at line start
  const textChatPattern = /^(User|Human|Assistant|Claude|System)\s*:/im;
  const matchCount = lines.filter(l => textChatPattern.test(l)).length;
  if (matchCount >= 2) return 'text_chat_dump';

  return 'planning_doc';
}

// ── Normalize input ──

function normalize(content: string): string {
  // Strip BOM
  let text = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return text;
}

// ── Role mapping ──

type ChunkRole = TranscriptChunk['role'];

function mapRole(raw: string): ChunkRole {
  const lower = raw.toLowerCase().trim();
  if (lower === 'user' || lower === 'human') return 'user';
  if (lower === 'assistant' || lower === 'claude') return 'assistant';
  if (lower === 'system') return 'system';
  return 'unknown';
}

interface MarkerMatch {
  role: ChunkRole;
  inlineContent: string;
}

interface MarkdownMarkerParser {
  matches(line: string): boolean;
  parse(line: string): MarkerMatch;
}

function cleanInlineContent(raw: string): string {
  return raw.replace(/^[\s:>\-]+/, '').trim();
}

function cleanQuotedInlineContent(raw: string): string {
  const trimmed = cleanInlineContent(raw);
  if (/^(said|replied|asked|wrote)\s*:?\s*$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

const HEADING_MARKER_PARSER: MarkdownMarkerParser = {
  matches(line: string): boolean {
    return /^#{1,3}\s+(User|Human|Assistant|Claude|System)\b/i.test(line);
  },
  parse(line: string): MarkerMatch {
    const match = line.match(/^#{1,3}\s+(User|Human|Assistant|Claude|System)\b(.*)$/i);
    return {
      role: mapRole(match?.[1] ?? 'unknown'),
      inlineContent: cleanInlineContent(match?.[2] ?? ''),
    };
  },
};

const BOLD_MARKER_PARSER: MarkdownMarkerParser = {
  matches(line: string): boolean {
    return /^\*\*(User|Human|Assistant|Claude|System)[:\s*]/i.test(line);
  },
  parse(line: string): MarkerMatch {
    const match = line.match(/^\*\*(User|Human|Assistant|Claude|System)(?::)?\*\*:?\s*(.*)$/i);
    return {
      role: mapRole(match?.[1] ?? 'unknown'),
      inlineContent: cleanInlineContent(match?.[2] ?? ''),
    };
  },
};

const QUOTE_MARKER_PARSER: MarkdownMarkerParser = {
  matches(line: string): boolean {
    return /^>\s*\*\*(User|Human|Assistant|Claude|System)/i.test(line);
  },
  parse(line: string): MarkerMatch {
    const match = line.match(/^>\s*\*\*(User|Human|Assistant|Claude|System)(?::)?\*\*(.*)$/i);
    return {
      role: mapRole(match?.[1] ?? 'unknown'),
      inlineContent: cleanQuotedInlineContent(match?.[2] ?? ''),
    };
  },
};

// ── Markdown transcript parser ──

export function parseMarkdownTranscript(content: string): TranscriptChunk[] {
  const text = normalize(content);
  const lines = text.split('\n');
  const chunks: TranscriptChunk[] = [];

  // Detect which pattern is used
  const markerParsers = [
    HEADING_MARKER_PARSER,
    BOLD_MARKER_PARSER,
    QUOTE_MARKER_PARSER,
  ];

  // Determine dominant pattern
  let parser: MarkdownMarkerParser;
  const headingCount = lines.filter(l => HEADING_MARKER_PARSER.matches(l)).length;
  const boldCount = lines.filter(l => BOLD_MARKER_PARSER.matches(l)).length;
  const quoteCount = lines.filter(l => QUOTE_MARKER_PARSER.matches(l)).length;
  const maxCount = Math.max(headingCount, boldCount, quoteCount);

  if (maxCount === 0) {
    // No recognizable markers — treat entire content as one chunk
    return [{
      kind: 'transcript',
      index: 0,
      startLine: 1,
      endLine: lines.length,
      role: 'unknown',
      content: text.trim(),
    }];
  }

  if (headingCount >= boldCount && headingCount >= quoteCount) {
    parser = markerParsers[0];
  } else if (boldCount >= quoteCount) {
    parser = markerParsers[1];
  } else {
    parser = markerParsers[2];
  }

  // Split into chunks at role-change boundaries
  let currentRole: ChunkRole = 'unknown';
  let currentStartLine = 1;
  let currentLines: string[] = [];

  // Collect preamble (content before first role marker)
  let foundFirstMarker = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (parser.matches(line)) {
      // Flush previous chunk
      if (currentLines.length > 0 || foundFirstMarker) {
        const content = currentLines.join('\n').trim();
        if (content) {
          chunks.push({
            kind: 'transcript',
            index: chunks.length,
            startLine: currentStartLine,
            endLine: i, // line before this one
            role: currentRole,
            content,
          });
        }
      }
      foundFirstMarker = true;
      const match = parser.parse(line);
      currentRole = match.role;
      currentStartLine = i + 1; // 1-indexed
      currentLines = match.inlineContent ? [match.inlineContent] : [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush final chunk
  if (currentLines.length > 0) {
    const content = currentLines.join('\n').trim();
    if (content) {
      chunks.push({
        kind: 'transcript',
        index: chunks.length,
        startLine: currentStartLine,
        endLine: lines.length,
        role: currentRole,
        content,
      });
    }
  }

  return chunks;
}

// ── Plain text chat dump parser ──

export function parseTextChatDump(content: string): TranscriptChunk[] {
  const text = normalize(content);
  const lines = text.split('\n');
  const chunks: TranscriptChunk[] = [];
  const rolePattern = /^(User|Human|Assistant|Claude|System)\s*:\s*/i;

  let currentRole: ChunkRole = 'unknown';
  let currentStartLine = 1;
  let currentLines: string[] = [];
  let foundFirstMarker = false;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(rolePattern);
    if (match) {
      // Flush previous
      if (currentLines.length > 0 || foundFirstMarker) {
        const content = currentLines.join('\n').trim();
        if (content) {
          chunks.push({
            kind: 'transcript',
            index: chunks.length,
            startLine: currentStartLine,
            endLine: i,
            role: currentRole,
            content,
          });
        }
      }
      foundFirstMarker = true;
      currentRole = mapRole(match[1]);
      currentStartLine = i + 1;
      // Include the rest of this line (after the "User: " prefix)
      const remainder = lines[i].slice(match[0].length);
      currentLines = remainder ? [remainder] : [];
    } else {
      currentLines.push(lines[i]);
    }
  }

  // Flush final
  if (currentLines.length > 0) {
    const content = currentLines.join('\n').trim();
    if (content) {
      chunks.push({
        kind: 'transcript',
        index: chunks.length,
        startLine: currentStartLine,
        endLine: lines.length,
        role: currentRole,
        content,
      });
    }
  }

  return chunks;
}

// ── Planning doc parser ──

export function parsePlanningDoc(content: string): DocSection[] {
  const text = normalize(content);
  const lines = text.split('\n');
  const sections: DocSection[] = [];
  const headingPattern = /^(#{1,6})\s+(.+)$/;

  let currentHeading = '';
  let currentLevel = 0;
  let currentStartLine = 1;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headingPattern);
    if (match) {
      // Flush previous section
      const content = currentLines.join('\n').trim();
      if (content || sections.length > 0) {
        sections.push({
          kind: 'doc',
          index: sections.length,
          heading: currentHeading,
          level: currentLevel,
          content,
          startLine: currentStartLine,
          endLine: i,
        });
      }
      currentHeading = match[2].trim();
      currentLevel = match[1].length;
      currentStartLine = i + 1;
      currentLines = [];
    } else {
      currentLines.push(lines[i]);
    }
  }

  // Flush final section
  const finalContent = currentLines.join('\n').trim();
  if (finalContent || sections.length > 0) {
    sections.push({
      kind: 'doc',
      index: sections.length,
      heading: currentHeading,
      level: currentLevel,
      content: finalContent,
      startLine: currentStartLine,
      endLine: lines.length,
    });
  }

  return sections;
}

// ── Claude CLI JSONL parser ──

interface JsonlEntry {
  type?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string; name?: string }>;
  };
  timestamp?: string;
}

function extractJsonlContent(contentBlocks: Array<{ type?: string; text?: string; name?: string }>): string {
  const parts: string[] = [];
  for (const block of contentBlocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      parts.push(`[tool: ${block.name}]`);
    }
    // Skip thinking, tool_result, and other block types
  }
  return parts.join('\n');
}

export function parseClaudeCliJsonl(content: string): TranscriptChunk[] {
  const text = normalize(content);
  const lines = text.split('\n');
  const chunks: TranscriptChunk[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      // Skip malformed JSON lines
      continue;
    }

    // Skip system and tool entries
    if (!entry.type || entry.type === 'system' || entry.type === 'tool') {
      continue;
    }

    // Only process user and assistant entries
    if (entry.type !== 'user' && entry.type !== 'assistant') {
      continue;
    }

    const role: ChunkRole = entry.type === 'user' ? 'user' : 'assistant';
    const contentBlocks = entry.message?.content;

    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
      continue;
    }

    const extracted = extractJsonlContent(contentBlocks);
    if (!extracted.trim()) continue;

    chunks.push({
      kind: 'transcript',
      index: chunks.length,
      startLine: i + 1,
      endLine: i + 1,
      role,
      content: extracted,
    });
  }

  return chunks;
}

// ── Unified parse entry point ──

export function parseImportSource(
  content: string,
  format?: ImportSourceType,
): { format: ImportSourceType; chunks: ImportChunk[] } {
  const detected = format ?? detectImportFormat(content);
  switch (detected) {
    case 'markdown_transcript':
      return { format: detected, chunks: parseMarkdownTranscript(content) };
    case 'text_chat_dump':
      return { format: detected, chunks: parseTextChatDump(content) };
    case 'planning_doc':
      return { format: detected, chunks: parsePlanningDoc(content) };
    case 'claude_cli_jsonl':
      return { format: detected, chunks: parseClaudeCliJsonl(content) };
  }
}
