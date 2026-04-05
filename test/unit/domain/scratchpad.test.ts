import { describe, it, expect } from 'vitest';
import { createScratchpadSession, parseScratchpadHandoff } from '../../../src/domain/scratchpad.js';
import type { ScratchpadId, ChatSessionId } from '../../../src/domain/ids.js';

describe('createScratchpadSession', () => {
  it('creates an active session with empty messages', () => {
    const session = createScratchpadSession(
      'scratch_test1' as ScratchpadId,
      'chat_test1' as ChatSessionId,
      'Goal: Build X\nPhase: planning',
      { goal: 'Build X', phase: 'planning', phaseGoal: 'Set up project' },
    );
    expect(session.id).toBe('scratch_test1');
    expect(session.parentChatSessionId).toBe('chat_test1');
    expect(session.parentContextSummary).toBe('Goal: Build X\nPhase: planning');
    expect(session.origin.goal).toBe('Build X');
    expect(session.origin.phase).toBe('planning');
    expect(session.origin.phaseGoal).toBe('Set up project');
    expect(session.status).toBe('active');
    expect(session.messages).toEqual([]);
    expect(session.handoff).toBeNull();
    expect(session.spawnedAt).toBeTruthy();
    expect(session.closedAt).toBeNull();
  });
});

describe('parseScratchpadHandoff', () => {
  it('parses a complete handoff with all fields', () => {
    const raw = {
      summary: 'Explored auth patterns',
      keyFindings: ['JWT is best', 'Need refresh tokens'],
      unresolvedQuestions: ['Token expiry duration?'],
      candidateTask: {
        title: 'Implement JWT auth',
        goal: 'Add JWT authentication to API',
        taskType: 'implementation',
        scopePaths: ['src/auth/'],
      },
      candidateDelta: {
        operations: [
          { type: 'add_decision', value: 'Use JWT for auth' },
          { type: 'add_constraint', value: 'Tokens expire in 1 hour' },
        ],
        rationale: 'Auth exploration concluded JWT is best approach',
      },
    };
    const result = parseScratchpadHandoff(raw);
    expect(result.summary).toBe('Explored auth patterns');
    expect(result.keyFindings).toEqual(['JWT is best', 'Need refresh tokens']);
    expect(result.unresolvedQuestions).toEqual(['Token expiry duration?']);
    expect(result.candidateTask).toEqual({
      title: 'Implement JWT auth',
      goal: 'Add JWT authentication to API',
      taskType: 'implementation',
      scopePaths: ['src/auth/'],
    });
    expect(result.candidateDelta!.operations).toHaveLength(2);
    expect(result.candidateDelta!.rationale).toBe('Auth exploration concluded JWT is best approach');
  });

  it('returns safe defaults for missing fields', () => {
    const result = parseScratchpadHandoff({});
    expect(result.summary).toBe('No summary provided.');
    expect(result.keyFindings).toEqual([]);
    expect(result.unresolvedQuestions).toEqual([]);
    expect(result.candidateTask).toBeUndefined();
    expect(result.candidateDelta).toBeUndefined();
  });

  it('filters non-string items from arrays', () => {
    const result = parseScratchpadHandoff({
      summary: 'Test',
      keyFindings: ['valid', 42, null, 'also valid'],
      unresolvedQuestions: [true, 'question'],
    });
    expect(result.keyFindings).toEqual(['valid', 'also valid']);
    expect(result.unresolvedQuestions).toEqual(['question']);
  });

  it('ignores candidateTask without required fields', () => {
    const result = parseScratchpadHandoff({
      summary: 'Test',
      candidateTask: { title: 'Has title only' },
    });
    expect(result.candidateTask).toBeUndefined();
  });

  it('defaults candidateTask taskType to discovery for invalid values', () => {
    const result = parseScratchpadHandoff({
      summary: 'Test',
      candidateTask: {
        title: 'Explore API',
        goal: 'Research API patterns',
        taskType: 'invalid_type',
        scopePaths: [],
      },
    });
    expect(result.candidateTask!.taskType).toBe('discovery');
  });

  it('ignores candidateDelta with empty operations', () => {
    const result = parseScratchpadHandoff({
      summary: 'Test',
      candidateDelta: { operations: [], rationale: 'nothing' },
    });
    expect(result.candidateDelta).toBeUndefined();
  });

  it('filters invalid operations from candidateDelta', () => {
    const result = parseScratchpadHandoff({
      summary: 'Test',
      candidateDelta: {
        operations: [
          { type: 'add_decision', value: 'valid op' },
          'not_an_object',
          null,
          { noType: true },
        ],
        rationale: 'mixed ops',
      },
    });
    expect(result.candidateDelta!.operations).toHaveLength(1);
    expect(result.candidateDelta!.operations[0].type).toBe('add_decision');
  });

  it('rejects unknown operation types even if they are strings', () => {
    const result = parseScratchpadHandoff({
      summary: 'Test',
      candidateDelta: {
        operations: [
          { type: 'hallucinated_op', value: 'bad' },
          { type: 'delete_everything', value: 'very bad' },
        ],
        rationale: 'Claude hallucinated',
      },
    });
    // All ops invalid → candidateDelta omitted entirely
    expect(result.candidateDelta).toBeUndefined();
  });

  it('keeps only valid operation types and drops unknown ones', () => {
    const result = parseScratchpadHandoff({
      summary: 'Test',
      candidateDelta: {
        operations: [
          { type: 'add_constraint', value: 'Must use HTTPS' },
          { type: 'invented_op', value: 'dropped' },
          { type: 'set_phase', value: 'implementation' },
        ],
        rationale: 'mixed valid and invalid',
      },
    });
    expect(result.candidateDelta!.operations).toHaveLength(2);
    expect(result.candidateDelta!.operations[0].type).toBe('add_constraint');
    expect(result.candidateDelta!.operations[1].type).toBe('set_phase');
  });
});
