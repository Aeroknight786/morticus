import * as path from 'node:path';
import type { ProjectStore } from '../storage/store.js';
import type { TaskNode } from '../domain/task.js';
import type { TaskRun, NormalizedOutput } from '../domain/task-run.js';
import type { StateDelta } from '../domain/state-delta.js';
import type { RunId } from '../domain/ids.js';
import { generateRunId } from '../domain/ids.js';
import { createTaskRun } from '../domain/task-run.js';
import { transitionTask } from '../domain/task.js';
import { MorticusError } from '../domain/errors.js';
import { buildDelta } from '../review/delta-builder.js';
import { validateDelta } from '../review/validator.js';
import { buildPrompt } from './prompt-builder.js';
import { runLlm, getConfiguredProvider } from './llm-provider.js';
import { prepareWorktree, cleanupWorktree } from './worktree-manager.js';
import { collectArtifacts } from './artifact-collector.js';
import { normalizeOutput } from './output-normalizer.js';
import { buildContextDiagnostics } from '../domain/context-policy.js';
import { createAndExtractMemCell } from './memory-extractor.js';

export interface RunControllerDeps {
  store: ProjectStore;
  workspaceRoot: string;
}

export interface RunResult {
  runId: RunId;
  normalizedOutput: NormalizedOutput;
  delta: StateDelta;
}

// Orchestrates the full run lifecycle:
//   pending → running → awaiting_completion → normalizing_output → awaiting_review
//
// The ReviewPanel handles the final step (awaiting_review → merged/rejected).
// Error recovery: on any failure after the run is created, sets run.status = 'failed'
// and re-throws. The task is left at 'running' — user can archive it.
export class RunController {
  private store: ProjectStore;
  private workspaceRoot: string;

  constructor(deps: RunControllerDeps) {
    this.store = deps.store;
    this.workspaceRoot = deps.workspaceRoot;
  }

  async execute(task: TaskNode, abortSignal?: AbortSignal): Promise<RunResult> {
    if (!task.specId) {
      throw new MorticusError(
        `Task "${task.title}" has no compiled spec. Run "Compile Task Spec" first.`,
        'PROVIDER_ERROR',
      );
    }

    const spec = await this.store.specs.get(task.specId);

    // 1. Create run record
    const runId = generateRunId();
    const provider = getConfiguredProvider();
    let run: TaskRun = createTaskRun(runId, task.id, provider);
    await this.store.runs.save(run);

    // 2. Transition task to running
    let updatedTask = transitionTask(task, 'running');
    updatedTask = { ...updatedTask, runIds: [...updatedTask.runIds, runId] };
    await this.store.tasks.save(updatedTask);

    try {
      // 3. Prepare worktree (implementation tasks only)
      const worktreeResult = await prepareWorktree(
        this.workspaceRoot,
        runId,
        task.scope.readOnly,
      );

      // Snapshot context metrics at run creation for historical accuracy
      const memory = await this.store.memory.get();
      const activeMemoryCount = memory.entries.filter(e => e.active).length;
      const manifest = spec.contextPack.contextManifest;
      run = {
        ...run,
        status: 'running',
        startedAt: new Date().toISOString(),
        worktreePath: worktreeResult.path,
        contextMetrics: {
          estimatedTokens: spec.contextPack.estimatedTokens,
          activeMemoryEntryCount: activeMemoryCount,
          stablePrefixLength: spec.contextPack.stablePrefix.length,
          memoryIncluded: manifest?.memoryIncluded ?? activeMemoryCount,
          memoryExcluded: manifest?.memoryExcluded ?? 0,
          contextDiagnostics: manifest ? buildContextDiagnostics(manifest) : null,
        },
      };
      await this.store.runs.save(run);

      // 4. Build and execute prompt
      const prompt = buildPrompt(spec.contextPack);
      console.log(`[morticus] run ${runId} — provider: ${provider}, estimated tokens: ${spec.contextPack.estimatedTokens}`);

      const claudeResult = await runLlm(prompt, {
        workingDirectory: worktreeResult.path ?? this.workspaceRoot,
        timeoutMs: 300_000,
        signal: abortSignal,
        sandbox: 'workspace-write',
      });

      // 5. Persist raw output
      await this.store.runs.saveRawOutput(runId, claudeResult.stdout);
      const rawOutputPath = path.join(this.store.runs.runsDir, runId, 'output.json');
      run = { ...run, exitCode: claudeResult.exitCode, rawOutputPath };
      await this.store.runs.save(run);

      // 6. Collect artifacts (git diff for implementation tasks)
      const runArtifactDir = path.join(this.store.runs.runsDir, runId);
      const artifacts = await collectArtifacts(
        this.workspaceRoot,
        worktreeResult.path,
        runArtifactDir,
        runId,
      );
      run = { ...run, artifactPaths: artifacts.artifactPaths };
      await this.store.runs.save(run);

      // 7. Transition task: awaiting_completion
      updatedTask = transitionTask(updatedTask, 'awaiting_completion');
      await this.store.tasks.save(updatedTask);

      // 8. Normalize output
      const normalized = normalizeOutput(
        claudeResult.stdout,
        claudeResult.exitCode,
        claudeResult.timedOut,
      );
      await this.store.runs.saveNormalizedOutput(runId, normalized);
      const normalizedOutputPath = path.join(this.store.runs.runsDir, runId, 'normalized.json');

      // 9. Transition task: normalizing_output → awaiting_review
      updatedTask = transitionTask(updatedTask, 'normalizing_output');
      updatedTask = transitionTask(updatedTask, 'awaiting_review');

      // 10. Build and validate delta
      const delta = buildDelta(normalized.proposedDelta, task.id, task.baseStateVersion);
      delta.confidence = normalized.confidence;
      const currentState = await this.store.state.getCurrentState();
      delta.conflicts = validateDelta(delta, currentState, spec);
      await this.store.deltas.save(delta);

      // 11. Link delta to task
      updatedTask = { ...updatedTask, candidateDeltaId: delta.id };
      await this.store.tasks.save(updatedTask);

      // 12. Mark run completed
      run = {
        ...run,
        status: 'completed',
        endedAt: new Date().toISOString(),
        normalizedOutputPath,
      };
      await this.store.runs.save(run);

      // 13. Create MemCell from task run output (non-fatal)
      try {
        const memCell = await createAndExtractMemCell(
          `task:${task.id}`,
          'task_completed',
          claudeResult.stdout,
          {
            goal: currentState.goal,
            phase: currentState.phase,
            decisions: currentState.decisions,
          },
          { workingDirectory: this.workspaceRoot },
        );
        memCell.relatedTaskIds = [task.id];
        await this.store.memcells.save(memCell);
      } catch (memCellErr) {
        console.warn(`[morticus] MemCell extraction failed for run ${runId}: ${(memCellErr as Error).message}`);
      }

      // 14. Cleanup worktree (non-fatal)
      if (worktreeResult.path) {
        await cleanupWorktree(this.workspaceRoot, worktreeResult.path).catch(err => {
          console.warn(`[morticus] worktree cleanup failed: ${(err as Error).message}`);
        });
      }

      return { runId, normalizedOutput: normalized, delta };

    } catch (err) {
      // Mark run as failed; re-throw so the UI can surface the error.
      // Task stays at 'running' — no valid backward transition in the state machine.
      run = { ...run, status: 'failed', endedAt: new Date().toISOString() };
      await this.store.runs.save(run).catch(() => { /* best-effort */ });
      throw err;
    }
  }
}
