import * as vscode from 'vscode';
import type { TaskNode, TaskStatus } from '../../domain/task.js';
import type { ProjectStore } from '../../storage/store.js';

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TaskItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: ProjectStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TaskItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TaskItem): Promise<TaskItem[]> {
    if (element) return [];

    try {
      const initialized = await this.store.isInitialized();
      if (!initialized) return [];

      const tasks = await this.store.tasks.list();
      tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return tasks.map(t => new TaskItem(t));
    } catch {
      return [];
    }
  }
}

const STATUS_ICONS: Record<TaskStatus, string> = {
  draft: '$(edit)',
  ready: '$(check)',
  running: '$(sync~spin)',
  awaiting_completion: '$(clock)',
  normalizing_output: '$(gear)',
  awaiting_review: '$(git-pull-request)',
  merged: '$(pass)',
  rejected: '$(error)',
  archived: '$(archive)',
};

export class TaskItem extends vscode.TreeItem {
  constructor(public readonly task: TaskNode) {
    super(task.title, vscode.TreeItemCollapsibleState.None);
    this.description = `[${task.status}] ${task.taskType}`;
    this.tooltip = `${task.title}\nGoal: ${task.goal}\nStatus: ${task.status}\nType: ${task.taskType}`;
    this.contextValue = `task-${task.status}`;
    this.iconPath = new vscode.ThemeIcon(STATUS_ICONS[task.status]?.replace('$(', '').replace(')', '') || 'circle-outline');
  }
}
