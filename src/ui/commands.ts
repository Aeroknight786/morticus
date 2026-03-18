import * as vscode from 'vscode';
import { ProjectStore } from '../storage/store.js';
import { generateTaskId } from '../domain/ids.js';
import { createTask, createRetryTask, transitionTask, type TaskType, type TaskStatus } from '../domain/task.js';
import { resolveTaskSpec } from '../compiler/spec-resolver.js';
import { StateTreeProvider } from './tree-views/state-tree-provider.js';
import { TaskTreeProvider, TaskItem } from './tree-views/task-tree-provider.js';
import { MemoryTreeProvider } from './tree-views/memory-tree-provider.js';
import { RunTreeProvider, RunItem } from './tree-views/run-tree-provider.js';
import { StatePanel } from './webviews/state-panel.js';
import { ReviewPanel } from './webviews/review-panel.js';
import { MemoryPanel } from './webviews/memory-panel.js';
import { HistoryPanel } from './webviews/history-panel.js';
import { RunDetailPanel } from './webviews/run-detail-panel.js';
import { ChatPanel } from './webviews/chat-panel.js';
import { StatusBar } from './status-bar.js';
import { RunController } from '../runtime/index.js';
import type { MemoryCategory } from '../domain/durable-memory.js';
import { generateMemoryEntryId } from '../domain/ids.js';

export function registerCommands(
  context: vscode.ExtensionContext,
  store: ProjectStore,
  stateTree: StateTreeProvider,
  taskTree: TaskTreeProvider,
  memoryTree: MemoryTreeProvider,
  runTree: RunTreeProvider,
  statusBar: StatusBar,
): void {
  let statePanel: StatePanel | undefined;
  let reviewPanel: ReviewPanel | undefined;
  let memoryPanel: MemoryPanel | undefined;
  let historyPanel: HistoryPanel | undefined;
  let chatPanel: ChatPanel | undefined;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  const refreshAll = () => {
    stateTree.refresh();
    taskTree.refresh();
    memoryTree.refresh();
    runTree.refresh();
    statusBar.refresh();
  };

  // Initialize Project
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.initializeProject', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Project name',
        placeHolder: 'My Project',
      });
      if (!name) return;

      try {
        await store.initialize(name);
        vscode.commands.executeCommand('setContext', 'morticus.projectInitialized', true);
        vscode.window.showInformationMessage(`Morticus project "${name}" initialized.`);
        refreshAll();
        // Auto-open chat in kickoff mode
        vscode.commands.executeCommand('morticus.openChat');
      } catch (err) {
        vscode.window.showErrorMessage(`Init failed: ${(err as Error).message}`);
      }
    }),
  );

  // Open State Panel
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.openStatePanel', async () => {
      if (!statePanel) {
        statePanel = new StatePanel(context.extensionUri, store, refreshAll);
      }
      await statePanel.show();
    }),
  );

  // Create Task
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.createTask', async () => {
      const taskType = await vscode.window.showQuickPick(
        ['discovery', 'implementation', 'validation'] as TaskType[],
        { placeHolder: 'Task type' },
      ) as TaskType | undefined;
      if (!taskType) return;

      const title = await vscode.window.showInputBox({ prompt: 'Task title' });
      if (!title) return;

      const goal = await vscode.window.showInputBox({ prompt: 'Task goal' });
      if (!goal) return;

      const scopeInput = await vscode.window.showInputBox({
        prompt: 'Scope paths (comma-separated, empty for all)',
        placeHolder: 'src/, lib/',
      });
      const scopePaths = scopeInput ? scopeInput.split(',').map(s => s.trim()).filter(Boolean) : [];

      try {
        const project = await store.getProject();
        const currentVersion = await store.state.getCurrentVersion();
        const readOnly = taskType === 'discovery' || taskType === 'validation';

        const task = createTask(
          generateTaskId(),
          project.id,
          title,
          goal,
          taskType,
          { paths: scopePaths, readOnly, writePermissions: [] },
          currentVersion,
        );
        await store.tasks.save(task);
        vscode.window.showInformationMessage(`Task "${title}" created.`);
        taskTree.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Create task failed: ${(err as Error).message}`);
      }
    }),
  );

  // Compile Task Spec
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.compileTaskSpec', async (item?: TaskItem) => {
      const task = item?.task ?? await pickTask(store, 'draft');
      if (!task) return;

      try {
        const state = await store.state.getCurrentState();
        const memory = await store.memory.get();
        const spec = resolveTaskSpec(task, state, memory);
        await store.specs.save(spec);

        const updated = { ...task, specId: spec.id, updatedAt: new Date().toISOString() };
        const ready = transitionTask(updated, 'ready');
        await store.tasks.save(ready);

        vscode.window.showInformationMessage(`Task spec compiled. Task "${task.title}" is ready.`);
        taskTree.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Compile failed: ${(err as Error).message}`);
      }
    }),
  );

  // Run Task — Phase 2: real Claude CLI execution
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.runTask', async (item?: TaskItem) => {
      const task = item?.task ?? await pickTask(store, 'ready');
      if (!task) return;

      if (!task.specId) {
        vscode.window.showWarningMessage('Task has no compiled spec. Use "Compile Task Spec" first.');
        return;
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      const controller = new RunController({ store, workspaceRoot });
      const abortController = new AbortController();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running: ${task.title}`,
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => abortController.abort());
          progress.report({ message: 'Spawning Claude CLI...' });

          try {
            const { normalizedOutput, delta } = await controller.execute(task, abortController.signal);

            refreshAll();

            const pct = (normalizedOutput.confidence * 100).toFixed(0);
            if (normalizedOutput.confidence === 0) {
              vscode.window.showWarningMessage(
                `Task "${task.title}" completed but produced no structured output. Review the raw output manually.`,
              );
            } else {
              vscode.window.showInformationMessage(
                `Task "${task.title}" done. Confidence: ${pct}%`,
              );
            }

            if (!reviewPanel) {
              reviewPanel = new ReviewPanel(context.extensionUri, store, refreshAll);
            }
            await reviewPanel.showRun(delta, normalizedOutput);

          } catch (err) {
            vscode.window.showErrorMessage(`Run failed: ${(err as Error).message}`);
            refreshAll();
          }
        },
      );
    }),
  );

  // Review Delta
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.reviewDelta', async (item?: TaskItem) => {
      const task = item?.task ?? await pickTask(store, 'awaiting_review');
      if (!task || !task.candidateDeltaId) {
        vscode.window.showWarningMessage('No delta to review.');
        return;
      }

      try {
        const delta = await store.deltas.get(task.candidateDeltaId);
        if (!reviewPanel) {
          reviewPanel = new ReviewPanel(context.extensionUri, store, refreshAll);
        }
        await reviewPanel.showDelta(delta);
      } catch (err) {
        vscode.window.showErrorMessage(`Review failed: ${(err as Error).message}`);
      }
    }),
  );

  // Open Memory Panel
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.openMemoryPanel', async () => {
      if (!memoryPanel) {
        memoryPanel = new MemoryPanel(context.extensionUri, store, () => memoryTree.refresh());
      }
      await memoryPanel.show();
    }),
  );

  // Add Memory Entry (quick-add via input boxes)
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.addMemoryEntry', async () => {
      const categories: MemoryCategory[] = [
        'coding_standard', 'architecture_invariant', 'environment_setup',
        'domain_glossary', 'workflow_preference', 'test_convention', 'custom',
      ];
      const category = await vscode.window.showQuickPick(
        categories.map(c => ({ label: c.replace(/_/g, ' '), value: c })),
        { placeHolder: 'Category' },
      );
      if (!category) return;

      const title = await vscode.window.showInputBox({ prompt: 'Entry title' });
      if (!title) return;

      const content = await vscode.window.showInputBox({ prompt: 'Entry content' });
      if (!content) return;

      try {
        const now = new Date().toISOString();
        await store.memory.addEntry({
          id: generateMemoryEntryId(),
          category: category.value,
          title,
          content,
          origin: 'user',
          active: true,
          reviewed: true,
          normalizedValue: null,
          sourceTaskId: null,
          sourceRunId: null,
          sourceDeltaId: null,
          sourceOperationType: null,
          createdAt: now,
          updatedAt: now,
        });
        vscode.window.showInformationMessage(`Memory entry "${title}" added.`);
        memoryTree.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Add entry failed: ${(err as Error).message}`);
      }
    }),
  );

  // Open History Panel
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.openHistoryPanel', async () => {
      if (!historyPanel) {
        historyPanel = new HistoryPanel(context.extensionUri, store);
      }
      await historyPanel.show();
    }),
  );

  // Open Run Detail
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.openRunDetail', async (item?: RunItem) => {
      try {
        let run;
        if (item?.run) {
          run = item.run;
        } else {
          const runs = await store.runs.list();
          if (runs.length === 0) {
            vscode.window.showWarningMessage('No runs found.');
            return;
          }
          const picked = await vscode.window.showQuickPick(
            runs.map(r => ({
              label: r.id,
              description: `[${r.status}] ${r.startedAt ? new Date(r.startedAt).toLocaleString() : 'pending'}`,
              run: r,
            })),
            { placeHolder: 'Select a run' },
          );
          if (!picked) return;
          run = picked.run;
        }

        const panel = new RunDetailPanel(context.extensionUri, store);
        await panel.showRun(run);
      } catch (err) {
        vscode.window.showErrorMessage(`Open run failed: ${(err as Error).message}`);
      }
    }),
  );

  // Archive Task
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.archiveTask', async (item?: TaskItem) => {
      const task = item?.task ?? await pickTask(store);
      if (!task) return;

      try {
        const archived = transitionTask(task, 'archived');
        const withOutcome = {
          ...archived,
          reviewOutcome: { decision: 'archived' as const, archivedAt: new Date().toISOString() },
        };
        await store.tasks.save(withOutcome);
        vscode.window.showInformationMessage(`Task "${task.title}" archived.`);
        refreshAll();
      } catch (err) {
        vscode.window.showErrorMessage(`Archive failed: ${(err as Error).message}`);
      }
    }),
  );

  // Retry Task (from rejected or archived)
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.retryTask', async (item?: TaskItem) => {
      const task = item?.task ?? await pickTask(store);
      if (!task) return;

      if (task.status !== 'rejected' && task.status !== 'archived') {
        vscode.window.showWarningMessage('Only rejected or archived tasks can be retried.');
        return;
      }

      try {
        const currentVersion = await store.state.getCurrentVersion();
        const retry = createRetryTask(generateTaskId(), task, currentVersion);
        await store.tasks.save(retry);
        vscode.window.showInformationMessage(`Retry task "${retry.title}" created as draft.`);
        refreshAll();
      } catch (err) {
        vscode.window.showErrorMessage(`Retry failed: ${(err as Error).message}`);
      }
    }),
  );

  // Edit Task (draft only)
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.editTask', async (item?: TaskItem) => {
      const task = item?.task ?? await pickTask(store, 'draft');
      if (!task) return;

      const title = await vscode.window.showInputBox({ prompt: 'Task title', value: task.title });
      if (title === undefined) return;

      const goal = await vscode.window.showInputBox({ prompt: 'Task goal', value: task.goal });
      if (goal === undefined) return;

      const scopeInput = await vscode.window.showInputBox({
        prompt: 'Scope paths (comma-separated)',
        value: task.scope.paths.join(', '),
      });
      if (scopeInput === undefined) return;

      try {
        const scopePaths = scopeInput ? scopeInput.split(',').map(s => s.trim()).filter(Boolean) : [];
        const updated = {
          ...task,
          title: title || task.title,
          goal: goal || task.goal,
          scope: { ...task.scope, paths: scopePaths },
          updatedAt: new Date().toISOString(),
        };
        await store.tasks.save(updated);
        vscode.window.showInformationMessage(`Task "${updated.title}" updated.`);
        refreshAll();
      } catch (err) {
        vscode.window.showErrorMessage(`Edit failed: ${(err as Error).message}`);
      }
    }),
  );

  // Open Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.openChat', async () => {
      if (!chatPanel) {
        chatPanel = new ChatPanel(context.extensionUri, store, workspaceRoot, refreshAll, async (delta) => {
          if (!reviewPanel) {
            reviewPanel = new ReviewPanel(context.extensionUri, store, refreshAll);
          }
          await reviewPanel.showDelta(delta);
        });
      }
      await chatPanel.showChat();
    }),
  );

  // Refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('morticus.refreshAll', refreshAll),
  );
}

async function pickTask(store: ProjectStore, statusFilter?: TaskStatus) {
  const tasks = await store.tasks.list();
  const filtered = statusFilter ? tasks.filter(t => t.status === statusFilter) : tasks;
  if (filtered.length === 0) {
    vscode.window.showWarningMessage(`No tasks with status "${statusFilter || 'any'}".`);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    filtered.map(t => ({ label: t.title, description: `[${t.status}] ${t.taskType}`, task: t })),
    { placeHolder: 'Select a task' },
  );
  return picked?.task;
}
