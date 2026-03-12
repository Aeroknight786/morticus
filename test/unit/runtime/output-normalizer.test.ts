import { describe, it, expect } from 'vitest';
import { normalizeOutput } from '../../../src/runtime/output-normalizer.js';

const START = '---MORTICUS-OUTPUT-START---';
const END = '---MORTICUS-OUTPUT-END---';

function wrapJson(obj: unknown): string {
  return `Some preamble text.\n\n${START}\n${JSON.stringify(obj, null, 2)}\n${END}\n\nSome trailing text.`;
}

const validPayload = {
  summary: 'Explored the runtime layer.',
  inspectedFiles: ['src/runtime/run-controller.ts'],
  modifiedFiles: [],
  proposedDelta: {
    addConstraints: ['Use typed IDs'],
    removeConstraints: [],
    addDecisions: [],
    removeDecisions: [],
    addRisks: ['Worktree cleanup failure'],
    removeRisks: [],
    addKnownFiles: ['src/runtime/'],
    removeKnownFiles: [],
    setGoal: null,
    setPhase: 'beta',
    setNextStep: 'Write more tests',
  },
  evidenceRefs: ['task_run_001'],
  confidence: 0.85,
  completionReason: 'task_goal_met',
  unresolvedIssues: [],
};

describe('normalizeOutput — happy path', () => {
  it('parses valid JSON between markers', () => {
    const result = normalizeOutput(wrapJson(validPayload), 0, false);
    expect(result.summary).toBe('Explored the runtime layer.');
    expect(result.confidence).toBe(0.85);
    expect(result.completionReason).toBe('task_goal_met');
    expect(result.inspectedFiles).toEqual(['src/runtime/run-controller.ts']);
    expect(result.proposedDelta.addConstraints).toEqual(['Use typed IDs']);
    expect(result.proposedDelta.setPhase).toBe('beta');
    expect(result.proposedDelta.setNextStep).toBe('Write more tests');
  });

  it('preserves text before and after markers without including it in output', () => {
    const result = normalizeOutput(wrapJson(validPayload), 0, false);
    expect(result.summary).not.toContain('preamble');
    expect(result.summary).not.toContain('trailing');
  });

  it('returns evidenceRefs', () => {
    const result = normalizeOutput(wrapJson(validPayload), 0, false);
    expect(result.evidenceRefs).toEqual(['task_run_001']);
  });
});

describe('normalizeOutput — missing markers', () => {
  it('returns fallback when start marker is missing', () => {
    const raw = `Some output without markers.\n${END}`;
    const result = normalizeOutput(raw, 0, false);
    expect(result.confidence).toBe(0);
    expect(result.completionReason).toBe('provider_stopped');
  });

  it('returns fallback when end marker is missing', () => {
    const raw = `${START}\n{"summary": "hello"}`;
    const result = normalizeOutput(raw, 0, false);
    expect(result.confidence).toBe(0);
    expect(result.completionReason).toBe('provider_stopped');
  });

  it('returns fallback with max_turns_reached when timedOut', () => {
    const result = normalizeOutput('no markers here', 0, true);
    expect(result.confidence).toBe(0);
    expect(result.completionReason).toBe('max_turns_reached');
  });

  it('returns fallback when end marker appears before start marker', () => {
    const raw = `${END}\n${START}\n{"summary":"hi"}`;
    const result = normalizeOutput(raw, 0, false);
    expect(result.confidence).toBe(0);
  });
});

describe('normalizeOutput — malformed JSON', () => {
  it('returns fallback with completionReason error on invalid JSON', () => {
    const raw = `${START}\nnot valid json{{{${END}`;
    const result = normalizeOutput(raw, 0, false);
    expect(result.confidence).toBe(0);
    expect(result.completionReason).toBe('error');
  });

  it('returns fallback when parsed value is not an object', () => {
    const raw = `${START}\n42\n${END}`;
    const result = normalizeOutput(raw, 0, false);
    expect(result.confidence).toBe(0);
    expect(result.completionReason).toBe('error');
  });
});

describe('normalizeOutput — coercion of missing ProposedDelta keys', () => {
  it('fills missing proposedDelta fields with empty arrays / null', () => {
    const payload = { ...validPayload, proposedDelta: {} };
    const result = normalizeOutput(wrapJson(payload), 0, false);
    const delta = result.proposedDelta;
    expect(delta.addConstraints).toEqual([]);
    expect(delta.removeConstraints).toEqual([]);
    expect(delta.addDecisions).toEqual([]);
    expect(delta.removeDecisions).toEqual([]);
    expect(delta.addRisks).toEqual([]);
    expect(delta.removeRisks).toEqual([]);
    expect(delta.addKnownFiles).toEqual([]);
    expect(delta.removeKnownFiles).toEqual([]);
    expect(delta.setGoal).toBeNull();
    expect(delta.setPhase).toBeNull();
    expect(delta.setNextStep).toBeNull();
  });

  it('does not throw when proposedDelta is null', () => {
    const payload = { ...validPayload, proposedDelta: null };
    expect(() => normalizeOutput(wrapJson(payload), 0, false)).not.toThrow();
    const result = normalizeOutput(wrapJson(payload), 0, false);
    expect(result.proposedDelta.addConstraints).toEqual([]);
  });

  it('filters non-string values from array fields', () => {
    const payload = {
      ...validPayload,
      proposedDelta: { ...validPayload.proposedDelta, addConstraints: [1, 'valid', null] },
    };
    const result = normalizeOutput(wrapJson(payload), 0, false);
    expect(result.proposedDelta.addConstraints).toEqual(['valid']);
  });
});

describe('normalizeOutput — confidence clamping', () => {
  it('clamps confidence above 1 to 1', () => {
    const payload = { ...validPayload, confidence: 2.5 };
    const result = normalizeOutput(wrapJson(payload), 0, false);
    expect(result.confidence).toBe(1);
  });

  it('clamps confidence below 0 to 0', () => {
    const payload = { ...validPayload, confidence: -0.5 };
    const result = normalizeOutput(wrapJson(payload), 0, false);
    expect(result.confidence).toBe(0);
  });

  it('preserves confidence of 0.0', () => {
    const payload = { ...validPayload, confidence: 0 };
    const result = normalizeOutput(wrapJson(payload), 0, false);
    expect(result.confidence).toBe(0);
  });
});

describe('normalizeOutput — completionReason validation', () => {
  it('accepts all valid completionReason values', () => {
    for (const reason of ['task_goal_met', 'max_turns_reached', 'provider_stopped', 'error']) {
      const payload = { ...validPayload, completionReason: reason };
      const result = normalizeOutput(wrapJson(payload), 0, false);
      expect(result.completionReason).toBe(reason);
    }
  });

  it('defaults to task_goal_met for unknown completionReason', () => {
    const payload = { ...validPayload, completionReason: 'something_weird' };
    const result = normalizeOutput(wrapJson(payload), 0, false);
    expect(result.completionReason).toBe('task_goal_met');
  });
});

describe('normalizeOutput — non-zero exit code', () => {
  it('caps confidence at 0.5 when exit code is non-zero and not error reason', () => {
    const payload = { ...validPayload, confidence: 0.9, completionReason: 'task_goal_met' };
    const result = normalizeOutput(wrapJson(payload), 1, false);
    expect(result.confidence).toBe(0.5);
  });

  it('does not cap confidence when completionReason is error', () => {
    const payload = { ...validPayload, confidence: 0.1, completionReason: 'error' };
    const result = normalizeOutput(wrapJson(payload), 1, false);
    expect(result.confidence).toBe(0.1);
  });
});
