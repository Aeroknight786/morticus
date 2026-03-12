import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProjectStore } from '../../src/storage/store.js';
import { createTask, transitionTask } from '../../src/domain/task.js';
import { generateTaskId } from '../../src/domain/ids.js';
import { resolveTaskSpec } from '../../src/compiler/spec-resolver.js';
import { buildDelta } from '../../src/review/delta-builder.js';
import { validateDelta } from '../../src/review/validator.js';
import { applyAcceptedDelta } from '../../src/review/delta-applier.js';
import type { ProposedDelta } from '../../src/domain/task-run.js';

// End-to-end test of the first vertical slice:
// init → create task → compile spec → simulate run → build delta → validate → apply → verify

describe('First vertical slice: full loop', () => {
  let tmpDir: string;
  let store: ProjectStore;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'morticus-e2e-'));
    store = new ProjectStore(tmpDir);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('runs the complete init → task → compile → run → review → merge loop', async () => {
    // 1. Initialize project
    const project = await store.initialize('E2E Test Project');
    expect(project.name).toBe('E2E Test Project');

    // 2. Verify initial state
    const initialState = await store.state.getCurrentState();
    expect(initialState.version).toBe(1);
    expect(initialState.goal).toBe('');

    // 3. Create a discovery task
    const task = createTask(
      generateTaskId(),
      project.id,
      'Trace auth middleware',
      'Find where authentication middleware is configured and identify bypass paths',
      'discovery',
      { paths: ['src/server/'], readOnly: true, writePermissions: [] },
      initialState.version,
    );
    await store.tasks.save(task);

    // 4. Compile task spec
    const state = await store.state.getCurrentState();
    const memory = await store.memory.get();
    const spec = resolveTaskSpec(task, state, memory);
    await store.specs.save(spec);

    expect(spec.taskId).toBe(task.id);
    expect(spec.baseStateVersion).toBe(1);
    expect(spec.writePermissions).toEqual([]);
    expect(spec.allowedTools).toContain('read');
    expect(spec.contextPack.taskGoal).toBe(task.goal);

    // Update task with spec and transition to ready
    let updatedTask = { ...task, specId: spec.id, updatedAt: new Date().toISOString() };
    updatedTask = transitionTask(updatedTask, 'ready');
    await store.tasks.save(updatedTask);

    // 5. Simulate run output (in Phase 1, this is manual)
    const proposed: ProposedDelta = {
      addConstraints: [],
      removeConstraints: [],
      addDecisions: [],
      removeDecisions: [],
      addRisks: ['OAuth callback may bypass session middleware'],
      removeRisks: [],
      addKnownFiles: ['src/server/auth.ts', 'src/server/session.ts'],
      removeKnownFiles: [],
      setGoal: null,
      setPhase: null,
      setNextStep: 'Validate callback path with regression tests',
    };

    // 6. Build delta
    const delta = buildDelta(proposed, task.id, state.version);
    expect(delta.operations.length).toBeGreaterThan(0);
    expect(delta.status).toBe('proposed');

    // 7. Validate delta
    const conflicts = validateDelta(delta, state, spec);
    delta.conflicts = conflicts;
    expect(conflicts).toHaveLength(0); // clean — no staleness, files in scope

    await store.deltas.save(delta);

    // 8. Transition task through lifecycle
    let taskForReview = transitionTask(updatedTask, 'running');
    taskForReview = transitionTask(taskForReview, 'awaiting_completion');
    taskForReview = transitionTask(taskForReview, 'normalizing_output');
    taskForReview = transitionTask(taskForReview, 'awaiting_review');
    taskForReview = { ...taskForReview, candidateDeltaId: delta.id };
    await store.tasks.save(taskForReview);

    // 9. Apply accepted delta
    const currentState = await store.state.getCurrentState();
    const result = await applyAcceptedDelta(delta, currentState, store.state, store.deltas);

    expect(result.newState.version).toBe(2);
    expect(result.newState.risks).toContain('OAuth callback may bypass session middleware');
    expect(result.newState.knownFiles).toContain('src/server/auth.ts');
    expect(result.newState.knownFiles).toContain('src/server/session.ts');
    expect(result.newState.nextStep).toBe('Validate callback path with regression tests');

    // 10. Verify persisted state
    const finalState = await store.state.getCurrentState();
    expect(finalState.version).toBe(2);
    expect(finalState.risks).toContain('OAuth callback may bypass session middleware');

    // Old version still accessible
    const v1 = await store.state.getVersion(1);
    expect(v1.version).toBe(1);
    expect(v1.risks).toEqual([]);

    // 11. Verify task list
    const tasks = await store.tasks.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('awaiting_review');
    expect(tasks[0].candidateDeltaId).toBe(delta.id);

    // 12. Verify delta was persisted as accepted
    const savedDelta = await store.deltas.get(delta.id);
    expect(savedDelta.status).toBe('accepted');
  });
});
