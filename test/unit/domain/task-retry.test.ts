import { describe, it, expect } from 'vitest';
import { createRetryTask, createTask } from '../../../src/domain/task.js';
import { generateTaskId } from '../../../src/domain/ids.js';
import type { TaskId, ProjectId, StateVersion } from '../../../src/domain/ids.js';

function makeOriginalTask() {
  return createTask(
    'task_orig' as TaskId,
    'proj_1' as ProjectId,
    'Original task',
    'Build the feature',
    'implementation',
    { paths: ['src/'], readOnly: false, writePermissions: ['create_files', 'modify_files'] },
    5 as StateVersion,
  );
}

describe('createRetryTask', () => {
  it('creates a new draft task with fresh ID', () => {
    const original = makeOriginalTask();
    const newId = generateTaskId();
    const retry = createRetryTask(newId, original, 10 as StateVersion);

    expect(retry.id).toBe(newId);
    expect(retry.id).not.toBe(original.id);
    expect(retry.status).toBe('draft');
  });

  it('sets parentTaskId to original task ID', () => {
    const original = makeOriginalTask();
    const retry = createRetryTask(generateTaskId(), original, 10 as StateVersion);

    expect(retry.parentTaskId).toBe(original.id);
  });

  it('preserves title, goal, taskType, and provider', () => {
    const original = makeOriginalTask();
    const retry = createRetryTask(generateTaskId(), original, 10 as StateVersion);

    expect(retry.title).toBe(original.title);
    expect(retry.goal).toBe(original.goal);
    expect(retry.taskType).toBe(original.taskType);
    expect(retry.provider).toBe(original.provider);
  });

  it('preserves scope', () => {
    const original = makeOriginalTask();
    const retry = createRetryTask(generateTaskId(), original, 10 as StateVersion);

    expect(retry.scope.paths).toEqual(['src/']);
    expect(retry.scope.readOnly).toBe(false);
    expect(retry.scope.writePermissions).toEqual(['create_files', 'modify_files']);
  });

  it('uses current state version, not original stale version', () => {
    const original = makeOriginalTask();
    expect(original.baseStateVersion).toBe(5);

    const retry = createRetryTask(generateTaskId(), original, 15 as StateVersion);
    expect(retry.baseStateVersion).toBe(15);
  });

  it('resets specId, runIds, candidateDeltaId, and reviewOutcome', () => {
    const original = makeOriginalTask();
    const retry = createRetryTask(generateTaskId(), original, 10 as StateVersion);

    expect(retry.specId).toBeNull();
    expect(retry.runIds).toEqual([]);
    expect(retry.candidateDeltaId).toBeNull();
    expect(retry.reviewOutcome).toBeNull();
  });

  it('sets fresh timestamps', () => {
    const original = {
      ...makeOriginalTask(),
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z',
    };
    const retry = createRetryTask(generateTaskId(), original, 10 as StateVersion);

    expect(retry.createdAt).not.toBe(original.createdAt);
    expect(retry.updatedAt).not.toBe(original.updatedAt);
  });

  it('preserves description from original', () => {
    const original = { ...makeOriginalTask(), description: 'Detailed description' };
    const retry = createRetryTask(generateTaskId(), original, 10 as StateVersion);

    expect(retry.description).toBe('Detailed description');
  });
});
