import { describe, it, expect } from 'vitest';
import { parseChatTurnResult, buildStateSummary, buildTaskContextSection, sanitizeDeltaOperation } from '../../../src/runtime/chat-adapter.js';
import type { TaskContext } from '../../../src/domain/chat.js';
import type { CanonicalProjectState } from '../../../src/domain/canonical-state.js';
import type { StateVersion, ProjectId } from '../../../src/domain/ids.js';

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

describe('parseChatTurnResult — draftTasks array', () => {
  it('parses a valid draftTasks array', () => {
    const structured = {
      draftState: { goal: 'Build a game' },
      draftTasks: [
        { title: 'Setup board', goal: 'Create board', taskType: 'implementation', scopePaths: ['src/board/'] },
        { title: 'Research AI', goal: 'Explore algorithms', taskType: 'discovery', scopePaths: [] },
      ],
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTasks).toBeDefined();
    expect(result.draftTasks).toHaveLength(2);
    expect(result.draftTasks![0].title).toBe('Setup board');
    expect(result.draftTasks![1].taskType).toBe('discovery');
  });

  it('filters out invalid tasks from draftTasks array', () => {
    const structured = {
      draftState: null,
      draftTasks: [
        { title: 'Valid task', goal: 'Do something', taskType: 'implementation', scopePaths: [] },
        { title: '', goal: 'Missing title' },   // invalid: empty title
        { goal: 'No title at all' },             // invalid: no title
        'not an object',                          // invalid: not an object
        null,                                     // invalid: null
      ],
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTasks).toHaveLength(1);
    expect(result.draftTasks![0].title).toBe('Valid task');
  });

  it('omits draftTasks when array is empty', () => {
    const structured = {
      draftState: { goal: 'Test' },
      draftTasks: [],
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTasks).toBeUndefined();
  });

  it('omits draftTasks when field is not an array', () => {
    const structured = {
      draftState: null,
      draftTasks: 'not an array',
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTasks).toBeUndefined();
  });

  it('defaults invalid taskType to discovery in draftTasks', () => {
    const structured = {
      draftState: null,
      draftTasks: [
        { title: 'Explore', goal: 'Look around', taskType: 'bogus_type', scopePaths: [] },
      ],
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTasks![0].taskType).toBe('discovery');
  });
});

describe('buildStateSummary', () => {
  function makeState(overrides: Partial<CanonicalProjectState> = {}): CanonicalProjectState {
    return {
      version: 1 as StateVersion,
      goal: '',
      phase: '',
      phaseGoal: '',
      phaseExitCriteria: [],
      constraints: [],
      decisions: [],
      risks: [],
      knownFiles: [],
      nextStep: '',
      evidenceRefs: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      createdFromDeltaId: null,
      ...overrides,
    };
  }

  it('includes goal and phase when present', () => {
    const summary = buildStateSummary(makeState({ goal: 'Build an app', phase: 'planning' }));
    expect(summary).toContain('Goal: Build an app');
    expect(summary).toContain('Phase: planning');
  });

  it('includes phaseGoal when present', () => {
    const summary = buildStateSummary(makeState({ phaseGoal: 'Finish scaffolding' }));
    expect(summary).toContain('Phase goal: Finish scaffolding');
  });

  it('omits empty fields', () => {
    const summary = buildStateSummary(makeState());
    expect(summary).not.toContain('Goal:');
    expect(summary).not.toContain('Phase:');
    expect(summary).not.toContain('Constraints:');
    expect(summary).toContain('State version: 1');
  });

  it('includes constraints as bullet list', () => {
    const summary = buildStateSummary(makeState({ constraints: ['Must use TypeScript', 'No external deps'] }));
    expect(summary).toContain('Constraints:');
    expect(summary).toContain('  - Must use TypeScript');
    expect(summary).toContain('  - No external deps');
  });

  it('includes known files as comma-separated', () => {
    const summary = buildStateSummary(makeState({ knownFiles: ['src/a.ts', 'src/b.ts'] }));
    expect(summary).toContain('Known files: src/a.ts, src/b.ts');
  });

  it('always includes state version', () => {
    const summary = buildStateSummary(makeState({ version: 5 as StateVersion }));
    expect(summary).toContain('State version: 5');
  });
});

describe('buildTaskContextSection', () => {
  it('returns empty string when no tasks', () => {
    const ctx: TaskContext = { activeTasks: [], recentlyCompleted: [], awaitingReview: [] };
    expect(buildTaskContextSection(ctx)).toBe('');
  });

  it('includes active tasks section', () => {
    const ctx: TaskContext = {
      activeTasks: [{ title: 'Build UI', taskType: 'implementation', status: 'running' }],
      recentlyCompleted: [],
      awaitingReview: [],
    };
    const section = buildTaskContextSection(ctx);
    expect(section).toContain('Project Activity');
    expect(section).toContain('Active tasks:');
    expect(section).toContain('"Build UI" [implementation] — running');
  });

  it('includes recently completed section', () => {
    const ctx: TaskContext = {
      activeTasks: [],
      recentlyCompleted: [{ title: 'Setup DB', taskType: 'implementation', goal: 'Set up PostgreSQL schema' }],
      awaitingReview: [],
    };
    const section = buildTaskContextSection(ctx);
    expect(section).toContain('Recently completed:');
    expect(section).toContain('"Setup DB" [implementation] — Set up PostgreSQL schema');
  });

  it('includes awaiting review section', () => {
    const ctx: TaskContext = {
      activeTasks: [],
      recentlyCompleted: [],
      awaitingReview: [{ title: 'Auth flow' }],
    };
    const section = buildTaskContextSection(ctx);
    expect(section).toContain('Awaiting review:');
    expect(section).toContain('"Auth flow"');
  });

  it('includes all sections when all present', () => {
    const ctx: TaskContext = {
      activeTasks: [{ title: 'Task A', taskType: 'discovery', status: 'draft' }],
      recentlyCompleted: [{ title: 'Task B', taskType: 'validation', goal: 'Validate schema' }],
      awaitingReview: [{ title: 'Task C' }],
    };
    const section = buildTaskContextSection(ctx);
    expect(section).toContain('Active tasks:');
    expect(section).toContain('Recently completed:');
    expect(section).toContain('Awaiting review:');
  });
});

describe('buildStateSummary — phaseExitCriteria', () => {
  function makeState(overrides: Partial<CanonicalProjectState> = {}): CanonicalProjectState {
    return {
      version: 1 as StateVersion,
      goal: '',
      phase: '',
      phaseGoal: '',
      phaseExitCriteria: [],
      constraints: [],
      decisions: [],
      risks: [],
      knownFiles: [],
      nextStep: '',
      evidenceRefs: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      createdFromDeltaId: null,
      ...overrides,
    };
  }

  it('includes phase exit criteria when present', () => {
    const summary = buildStateSummary(makeState({
      phaseExitCriteria: ['All tests pass', 'Code reviewed'],
    }));
    expect(summary).toContain('Phase exit criteria:');
    expect(summary).toContain('  - All tests pass');
    expect(summary).toContain('  - Code reviewed');
  });

  it('omits phase exit criteria header when array is empty', () => {
    const summary = buildStateSummary(makeState({ phaseExitCriteria: [] }));
    expect(summary).not.toContain('Phase exit criteria:');
  });
});

describe('buildTaskContextSection — recently completed goals', () => {
  it('includes goal for recently completed tasks', () => {
    const ctx: TaskContext = {
      activeTasks: [],
      recentlyCompleted: [{ title: 'Setup DB', taskType: 'implementation', goal: 'Create PostgreSQL schema and migrations' }],
      awaitingReview: [],
    };
    const section = buildTaskContextSection(ctx);
    expect(section).toContain('"Setup DB" [implementation] — Create PostgreSQL schema and migrations');
  });
});

describe('parseChatTurnResult — steering draftTasks', () => {
  it('parses draftTasks array from a steering-style response', () => {
    const structured = {
      draftState: null,
      draftTask: null,
      draftTasks: [
        { title: 'Implement auth', goal: 'Add JWT-based auth', taskType: 'implementation', scopePaths: ['src/auth/'] },
        { title: 'Write auth tests', goal: 'Cover auth endpoints', taskType: 'validation', scopePaths: ['test/'] },
      ],
    };
    const result = parseChatTurnResult(wrapJson(structured, 'Based on your project state, here are my recommendations.'));
    expect(result.response).toBe('Based on your project state, here are my recommendations.');
    expect(result.draftTask).toBeUndefined();
    expect(result.draftTasks).toHaveLength(2);
    expect(result.draftTasks![0].title).toBe('Implement auth');
    expect(result.draftTasks![1].taskType).toBe('validation');
  });

  it('parses both draftTask and draftTasks independently when both present', () => {
    const structured = {
      draftState: null,
      draftTask: { title: 'Direct task', goal: 'Do something', taskType: 'discovery', scopePaths: [] },
      draftTasks: [
        { title: 'Suggested task', goal: 'Explore options', taskType: 'discovery', scopePaths: [] },
      ],
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftTask).toBeDefined();
    expect(result.draftTask!.title).toBe('Direct task');
    expect(result.draftTasks).toBeDefined();
    expect(result.draftTasks).toHaveLength(1);
    expect(result.draftTasks![0].title).toBe('Suggested task');
  });
});

describe('sanitizeDeltaOperation', () => {
  it('accepts valid add_constraint operation', () => {
    const op = sanitizeDeltaOperation({ type: 'add_constraint', value: 'Must use TypeScript' });
    expect(op).toEqual({ type: 'add_constraint', value: 'Must use TypeScript' });
  });

  it('accepts valid add_known_file with path field', () => {
    const op = sanitizeDeltaOperation({ type: 'add_known_file', path: 'src/index.ts' });
    expect(op).toEqual({ type: 'add_known_file', path: 'src/index.ts' });
  });

  it('accepts valid set_phase_goal operation', () => {
    const op = sanitizeDeltaOperation({ type: 'set_phase_goal', value: 'Complete scaffolding' });
    expect(op).toEqual({ type: 'set_phase_goal', value: 'Complete scaffolding' });
  });

  it('rejects unknown type', () => {
    expect(sanitizeDeltaOperation({ type: 'invalid_op', value: 'test' })).toBeUndefined();
  });

  it('rejects missing value for non-file operations', () => {
    expect(sanitizeDeltaOperation({ type: 'add_constraint' })).toBeUndefined();
    expect(sanitizeDeltaOperation({ type: 'add_constraint', value: '' })).toBeUndefined();
  });

  it('rejects missing path for file operations', () => {
    expect(sanitizeDeltaOperation({ type: 'add_known_file' })).toBeUndefined();
    expect(sanitizeDeltaOperation({ type: 'add_known_file', path: '' })).toBeUndefined();
  });
});

describe('parseChatTurnResult — draftDelta', () => {
  it('parses draftDelta array from steering response', () => {
    const structured = {
      draftState: null,
      draftTask: null,
      draftDelta: [
        { type: 'add_constraint', value: 'Must use PostgreSQL' },
        { type: 'set_goal', value: 'Build a pricing engine' },
      ],
    };
    const result = parseChatTurnResult(wrapJson(structured, "I'll propose these state changes."));
    expect(result.response).toBe("I'll propose these state changes.");
    expect(result.draftDelta).toHaveLength(2);
    expect(result.draftDelta![0]).toEqual({ type: 'add_constraint', value: 'Must use PostgreSQL' });
    expect(result.draftDelta![1]).toEqual({ type: 'set_goal', value: 'Build a pricing engine' });
  });

  it('filters out invalid operations from draftDelta', () => {
    const structured = {
      draftState: null,
      draftDelta: [
        { type: 'add_constraint', value: 'Valid' },
        { type: 'invalid_type', value: 'Bad' },
        { type: 'add_decision' }, // missing value
        null,
        'not an object',
      ],
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftDelta).toHaveLength(1);
    expect(result.draftDelta![0]).toEqual({ type: 'add_constraint', value: 'Valid' });
  });

  it('omits draftDelta when array is empty', () => {
    const structured = {
      draftState: null,
      draftDelta: [],
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftDelta).toBeUndefined();
  });

  it('omits draftDelta when field is not an array', () => {
    const structured = {
      draftState: null,
      draftDelta: 'not an array',
    };
    const result = parseChatTurnResult(wrapJson(structured));
    expect(result.draftDelta).toBeUndefined();
  });
});
