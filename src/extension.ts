import * as vscode from 'vscode';
import { ProjectStore } from './storage/store.js';
import { StateTreeProvider } from './ui/tree-views/state-tree-provider.js';
import { TaskTreeProvider } from './ui/tree-views/task-tree-provider.js';
import { MemoryTreeProvider } from './ui/tree-views/memory-tree-provider.js';
import { RunTreeProvider } from './ui/tree-views/run-tree-provider.js';
import { StatusBar } from './ui/status-bar.js';
import { registerCommands } from './ui/commands.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;
  const store = new ProjectStore(workspacePath);

  // Tree views
  const stateTree = new StateTreeProvider(store);
  const taskTree = new TaskTreeProvider(store);
  const memoryTree = new MemoryTreeProvider(store);
  const runTree = new RunTreeProvider(store);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('morticus-state', stateTree),
    vscode.window.registerTreeDataProvider('morticus-tasks', taskTree),
    vscode.window.registerTreeDataProvider('morticus-memory', memoryTree),
    vscode.window.registerTreeDataProvider('morticus-runs', runTree),
  );

  // Status bar
  const statusBar = new StatusBar(store);
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // Commands
  registerCommands(context, store, stateTree, taskTree, memoryTree, runTree, statusBar);

  // Set initial context
  const initialized = await store.isInitialized();
  vscode.commands.executeCommand('setContext', 'morticus.projectInitialized', initialized);

  if (initialized) {
    statusBar.refresh();
  }
}

export function deactivate(): void {
  // cleanup handled by disposables
}
