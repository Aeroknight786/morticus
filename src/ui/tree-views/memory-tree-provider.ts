import * as vscode from 'vscode';
import type { MemoryEntry, MemoryCategory } from '../../domain/durable-memory.js';
import type { ProjectStore } from '../../storage/store.js';

type MemoryTreeItem = CategoryItem | EntryItem;

export class MemoryTreeProvider implements vscode.TreeDataProvider<MemoryTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MemoryTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: ProjectStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MemoryTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MemoryTreeItem): Promise<MemoryTreeItem[]> {
    try {
      const initialized = await this.store.isInitialized();
      if (!initialized) return [];

      const memory = await this.store.memory.get();

      if (!element) {
        // Top level: categories that have entries
        const categories = new Map<MemoryCategory, MemoryEntry[]>();
        for (const entry of memory.entries) {
          const list = categories.get(entry.category) ?? [];
          list.push(entry);
          categories.set(entry.category, list);
        }
        return Array.from(categories.entries()).map(
          ([cat, entries]) => new CategoryItem(cat, entries.length),
        );
      }

      if (element instanceof CategoryItem) {
        return memory.entries
          .filter(e => e.category === element.category)
          .map(e => new EntryItem(e));
      }

      return [];
    } catch {
      return [];
    }
  }
}

class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly category: MemoryCategory,
    count: number,
  ) {
    super(category.replace(/_/g, ' '), vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'memory-category';
  }
}

export class EntryItem extends vscode.TreeItem {
  constructor(public readonly entry: MemoryEntry) {
    super(entry.title, vscode.TreeItemCollapsibleState.None);
    const originBadge = entry.origin === 'auto_extracted' ? ' [auto]' : '';
    const activeBadge = entry.active ? '' : ' (inactive)';
    const reviewBadge = !entry.reviewed ? ' [unreviewed]' : '';
    this.description = `${originBadge}${activeBadge}${reviewBadge}`;
    this.tooltip = `${entry.title}\nCategory: ${entry.category}\nOrigin: ${entry.origin}\nActive: ${entry.active}\nReviewed: ${entry.reviewed}`;
    this.contextValue = `memory-entry-${entry.origin}`;
    this.iconPath = new vscode.ThemeIcon(entry.active ? 'circle-filled' : 'circle-outline');
  }
}
