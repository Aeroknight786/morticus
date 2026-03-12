import * as vscode from 'vscode';
import type { TaskRun, RunStatus } from '../../domain/task-run.js';
import type { ProjectStore } from '../../storage/store.js';

const STATUS_ICONS: Record<RunStatus, string> = {
  pending: 'clock',
  running: 'sync~spin',
  completed: 'pass',
  failed: 'error',
  cancelled: 'circle-slash',
};

export class RunTreeProvider implements vscode.TreeDataProvider<RunItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RunItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: ProjectStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: RunItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RunItem): Promise<RunItem[]> {
    if (element) return [];

    try {
      const initialized = await this.store.isInitialized();
      if (!initialized) return [];

      const runs = await this.store.runs.list();
      // Newest first
      runs.sort((a, b) => (b.startedAt ?? b.id).localeCompare(a.startedAt ?? a.id));
      return runs.map(r => new RunItem(r));
    } catch {
      return [];
    }
  }
}

export class RunItem extends vscode.TreeItem {
  constructor(public readonly run: TaskRun) {
    super(run.id, vscode.TreeItemCollapsibleState.None);
    const status = run.status;
    const time = run.startedAt ? new Date(run.startedAt).toLocaleString() : 'pending';
    this.description = `[${status}] ${time}`;
    this.tooltip = `Run: ${run.id}\nTask: ${run.taskId}\nStatus: ${status}\nStarted: ${time}`;
    this.contextValue = `run-${status}`;
    this.iconPath = new vscode.ThemeIcon(STATUS_ICONS[status] ?? 'circle-outline');
    this.command = {
      command: 'morticus.openRunDetail',
      title: 'View Run Details',
      arguments: [this],
    };
  }
}
