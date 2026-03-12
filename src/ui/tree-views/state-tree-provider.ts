import * as vscode from 'vscode';
import type { CanonicalProjectState } from '../../domain/canonical-state.js';
import type { ProjectStore } from '../../storage/store.js';

export class StateTreeProvider implements vscode.TreeDataProvider<StateItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StateItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: ProjectStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: StateItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: StateItem): Promise<StateItem[]> {
    if (element) return [];

    try {
      const initialized = await this.store.isInitialized();
      if (!initialized) return [];

      const state = await this.store.state.getCurrentState();
      return this.stateToItems(state);
    } catch {
      return [];
    }
  }

  private stateToItems(state: CanonicalProjectState): StateItem[] {
    const items: StateItem[] = [];

    items.push(new StateItem(`v${state.version}`, 'Version', vscode.TreeItemCollapsibleState.None));

    if (state.goal) {
      items.push(new StateItem(state.goal, 'Goal', vscode.TreeItemCollapsibleState.None));
    }
    if (state.phase) {
      items.push(new StateItem(state.phase, 'Phase', vscode.TreeItemCollapsibleState.None));
    }
    if (state.phaseGoal) {
      items.push(new StateItem(state.phaseGoal, 'Phase Goal', vscode.TreeItemCollapsibleState.None));
    }
    if (state.constraints.length) {
      items.push(new StateItem(`${state.constraints.length} constraints`, 'Constraints', vscode.TreeItemCollapsibleState.None));
    }
    if (state.decisions.length) {
      items.push(new StateItem(`${state.decisions.length} decisions`, 'Decisions', vscode.TreeItemCollapsibleState.None));
    }
    if (state.risks.length) {
      items.push(new StateItem(`${state.risks.length} risks`, 'Risks', vscode.TreeItemCollapsibleState.None));
    }
    if (state.nextStep) {
      items.push(new StateItem(state.nextStep, 'Next Step', vscode.TreeItemCollapsibleState.None));
    }

    return items;
  }
}

class StateItem extends vscode.TreeItem {
  constructor(
    public readonly value: string,
    public readonly field: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(`${field}: ${value}`, collapsibleState);
    this.tooltip = `${field}: ${value}`;
    this.contextValue = 'state-field';
  }
}
