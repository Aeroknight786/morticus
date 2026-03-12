import { describe, it, expect } from 'vitest';
import { canTransition, transitionTask, createTask, TaskStatus } from '../../../src/domain/task.js';
import { generateTaskId, generateProjectId } from '../../../src/domain/ids.js';

describe('Task transitions', () => {
  const validPaths: [TaskStatus, TaskStatus][] = [
    ['draft', 'ready'],
    ['draft', 'archived'],
    ['ready', 'running'],
    ['running', 'awaiting_completion'],
    ['awaiting_completion', 'normalizing_output'],
    ['normalizing_output', 'awaiting_review'],
    ['awaiting_review', 'merged'],
    ['awaiting_review', 'rejected'],
    ['rejected', 'draft'],
  ];

  for (const [from, to] of validPaths) {
    it(`allows ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }

  const invalidPaths: [TaskStatus, TaskStatus][] = [
    ['draft', 'running'],
    ['draft', 'merged'],
    ['ready', 'merged'],
    ['merged', 'draft'],
    ['archived', 'draft'],
    ['running', 'merged'],
  ];

  for (const [from, to] of invalidPaths) {
    it(`blocks ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(false);
    });
  }

  it('transitionTask produces new task with updated status', () => {
    const task = createTask(
      generateTaskId(),
      generateProjectId(),
      'Test task',
      'Test goal',
      'discovery',
      { paths: ['src/'], readOnly: true, writePermissions: [] },
      1,
    );
    const ready = transitionTask(task, 'ready');
    expect(ready.status).toBe('ready');
    expect(ready.id).toBe(task.id);
    expect(task.status).toBe('draft'); // original unchanged
  });

  it('transitionTask throws on invalid transition', () => {
    const task = createTask(
      generateTaskId(),
      generateProjectId(),
      'Test',
      'Goal',
      'discovery',
      { paths: [], readOnly: true, writePermissions: [] },
      1,
    );
    expect(() => transitionTask(task, 'merged')).toThrow('Cannot transition');
  });
});
