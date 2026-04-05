import { describe, it, expect } from 'vitest';
import {
  detectImportFormat,
  parseMarkdownTranscript,
  parseTextChatDump,
  parsePlanningDoc,
  parseClaudeCliJsonl,
  parseImportSource,
} from '../../../src/runtime/transcript-parser.js';

// ── detectImportFormat ──

describe('detectImportFormat', () => {
  it('detects heading-based markdown transcript', () => {
    const content = '## User\nHello\n## Assistant\nHi there';
    expect(detectImportFormat(content)).toBe('markdown_transcript');
  });

  it('detects bold-prefix markdown transcript', () => {
    const content = '**User:** Hello\n**Assistant:** Hi there';
    expect(detectImportFormat(content)).toBe('markdown_transcript');
  });

  it('detects blockquote bold markdown transcript', () => {
    const content = '> **User** said:\nHello\n> **Assistant** replied:\nHi';
    expect(detectImportFormat(content)).toBe('markdown_transcript');
  });

  it('detects plain text chat dump with role prefixes', () => {
    const content = 'User: Hello there\nAssistant: Hi!\nUser: How are you?';
    expect(detectImportFormat(content)).toBe('text_chat_dump');
  });

  it('requires at least 2 role lines for text chat dump', () => {
    const content = 'User: Hello\nThis is just some text with a colon.';
    expect(detectImportFormat(content)).toBe('planning_doc');
  });

  it('falls back to planning_doc for unrecognized format', () => {
    const content = '# My Plan\n\nThis is a planning document.\n\n## Goals\n- Build something';
    expect(detectImportFormat(content)).toBe('planning_doc');
  });

  it('handles empty content', () => {
    expect(detectImportFormat('')).toBe('planning_doc');
  });

  it('prefers markdown transcript over text chat when both present', () => {
    const content = '## User\nUser: Hello\n## Assistant\nAssistant: Hi';
    expect(detectImportFormat(content)).toBe('markdown_transcript');
  });

  it('detects Claude as assistant role', () => {
    const content = '## Human\nHello\n## Claude\nHi there';
    expect(detectImportFormat(content)).toBe('markdown_transcript');
  });

  it('detects System role markers', () => {
    const content = '**System:** You are helpful\n**User:** Hello\n**Assistant:** Hi';
    expect(detectImportFormat(content)).toBe('markdown_transcript');
  });

  it('is case insensitive for role detection', () => {
    const content = '## user\nHello\n## assistant\nHi';
    expect(detectImportFormat(content)).toBe('markdown_transcript');
  });

  it('scans only first 100 lines', () => {
    // Role markers after line 100 should not be detected
    const filler = Array(101).fill('Some random text').join('\n');
    const content = filler + '\n## User\nHello\n## Assistant\nHi';
    expect(detectImportFormat(content)).toBe('planning_doc');
  });
});

// ── parseMarkdownTranscript ──

describe('parseMarkdownTranscript', () => {
  it('parses heading-based transcript', () => {
    const content = '## User\nHello world\n## Assistant\nHi there!';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].role).toBe('user');
    expect(chunks[0].content).toBe('Hello world');
    expect(chunks[0].kind).toBe('transcript');
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].role).toBe('assistant');
    expect(chunks[1].content).toBe('Hi there!');
    expect(chunks[1].index).toBe(1);
  });

  it('parses bold-prefix transcript', () => {
    // Bold markers take the whole line; content is on subsequent lines
    const content = '**User:**\nWhat is 2+2?\n**Assistant:**\n4';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].role).toBe('user');
    expect(chunks[0].content).toBe('What is 2+2?');
    expect(chunks[1].role).toBe('assistant');
    expect(chunks[1].content).toBe('4');
  });

  it('preserves inline content on bold-prefix marker lines', () => {
    const content = '**User:** Hello there\n**Assistant:** Hi back';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('Hello there');
    expect(chunks[1].content).toBe('Hi back');
  });

  it('parses blockquote-bold transcript', () => {
    const content = '> **User** said:\nHello\n> **Assistant** replied:\nHi';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].role).toBe('user');
    expect(chunks[1].role).toBe('assistant');
  });

  it('preserves inline content on blockquote marker lines', () => {
    const content = '> **User** hello\n> **Assistant** hi';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('hello');
    expect(chunks[1].content).toBe('hi');
  });

  it('preserves inline content before multiline continuation', () => {
    const content = '**User:** First sentence\nSecond sentence\n**Assistant:** Reply';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('First sentence\nSecond sentence');
    expect(chunks[1].content).toBe('Reply');
  });

  it('maps Human to user and Claude to assistant', () => {
    const content = '## Human\nHello\n## Claude\nHi';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks[0].role).toBe('user');
    expect(chunks[1].role).toBe('assistant');
  });

  it('handles System role', () => {
    const content = '## System\nYou are helpful\n## User\nHello';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks[0].role).toBe('system');
    expect(chunks[1].role).toBe('user');
  });

  it('handles multiline content in chunks', () => {
    const content = '## User\nLine 1\nLine 2\nLine 3\n## Assistant\nResponse';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks[0].content).toBe('Line 1\nLine 2\nLine 3');
    expect(chunks[1].content).toBe('Response');
  });

  it('skips empty chunks', () => {
    const content = '## User\n\n## Assistant\nHi';
    const chunks = parseMarkdownTranscript(content);

    // Empty user chunk is skipped
    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe('assistant');
  });

  it('handles preamble before first marker', () => {
    const content = 'This is a preamble\n\n## User\nHello\n## Assistant\nHi';
    const chunks = parseMarkdownTranscript(content);

    // Preamble with content before first marker is captured as unknown
    const preamble = chunks.find(c => c.role === 'unknown');
    if (preamble) {
      expect(preamble.content).toContain('preamble');
    }
    // User and assistant chunks present
    const userChunk = chunks.find(c => c.role === 'user');
    expect(userChunk).toBeDefined();
    expect(userChunk!.content).toBe('Hello');
  });

  it('tracks line numbers', () => {
    const content = '## User\nHello\n## Assistant\nHi';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks[0].startLine).toBeGreaterThan(0);
    expect(chunks[0].endLine).toBeGreaterThanOrEqual(chunks[0].startLine);
    expect(chunks[1].startLine).toBeGreaterThan(chunks[0].startLine);
  });

  it('returns single unknown chunk for unrecognizable content', () => {
    const content = 'Just some random text\nwith no role markers';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe('unknown');
    expect(chunks[0].content).toContain('random text');
  });

  it('returns single unknown chunk for empty string', () => {
    // No markers found → falls through to "entire content as one chunk"
    // but empty string trims to '', so content is empty → single chunk with empty content
    const chunks = parseMarkdownTranscript('');
    // Parser returns one unknown chunk wrapping all content (even if empty)
    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe('unknown');
  });

  it('returns single unknown chunk for whitespace-only content', () => {
    const chunks = parseMarkdownTranscript('   \n\n   ');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe('unknown');
  });

  it('handles BOM character', () => {
    const content = '\uFEFF## User\nHello\n## Assistant\nHi';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].role).toBe('user');
  });

  it('handles Windows line endings', () => {
    const content = '## User\r\nHello\r\n## Assistant\r\nHi';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('Hello');
  });

  it('handles many turns', () => {
    const turns = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? `## User\nMessage ${i}` : `## Assistant\nReply ${i}`,
    ).join('\n');
    const chunks = parseMarkdownTranscript(turns);

    expect(chunks).toHaveLength(20);
    expect(chunks[0].role).toBe('user');
    expect(chunks[1].role).toBe('assistant');
    expect(chunks[19].role).toBe('assistant');
  });

  it('uses H1 and H3 headings', () => {
    const content = '# User\nHello\n### Assistant\nHi';
    const chunks = parseMarkdownTranscript(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].role).toBe('user');
    expect(chunks[1].role).toBe('assistant');
  });
});

// ── parseTextChatDump ──

describe('parseTextChatDump', () => {
  it('parses simple text chat', () => {
    const content = 'User: Hello\nAssistant: Hi there!';
    const chunks = parseTextChatDump(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].role).toBe('user');
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[0].kind).toBe('transcript');
    expect(chunks[1].role).toBe('assistant');
    expect(chunks[1].content).toBe('Hi there!');
  });

  it('handles multiline responses', () => {
    const content = 'User: What is TypeScript?\nAssistant: TypeScript is a language.\nIt adds types to JavaScript.\nIt compiles to JS.';
    const chunks = parseTextChatDump(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[1].content).toContain('TypeScript is a language.');
    expect(chunks[1].content).toContain('It adds types to JavaScript.');
    expect(chunks[1].content).toContain('It compiles to JS.');
  });

  it('maps Human/Claude roles', () => {
    const content = 'Human: Hello\nClaude: Hi!';
    const chunks = parseTextChatDump(content);

    expect(chunks[0].role).toBe('user');
    expect(chunks[1].role).toBe('assistant');
  });

  it('handles System role', () => {
    const content = 'System: Be helpful\nUser: Hello\nAssistant: Hi';
    const chunks = parseTextChatDump(content);

    expect(chunks[0].role).toBe('system');
    expect(chunks[1].role).toBe('user');
    expect(chunks[2].role).toBe('assistant');
  });

  it('is case insensitive', () => {
    const content = 'user: Hello\nassistant: Hi';
    const chunks = parseTextChatDump(content);

    expect(chunks[0].role).toBe('user');
    expect(chunks[1].role).toBe('assistant');
  });

  it('handles colon with spaces', () => {
    const content = 'User:   Hello there\nAssistant:Hi';
    const chunks = parseTextChatDump(content);

    expect(chunks[0].content).toBe('Hello there');
    expect(chunks[1].content).toBe('Hi');
  });

  it('handles preamble before first role marker', () => {
    const content = 'Conversation from yesterday:\nUser: Hello\nAssistant: Hi';
    const chunks = parseTextChatDump(content);

    // Preamble captured as unknown
    const preamble = chunks.find(c => c.role === 'unknown');
    if (preamble) {
      expect(preamble.content).toContain('yesterday');
    }
    const userChunk = chunks.find(c => c.role === 'user');
    expect(userChunk).toBeDefined();
  });

  it('handles empty input', () => {
    const chunks = parseTextChatDump('');
    expect(chunks).toHaveLength(0);
  });

  it('handles BOM and Windows line endings', () => {
    const content = '\uFEFFUser: Hello\r\nAssistant: Hi';
    const chunks = parseTextChatDump(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('Hello');
  });

  it('tracks line numbers', () => {
    const content = 'User: Hello\nAssistant: Hi\nUser: Bye';
    const chunks = parseTextChatDump(content);

    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThan(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it('handles consecutive same-role turns', () => {
    const content = 'User: Hello\nUser: Hello again\nAssistant: Hi';
    const chunks = parseTextChatDump(content);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].role).toBe('user');
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].role).toBe('user');
    expect(chunks[1].content).toBe('Hello again');
  });
});

// ── parsePlanningDoc ──

describe('parsePlanningDoc', () => {
  it('parses document with headings', () => {
    const content = '# Introduction\nOverview text\n## Goals\nBuild something\n## Constraints\nNo deps';
    const sections = parsePlanningDoc(content);

    expect(sections).toHaveLength(3);
    expect(sections[0].kind).toBe('doc');
    expect(sections[0].heading).toBe('Introduction');
    expect(sections[0].level).toBe(1);
    expect(sections[0].content).toBe('Overview text');
    expect(sections[1].heading).toBe('Goals');
    expect(sections[1].level).toBe(2);
    expect(sections[1].content).toBe('Build something');
    expect(sections[2].heading).toBe('Constraints');
    expect(sections[2].level).toBe(2);
    expect(sections[2].content).toBe('No deps');
  });

  it('captures preamble before first heading', () => {
    const content = 'This is preamble text\n\n# First Section\nContent';
    const sections = parsePlanningDoc(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('');
    expect(sections[0].level).toBe(0);
    expect(sections[0].content).toBe('This is preamble text');
    expect(sections[1].heading).toBe('First Section');
  });

  it('handles nested heading levels', () => {
    const content = '# H1\nA\n## H2\nB\n### H3\nC\n#### H4\nD';
    const sections = parsePlanningDoc(content);

    expect(sections).toHaveLength(4);
    expect(sections[0].level).toBe(1);
    expect(sections[1].level).toBe(2);
    expect(sections[2].level).toBe(3);
    expect(sections[3].level).toBe(4);
  });

  it('skips empty sections and keeps non-empty ones', () => {
    const content = '# Section A\n\n# Section B\nContent B';
    const sections = parsePlanningDoc(content);

    // Section A has empty content and is the first section → skipped
    // Section B has content → kept
    const sectionB = sections.find(s => s.heading === 'Section B');
    expect(sectionB).toBeDefined();
    expect(sectionB!.content).toBe('Content B');
  });

  it('handles multiline section content', () => {
    const content = '# Section\nLine 1\nLine 2\nLine 3';
    const sections = parsePlanningDoc(content);

    expect(sections[0].content).toBe('Line 1\nLine 2\nLine 3');
  });

  it('handles empty input', () => {
    const sections = parsePlanningDoc('');
    expect(sections).toHaveLength(0);
  });

  it('handles content with no headings', () => {
    const content = 'Just plain text\nwith multiple lines\nbut no headings';
    const sections = parsePlanningDoc(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('');
    expect(sections[0].level).toBe(0);
    expect(sections[0].content).toContain('Just plain text');
  });

  it('tracks line numbers', () => {
    const content = '# A\nContent A\n# B\nContent B';
    const sections = parsePlanningDoc(content);

    expect(sections[0].startLine).toBeGreaterThan(0);
    expect(sections[0].endLine).toBeLessThanOrEqual(sections[1].startLine);
  });

  it('indexes sections sequentially', () => {
    const content = '# A\nA\n# B\nB\n# C\nC';
    const sections = parsePlanningDoc(content);

    expect(sections[0].index).toBe(0);
    expect(sections[1].index).toBe(1);
    expect(sections[2].index).toBe(2);
  });

  it('handles BOM and Windows line endings', () => {
    const content = '\uFEFF# Title\r\nContent\r\n## Sub\r\nMore';
    const sections = parsePlanningDoc(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('Title');
    expect(sections[0].content).toBe('Content');
  });

  it('trims content whitespace', () => {
    const content = '# Section\n\n  Content with spaces  \n\n';
    const sections = parsePlanningDoc(content);

    expect(sections[0].content).toBe('Content with spaces');
  });
});

// ── parseClaudeCliJsonl ──

describe('parseClaudeCliJsonl', () => {
  it('parses user messages with text content', () => {
    const content = '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello world"}]}}\n';
    const chunks = parseClaudeCliJsonl(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe('user');
    expect(chunks[0].content).toBe('Hello world');
    expect(chunks[0].kind).toBe('transcript');
    expect(chunks[0].index).toBe(0);
  });

  it('parses assistant messages and extracts text blocks', () => {
    const content = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Here is my response"}]}}\n';
    const chunks = parseClaudeCliJsonl(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe('assistant');
    expect(chunks[0].content).toBe('Here is my response');
  });

  it('compresses tool_use blocks to [tool: <name>]', () => {
    const entry = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read that file.' },
          { type: 'tool_use', id: 'tu_123', name: 'Read', input: { path: '/foo' } },
        ],
      },
    };
    const content = JSON.stringify(entry) + '\n';
    const chunks = parseClaudeCliJsonl(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Let me read that file.\n[tool: Read]');
  });

  it('skips system entries', () => {
    const content = '{"type":"system","subtype":"init","cwd":"/tmp","tools":[]}\n'
      + '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hi"}]}}\n';
    const chunks = parseClaudeCliJsonl(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe('user');
  });

  it('skips tool result entries', () => {
    const content = '{"type":"tool","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"result"}]}\n'
      + '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Thanks"}]}}\n';
    const chunks = parseClaudeCliJsonl(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Thanks');
  });

  it('handles malformed JSON lines by skipping them', () => {
    const content = 'this is not json\n'
      + '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Valid"}]}}\n'
      + '{ broken json }\n';
    const chunks = parseClaudeCliJsonl(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Valid');
  });

  it('handles empty content arrays', () => {
    const content = '{"type":"user","message":{"role":"user","content":[]}}\n'
      + '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Reply"}]}}\n';
    const chunks = parseClaudeCliJsonl(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe('assistant');
  });

  it('handles mixed content types (text + tool_use + thinking)', () => {
    const entry = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'internal reasoning' },
          { type: 'text', text: 'I will edit the file.' },
          { type: 'tool_use', name: 'Edit', id: 'tu_2', input: {} },
          { type: 'text', text: 'Done editing.' },
        ],
      },
    };
    const chunks = parseClaudeCliJsonl(JSON.stringify(entry) + '\n');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('I will edit the file.\n[tool: Edit]\nDone editing.');
  });

  it('preserves message ordering', () => {
    const lines = [
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"First"}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Second"}]}}',
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Third"}]}}',
    ].join('\n');
    const chunks = parseClaudeCliJsonl(lines);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe('First');
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].content).toBe('Second');
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].content).toBe('Third');
    expect(chunks[2].index).toBe(2);
  });

  it('handles empty input', () => {
    const chunks = parseClaudeCliJsonl('');
    expect(chunks).toHaveLength(0);
  });

  it('skips entries with only whitespace text', () => {
    const content = '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"   "}]}}\n';
    const chunks = parseClaudeCliJsonl(content);
    expect(chunks).toHaveLength(0);
  });
});

// ── detectImportFormat JSONL additions ──

describe('detectImportFormat JSONL', () => {
  it('detects JSONL content with type field', () => {
    const content = '{"type":"system","subtype":"init","cwd":"/tmp"}\n{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}';
    expect(detectImportFormat(content)).toBe('claude_cli_jsonl');
  });

  it('detects single-line JSONL with type field', () => {
    const content = '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hi"}]}}';
    expect(detectImportFormat(content)).toBe('claude_cli_jsonl');
  });

  it('does not detect JSON without type field as JSONL', () => {
    const content = '{"name":"foo","value":42}\nSome other text';
    expect(detectImportFormat(content)).not.toBe('claude_cli_jsonl');
  });

  it('JSONL detection takes priority over markdown patterns', () => {
    // First line is valid JSONL with type field, even if later lines have markdown
    const content = '{"type":"system","cwd":"/tmp"}\n## User\nHello';
    expect(detectImportFormat(content)).toBe('claude_cli_jsonl');
  });
});

// ── parseImportSource (unified entry point) ──

describe('parseImportSource', () => {
  it('auto-detects markdown transcript and parses', () => {
    const content = '## User\nHello\n## Assistant\nHi';
    const result = parseImportSource(content);

    expect(result.format).toBe('markdown_transcript');
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].kind).toBe('transcript');
  });

  it('auto-detects text chat dump and parses', () => {
    const content = 'User: Hello\nAssistant: Hi\nUser: Bye';
    const result = parseImportSource(content);

    expect(result.format).toBe('text_chat_dump');
    expect(result.chunks).toHaveLength(3);
  });

  it('auto-detects planning doc and parses', () => {
    const content = '# Project Plan\nOverview\n## Goals\nBuild it';
    const result = parseImportSource(content);

    expect(result.format).toBe('planning_doc');
    expect(result.chunks[0].kind).toBe('doc');
  });

  it('respects explicit format override', () => {
    // This content looks like a text chat dump but we force planning_doc
    const content = 'User: Hello\nAssistant: Hi\nUser: More';
    const result = parseImportSource(content, 'planning_doc');

    expect(result.format).toBe('planning_doc');
    expect(result.chunks[0].kind).toBe('doc');
  });

  it('handles empty content with auto-detection', () => {
    const result = parseImportSource('');

    expect(result.format).toBe('planning_doc');
    expect(result.chunks).toHaveLength(0);
  });

  it('auto-detects JSONL and parses', () => {
    const content = '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}\n'
      + '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}]}}';
    const result = parseImportSource(content);

    expect(result.format).toBe('claude_cli_jsonl');
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].kind).toBe('transcript');
  });

  it('respects explicit claude_cli_jsonl format override', () => {
    const content = '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}';
    const result = parseImportSource(content, 'claude_cli_jsonl');

    expect(result.format).toBe('claude_cli_jsonl');
    expect(result.chunks).toHaveLength(1);
  });
});
