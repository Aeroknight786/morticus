import { describe, it, expect } from 'vitest';
import { createChatSession, mergeDraftState, mergeDraftTasks } from '../../../src/domain/chat.js';
import type { DraftCanonicalState, DraftTask, ChatSession } from '../../../src/domain/chat.js';
import type { ChatSessionId, ProjectId } from '../../../src/domain/ids.js';

describe('createChatSession', () => {
  it('creates a kickoff session with empty fields', () => {
    const session = createChatSession(
      'chat_test1' as ChatSessionId,
      'proj_test1' as ProjectId,
      'kickoff',
    );
    expect(session.id).toBe('chat_test1');
    expect(session.projectId).toBe('proj_test1');
    expect(session.mode).toBe('kickoff');
    expect(session.messages).toEqual([]);
    expect(session.currentDraftState).toBeNull();
    expect(session.draftTasks).toEqual([]);
    expect(session.createdAt).toBeTruthy();
    expect(session.updatedAt).toBe(session.createdAt);
  });

  it('creates a steering session', () => {
    const session = createChatSession(
      'chat_test2' as ChatSessionId,
      'proj_test2' as ProjectId,
      'steering',
    );
    expect(session.mode).toBe('steering');
  });
});

describe('mergeDraftState', () => {
  it('merges into null current (first turn)', () => {
    const update: DraftCanonicalState = {
      goal: 'Build a pricing engine',
      phase: 'planning',
    };
    const result = mergeDraftState(null, update);
    expect(result.goal).toBe('Build a pricing engine');
    expect(result.phase).toBe('planning');
    expect(result.constraints).toBeUndefined();
  });

  it('overwrites existing scalar fields', () => {
    const current: DraftCanonicalState = {
      goal: 'Old goal',
      phase: 'phase1',
      nextStep: 'Do something',
    };
    const update: DraftCanonicalState = {
      goal: 'New goal',
    };
    const result = mergeDraftState(current, update);
    expect(result.goal).toBe('New goal');
    expect(result.phase).toBe('phase1');
    expect(result.nextStep).toBe('Do something');
  });

  it('replaces arrays entirely (not appending)', () => {
    const current: DraftCanonicalState = {
      constraints: ['A', 'B'],
      risks: ['R1'],
    };
    const update: DraftCanonicalState = {
      constraints: ['C'],
    };
    const result = mergeDraftState(current, update);
    expect(result.constraints).toEqual(['C']);
    expect(result.risks).toEqual(['R1']);
  });

  it('preserves fields not in update', () => {
    const current: DraftCanonicalState = {
      goal: 'Goal',
      phaseGoal: 'Phase goal',
      decisions: ['D1'],
      knownFiles: ['a.ts'],
    };
    const update: DraftCanonicalState = {
      phase: 'new phase',
    };
    const result = mergeDraftState(current, update);
    expect(result.goal).toBe('Goal');
    expect(result.phaseGoal).toBe('Phase goal');
    expect(result.decisions).toEqual(['D1']);
    expect(result.knownFiles).toEqual(['a.ts']);
    expect(result.phase).toBe('new phase');
  });

  it('handles all fields present in update', () => {
    const update: DraftCanonicalState = {
      goal: 'G',
      phase: 'P',
      phaseGoal: 'PG',
      constraints: ['C'],
      decisions: ['D'],
      risks: ['R'],
      knownFiles: ['f.ts'],
      nextStep: 'NS',
    };
    const result = mergeDraftState(null, update);
    expect(result).toEqual(update);
  });

  it('accumulates across multiple merges', () => {
    let state: DraftCanonicalState | null = null;
    state = mergeDraftState(state, { goal: 'First goal' });
    state = mergeDraftState(state, { phase: 'planning', constraints: ['C1'] });
    state = mergeDraftState(state, { goal: 'Refined goal', constraints: ['C1', 'C2'] });

    expect(state.goal).toBe('Refined goal');
    expect(state.phase).toBe('planning');
    expect(state.constraints).toEqual(['C1', 'C2']);
  });
});

describe('mergeDraftTasks', () => {
  const task1: DraftTask = { title: 'Setup project', goal: 'Scaffold', taskType: 'implementation', scopePaths: [] };
  const task2: DraftTask = { title: 'Research auth', goal: 'Evaluate options', taskType: 'discovery', scopePaths: ['src/auth/'] };
  const task3: DraftTask = { title: 'Write tests', goal: 'Unit tests', taskType: 'validation', scopePaths: ['test/'] };

  it('adds new tasks to empty list', () => {
    const result = mergeDraftTasks([], [task1, task2]);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Setup project');
    expect(result[1].title).toBe('Research auth');
  });

  it('preserves existing tasks not in incoming', () => {
    const result = mergeDraftTasks([task1], [task2]);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Setup project');
    expect(result[1].title).toBe('Research auth');
  });

  it('updates existing tasks matched by normalized title', () => {
    const updated1: DraftTask = { title: 'Setup project', goal: 'New goal', taskType: 'discovery', scopePaths: ['src/'] };
    const result = mergeDraftTasks([task1, task2], [updated1]);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Setup project');
    expect(result[0].goal).toBe('New goal');
    expect(result[0].taskType).toBe('discovery');
    expect(result[1].title).toBe('Research auth');
  });

  it('matches titles case-insensitively', () => {
    const incoming: DraftTask = { title: 'SETUP PROJECT', goal: 'Updated', taskType: 'implementation', scopePaths: [] };
    const result = mergeDraftTasks([task1], [incoming]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('SETUP PROJECT');
    expect(result[0].goal).toBe('Updated');
  });

  it('trims whitespace for title matching', () => {
    const incoming: DraftTask = { title: '  Setup project  ', goal: 'Updated', taskType: 'implementation', scopePaths: [] };
    const result = mergeDraftTasks([task1], [incoming]);
    expect(result).toHaveLength(1);
    expect(result[0].goal).toBe('Updated');
  });

  it('handles mix of updates and additions', () => {
    const updated2: DraftTask = { title: 'Research auth', goal: 'Deep dive', taskType: 'discovery', scopePaths: [] };
    const result = mergeDraftTasks([task1, task2], [updated2, task3]);
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Setup project');
    expect(result[1].goal).toBe('Deep dive');
    expect(result[2].title).toBe('Write tests');
  });

  it('does not duplicate when incoming has same task twice', () => {
    const result = mergeDraftTasks([], [task1, task1]);
    // Second occurrence updates the first in-place
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Setup project');
  });

  it('returns empty array when both inputs are empty', () => {
    const result = mergeDraftTasks([], []);
    expect(result).toEqual([]);
  });
});
