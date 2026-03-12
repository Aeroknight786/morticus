import { generateSpecId } from '../domain/ids.js';
import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { DurableMemory } from '../domain/durable-memory.js';
import type { TaskNode } from '../domain/task.js';
import type { TaskSpec, ContextPackOptions } from '../domain/task-spec.js';
import { resolvePolicy } from './policy.js';
import { buildContextPack } from './context-pack.js';

const COMPILER_VERSION = '0.1.0';

// Deterministic task spec resolver.
// Takes a task node + canonical state + durable memory and produces a fully specified TaskSpec.
// No LLM call — pure function.
//
// Context pack is compiled to be intentionally minimal. Discovery tasks do not need
// decisions or risks if they are exploring structure. The caller can pass packOptions
// to tune what is included. Default is all-on (safe baseline).

export function resolveTaskSpec(
  task: TaskNode,
  state: CanonicalProjectState,
  memory: DurableMemory,
  packOptions: Partial<ContextPackOptions> = {},
): TaskSpec {
  const policy = resolvePolicy(task.taskType);

  // Apply task-type defaults: discovery tasks often don't need decisions/risks
  // in the prompt — they are exploring, not constrained by prior choices.
  const defaultPackOptions: Partial<ContextPackOptions> =
    task.taskType === 'discovery'
      ? { includeDecisions: false, includeRisks: false }
      : {};

  const contextPack = buildContextPack(state, memory, task, {
    ...defaultPackOptions,
    ...packOptions,
  });

  return {
    id: generateSpecId(),
    taskId: task.id,
    baseStateVersion: state.version,
    scopePaths: task.scope.paths,
    allowedTools: policy.allowedTools,
    writePermissions: policy.writePermissions,
    testRequirements: [],
    outputSchema: { version: '1.0.0' },
    stopConditions: [{ type: 'goal_met' }],
    mergePolicy: 'require_review',
    contextPack,
    compiledAt: new Date().toISOString(),
    compilerVersion: COMPILER_VERSION,
  };
}
