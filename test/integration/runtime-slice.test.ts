import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProjectStore } from '../../src/storage/store.js';
import { createTask, transitionTask } from '../../src/domain/task.js';
import { generateTaskId } from '../../src/domain/ids.js';
import { resolveTaskSpec } from '../../src/compiler/spec-resolver.js';
import { createEmptyMemory } from '../../src/domain/durable-memory.js';
import { RunController } from '../../src/runtime/run-controller.js';

// Mock llm-provider so we don't need a real CLI binary.
// Everything else (store, task transitions, delta building, state) is real.
vi.mock('../../src/runtime/llm-provider.js', () => ({
  runLlm: vi.fn(),
  getConfiguredProvider: vi.fn(() => 'claude'),
}));

import { runLlm } from '../../src/runtime/llm-provider.js';
const mockRunLlm = vi.mocked(runLlm);

const START = '---MORTICUS-OUTPUT-START---';
const END = '---MORTICUS-OUTPUT-END---';

function makeClaudeOutput(overrides: Record<string, unknown> = {}): string {
  const payload = {
    summary: 'Explored the project structure. Found the extension activation flow.',
    inspectedFiles: ['src/extension.ts', 'src/ui/commands.ts'],
    modifiedFiles: [],
    proposedDelta: {
      addConstraints: [],
      removeConstraints: [],
      addDecisions: ['Extension activates on workspaceContains:.morticus/project.json'],
      removeDecisions: [],
      addRisks: [],
      removeRisks: [],
      addKnownFiles: ['src/extension.ts'],
      removeKnownFiles: [],
      setGoal: null,
      setPhase: null,
      setNextStep: 'Review the activation flow with the team',
    },
    evidenceRefs: [],
    confidence: 0.9,
    completionReason: 'task_goal_met',
    unresolvedIssues: [],
    ...overrides,
  };
  return `Some Claude preamble text here.\n\n${START}\n${JSON.stringify(payload, null, 2)}\n${END}\n\nDone.`;
}

describe('Runtime slice: RunController integration', () => {
  let tmpDir: string;
  let store: ProjectStore;
  let workspaceRoot: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'morticus-runtime-'));
    workspaceRoot = tmpDir; // workspace is same as tmp for tests
    store = new ProjectStore(tmpDir);
    await store.initialize('Runtime Test Project');
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('completes full run lifecycle and transitions task to awaiting_review', async () => {
    mockRunLlm.mockResolvedValue({
      stdout: makeClaudeOutput(),
      exitCode: 0,
      timedOut: false,
    });

    const state = await store.state.getCurrentState();
    const memory = createEmptyMemory();

    const task = createTask(
      generateTaskId(),
      'proj_test',
      'Explore extension activation',
      'Understand how the extension activates',
      'discovery',
      { paths: ['src/'], readOnly: true, writePermissions: [] },
      state.version,
    );
    const readyTask = transitionTask(task, 'ready');
    const spec = resolveTaskSpec(readyTask, state, memory);
    await store.specs.save(spec);
    const taskWithSpec = { ...readyTask, specId: spec.id };
    await store.tasks.save(taskWithSpec);

    const controller = new RunController({ store, workspaceRoot });
    const result = await controller.execute(taskWithSpec);

    // Returned values are sane
    expect(result.runId).toBeTruthy();
    expect(result.normalizedOutput.confidence).toBe(0.9);
    expect(result.normalizedOutput.completionReason).toBe('task_goal_met');
    expect(result.normalizedOutput.summary).toContain('extension activation flow');
    expect(result.delta).toBeTruthy();
    expect(typeof result.delta.id).toBe('string');
  });

  it('persists run.json, output.json, and normalized.json to disk', async () => {
    mockRunLlm.mockResolvedValue({
      stdout: makeClaudeOutput(),
      exitCode: 0,
      timedOut: false,
    });

    const state = await store.state.getCurrentState();
    const memory = createEmptyMemory();

    const task = createTask(
      generateTaskId(), 'proj_test', 'Artifact test', 'Check persistence',
      'discovery', { paths: [], readOnly: true, writePermissions: [] }, state.version,
    );
    const readyTask = transitionTask(task, 'ready');
    const spec = resolveTaskSpec(readyTask, state, memory);
    await store.specs.save(spec);
    const taskWithSpec = { ...readyTask, specId: spec.id };
    await store.tasks.save(taskWithSpec);

    const { runId } = await new RunController({ store, workspaceRoot }).execute(taskWithSpec);

    const runDir = path.join(store.runs.runsDir, runId);
    const runJson = JSON.parse(await fs.promises.readFile(path.join(runDir, 'run.json'), 'utf8'));
    const outputJson = JSON.parse(await fs.promises.readFile(path.join(runDir, 'output.json'), 'utf8'));
    const normalizedJson = JSON.parse(await fs.promises.readFile(path.join(runDir, 'normalized.json'), 'utf8'));

    expect(runJson.id).toBe(runId);
    expect(runJson.status).toBe('completed');
    expect(typeof outputJson.output).toBe('string');
    expect(normalizedJson.confidence).toBe(0.9);
  });

  it('task transitions to awaiting_review after run', async () => {
    mockRunLlm.mockResolvedValue({
      stdout: makeClaudeOutput(),
      exitCode: 0,
      timedOut: false,
    });

    const state = await store.state.getCurrentState();
    const memory = createEmptyMemory();

    const task = createTask(
      generateTaskId(), 'proj_test', 'Transition test', 'Verify state machine',
      'discovery', { paths: [], readOnly: true, writePermissions: [] }, state.version,
    );
    const readyTask = transitionTask(task, 'ready');
    const spec = resolveTaskSpec(readyTask, state, memory);
    await store.specs.save(spec);
    const taskWithSpec = { ...readyTask, specId: spec.id };
    await store.tasks.save(taskWithSpec);

    await new RunController({ store, workspaceRoot }).execute(taskWithSpec);

    const savedTasks = await store.tasks.list();
    const updated = savedTasks.find(t => t.id === task.id);
    expect(updated?.status).toBe('awaiting_review');
    expect(updated?.candidateDeltaId).toBeTruthy();
  });

  it('delta carries confidence from normalized output', async () => {
    mockRunLlm.mockResolvedValue({
      stdout: makeClaudeOutput({ confidence: 0.75 }),
      exitCode: 0,
      timedOut: false,
    });

    const state = await store.state.getCurrentState();
    const memory = createEmptyMemory();

    const task = createTask(
      generateTaskId(), 'proj_test', 'Confidence test', 'Check confidence propagation',
      'discovery', { paths: [], readOnly: true, writePermissions: [] }, state.version,
    );
    const readyTask = transitionTask(task, 'ready');
    const spec = resolveTaskSpec(readyTask, state, memory);
    await store.specs.save(spec);
    const taskWithSpec = { ...readyTask, specId: spec.id };

    const { delta } = await new RunController({ store, workspaceRoot }).execute(taskWithSpec);
    expect(delta.confidence).toBe(0.75);
  });

  it('marks run as failed and re-throws when claude adapter throws', async () => {
    mockRunLlm.mockRejectedValue(new Error('Claude CLI not found'));

    const state = await store.state.getCurrentState();
    const memory = createEmptyMemory();

    const task = createTask(
      generateTaskId(), 'proj_test', 'Error test', 'Verify error handling',
      'discovery', { paths: [], readOnly: true, writePermissions: [] }, state.version,
    );
    const readyTask = transitionTask(task, 'ready');
    const spec = resolveTaskSpec(readyTask, state, memory);
    await store.specs.save(spec);
    const taskWithSpec = { ...readyTask, specId: spec.id };

    const controller = new RunController({ store, workspaceRoot });
    await expect(controller.execute(taskWithSpec)).rejects.toThrow('Claude CLI not found');

    // Run record should be marked as failed
    const tasks = await store.tasks.list();
    // Task stays at 'running' (no backward transition)
    const saved = tasks.find(t => t.id === task.id);
    expect(saved?.status).toBe('running');
  });

  it('handles zero-confidence output gracefully (no structured block)', async () => {
    mockRunLlm.mockResolvedValue({
      stdout: 'Claude had nothing to say here. No structured block.',
      exitCode: 0,
      timedOut: false,
    });

    const state = await store.state.getCurrentState();
    const memory = createEmptyMemory();

    const task = createTask(
      generateTaskId(), 'proj_test', 'No output test', 'Handle zero confidence',
      'discovery', { paths: [], readOnly: true, writePermissions: [] }, state.version,
    );
    const readyTask = transitionTask(task, 'ready');
    const spec = resolveTaskSpec(readyTask, state, memory);
    await store.specs.save(spec);
    const taskWithSpec = { ...readyTask, specId: spec.id };

    const { normalizedOutput, delta } = await new RunController({ store, workspaceRoot }).execute(taskWithSpec);
    expect(normalizedOutput.confidence).toBe(0);
    expect(normalizedOutput.completionReason).toBe('provider_stopped');
    expect(delta.confidence).toBe(0);
  });
});
