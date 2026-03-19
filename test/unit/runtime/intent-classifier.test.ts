import { describe, it, expect } from 'vitest';
import { classifyIntent, generateLocalResponse } from '../../../src/runtime/intent-classifier.js';
import type { CanonicalProjectState } from '../../../src/domain/canonical-state.js';
import type { TaskContext } from '../../../src/domain/chat.js';
import type { StateVersion } from '../../../src/domain/ids.js';

describe('classifyIntent', () => {
  it('delegates everything in kickoff mode', () => {
    expect(classifyIntent("What's my goal?", 'kickoff')).toEqual({ type: 'delegate' });
    expect(classifyIntent('list constraints', 'kickoff')).toEqual({ type: 'delegate' });
  });

  it('classifies goal queries', () => {
    expect(classifyIntent("What's my goal?", 'steering')).toEqual({ type: 'state_query', field: 'goal' });
    expect(classifyIntent("what is the goal", 'steering')).toEqual({ type: 'state_query', field: 'goal' });
    expect(classifyIntent("what's our goal", 'steering')).toEqual({ type: 'state_query', field: 'goal' });
  });

  it('classifies phase queries', () => {
    expect(classifyIntent("what phase are we in?", 'steering')).toEqual({ type: 'state_query', field: 'phase' });
    expect(classifyIntent("what's the phase", 'steering')).toEqual({ type: 'state_query', field: 'phase' });
  });

  it('classifies next step queries', () => {
    expect(classifyIntent("what's the next step?", 'steering')).toEqual({ type: 'state_query', field: 'nextStep' });
    expect(classifyIntent("what is my next step", 'steering')).toEqual({ type: 'state_query', field: 'nextStep' });
  });

  it('classifies constraint queries', () => {
    expect(classifyIntent('list constraints', 'steering')).toEqual({ type: 'state_query', field: 'constraints' });
    expect(classifyIntent('show my constraints', 'steering')).toEqual({ type: 'state_query', field: 'constraints' });
    expect(classifyIntent('what are the constraints', 'steering')).toEqual({ type: 'state_query', field: 'constraints' });
  });

  it('classifies decision queries', () => {
    expect(classifyIntent('show decisions', 'steering')).toEqual({ type: 'state_query', field: 'decisions' });
    expect(classifyIntent('what are our decisions', 'steering')).toEqual({ type: 'state_query', field: 'decisions' });
  });

  it('classifies risk queries', () => {
    expect(classifyIntent('list risks', 'steering')).toEqual({ type: 'state_query', field: 'risks' });
  });

  it('classifies exit criteria queries', () => {
    expect(classifyIntent('show exit criteria', 'steering')).toEqual({ type: 'state_query', field: 'phaseExitCriteria' });
    expect(classifyIntent('what are the phase criteria', 'steering')).toEqual({ type: 'state_query', field: 'phaseExitCriteria' });
  });

  it('classifies active task queries', () => {
    expect(classifyIntent('what tasks are active?', 'steering')).toEqual({ type: 'task_query', filter: 'active' });
    expect(classifyIntent('show active tasks', 'steering')).toEqual({ type: 'task_query', filter: 'active' });
  });

  it('classifies awaiting review queries', () => {
    expect(classifyIntent('what is awaiting review?', 'steering')).toEqual({ type: 'task_query', filter: 'awaiting_review' });
    expect(classifyIntent('tasks awaiting review', 'steering')).toEqual({ type: 'task_query', filter: 'awaiting_review' });
  });

  it('delegates complex requests to Claude', () => {
    expect(classifyIntent('create a task to implement auth', 'steering')).toEqual({ type: 'delegate' });
    expect(classifyIntent('what should we do next?', 'steering')).toEqual({ type: 'delegate' });
    expect(classifyIntent('add a constraint about testing', 'steering')).toEqual({ type: 'delegate' });
    expect(classifyIntent('help me plan the next phase', 'steering')).toEqual({ type: 'delegate' });
  });
});

describe('generateLocalResponse', () => {
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

  it('returns goal from state', () => {
    const response = generateLocalResponse(
      { type: 'state_query', field: 'goal' },
      makeState({ goal: 'Build a pricing engine' }),
      undefined,
    );
    expect(response).toBe('Build a pricing engine');
  });

  it('returns formatted array for constraints', () => {
    const response = generateLocalResponse(
      { type: 'state_query', field: 'constraints' },
      makeState({ constraints: ['Must use TypeScript', 'No external deps'] }),
      undefined,
    );
    expect(response).toContain('1. Must use TypeScript');
    expect(response).toContain('2. No external deps');
  });

  it('handles empty array fields', () => {
    const response = generateLocalResponse(
      { type: 'state_query', field: 'constraints' },
      makeState(),
      undefined,
    );
    expect(response).toContain('No constraints set');
  });

  it('handles empty string fields', () => {
    const response = generateLocalResponse(
      { type: 'state_query', field: 'goal' },
      makeState(),
      undefined,
    );
    expect(response).toContain('No goal set');
  });

  it('returns message when no state initialized', () => {
    const response = generateLocalResponse(
      { type: 'state_query', field: 'goal' },
      null,
      undefined,
    );
    expect(response).toBe('No project state initialized yet.');
  });

  it('formats active tasks', () => {
    const ctx: TaskContext = {
      activeTasks: [
        { title: 'Build UI', taskType: 'implementation', status: 'running' },
        { title: 'Research auth', taskType: 'discovery', status: 'draft' },
      ],
      recentlyCompleted: [],
      awaitingReview: [],
    };
    const response = generateLocalResponse(
      { type: 'task_query', filter: 'active' },
      null,
      ctx,
    );
    expect(response).toContain('"Build UI" [implementation] — running');
    expect(response).toContain('"Research auth" [discovery] — draft');
  });

  it('returns no active tasks message', () => {
    const ctx: TaskContext = { activeTasks: [], recentlyCompleted: [], awaitingReview: [] };
    const response = generateLocalResponse(
      { type: 'task_query', filter: 'active' },
      null,
      ctx,
    );
    expect(response).toBe('No active tasks.');
  });

  it('formats awaiting review tasks', () => {
    const ctx: TaskContext = {
      activeTasks: [],
      recentlyCompleted: [],
      awaitingReview: [{ title: 'Auth flow' }],
    };
    const response = generateLocalResponse(
      { type: 'task_query', filter: 'awaiting_review' },
      null,
      ctx,
    );
    expect(response).toContain('"Auth flow"');
  });
});
