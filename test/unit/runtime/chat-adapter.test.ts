import { describe, it, expect } from 'vitest';
import { parseChatTurnResult } from '../../../src/runtime/chat-adapter.js';

const START = '---MORTICUS-CHAT-START---';
const END = '---MORTICUS-CHAT-END---';

function wrapJson(obj: unknown, before = 'Hello!', after = ''): string {
  const parts = [before, `${START}\n${JSON.stringify(obj, null, 2)}\n${END}`];
  if (after) parts.push(after);
  return parts.filter(Boolean).join('\n\n');
}

describe('parseChatTurnResult — happy path', () => {
  it('parses response + draftState', () => {
    const structured = {
      draftState: {
        goal: 'Build a pricing engine',
        phase: 'planning',
        constraints: ['Must use TypeScript'],
      },
      draftTask: null,
    };
    const result = parseChatTurnResult(wrapJson(structured, 'Great, let me help you plan this.'));
    expect(result.response).toBe('Great, let me help you plan this.');
    expect(result.draftState).toBeDefined();
    expect(result.draftState!.goal).toBe('Build a pricing engine');
    expect(result.draftState!.phase).toBe('planning');
    expect(result.draftState!.constraints).toEqual(['Must use TypeScript']);
    expect(result.draftTask).toBeUndefined();
  });

  it('parses response + draftTask', () => {
    const structured = {
      draftState: null,
      draftTask: {
        title: 'Explore auth options',
        goal: 'Research available auth libraries',
        taskType: 'discovery',
        scopePaths: ['src/auth/'],
      },
    };
    const result = parseChatTurnResult(wrapJson(structured, "I'll create a task for that."));
    expect(result.response).toBe("I'll create a task for that.");
    expect(result.draftTask).toBeDefined();
    expect(result.draftTask!.title).toBe('Explore auth options');
    expect(result.draftTask!.taskType).toBe('discovery');
    expect(result.draftTask!.scopePaths).toEqual(['src/auth/']);
    expect(result.draftState).toBeUndefined();
  });

  it('parses both draftState and draftTask', () => {
    const structured = {
      draftState: { goal: 'Build an app' },
      draftTask: { title: 'Setup project', goal: 'Scaffold', taskType: 'implementation', scopePaths: [] },
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftState).toBeDefined();
    expect(result.draftTask).toBeDefined();
  });

  it('combines text before and after markers', () => {
    const structured = { draftState: null, draftTask: null };
    const raw = `Before text.\n\n${START}\n${JSON.stringify(structured)}\n${END}\n\nAfter text.`;
    const result = parseChatTurnResult(raw);
    expect(result.response).toBe('Before text.\n\nAfter text.');
  });
});

describe('parseChatTurnResult — graceful degradation', () => {
  it('returns response-only when no markers present', () => {
    const result = parseChatTurnResult('Just a plain response with no structured data.');
    expect(result.response).toBe('Just a plain response with no structured data.');
    expect(result.draftState).toBeUndefined();
    expect(result.draftTask).toBeUndefined();
  });

  it('returns response-only when only start marker present', () => {
    const raw = `Some text\n\n${START}\n{"draftState": null}`;
    const result = parseChatTurnResult(raw);
    expect(result.response).toContain('Some text');
    expect(result.draftState).toBeUndefined();
  });

  it('returns response-only when only end marker present', () => {
    const raw = `Some text\n\n${END}`;
    const result = parseChatTurnResult(raw);
    expect(result.response).toContain('Some text');
  });

  it('returns fallback when response is empty', () => {
    const result = parseChatTurnResult('');
    expect(result.response).toBe('(No response from Claude)');
  });

  it('returns response-only on malformed JSON between markers', () => {
    const raw = `Let me help.\n\n${START}\nnot{valid{json\n${END}`;
    const result = parseChatTurnResult(raw);
    expect(result.response).toBe('Let me help.');
    expect(result.draftState).toBeUndefined();
    expect(result.draftTask).toBeUndefined();
  });
});

describe('parseChatTurnResult — sanitization', () => {
  it('filters non-string values from draftState arrays', () => {
    const structured = {
      draftState: {
        goal: 'Valid goal',
        constraints: ['valid', 42, null, 'also valid'],
      },
      draftTask: null,
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftState!.constraints).toEqual(['valid', 'also valid']);
  });

  it('ignores draftState when not an object', () => {
    const structured = { draftState: 'not an object', draftTask: null };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftState).toBeUndefined();
  });

  it('ignores draftTask when title is missing', () => {
    const structured = {
      draftState: null,
      draftTask: { goal: 'No title here', taskType: 'discovery', scopePaths: [] },
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTask).toBeUndefined();
  });

  it('ignores draftTask when goal is missing', () => {
    const structured = {
      draftState: null,
      draftTask: { title: 'Has title', taskType: 'discovery', scopePaths: [] },
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTask).toBeUndefined();
  });

  it('defaults draftTask taskType to discovery for unknown values', () => {
    const structured = {
      draftState: null,
      draftTask: { title: 'Test', goal: 'Do stuff', taskType: 'unknown_type', scopePaths: [] },
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTask!.taskType).toBe('discovery');
  });

  it('filters non-string scopePaths', () => {
    const structured = {
      draftState: null,
      draftTask: { title: 'Test', goal: 'Do stuff', taskType: 'implementation', scopePaths: ['src/', 42, null] },
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTask!.scopePaths).toEqual(['src/']);
  });

  it('ignores empty string goal in draftState', () => {
    const structured = {
      draftState: { goal: '', phase: 'planning' },
      draftTask: null,
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftState!.goal).toBeUndefined();
    expect(result.draftState!.phase).toBe('planning');
  });

  it('handles phaseGoal in draftState', () => {
    const structured = {
      draftState: { goal: 'Build something', phaseGoal: 'Complete scaffolding' },
      draftTask: null,
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftState!.phaseGoal).toBe('Complete scaffolding');
  });
});
