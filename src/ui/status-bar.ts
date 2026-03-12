import * as vscode from 'vscode';
import type { ProjectStore } from '../storage/store.js';

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor(private store: ProjectStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'morticus.openStatePanel';
  }

  async refresh(): Promise<void> {
    try {
      const initialized = await this.store.isInitialized();
      if (!initialized) {
        this.item.hide();
        return;
      }
      const project = await this.store.getProject();
      const version = await this.store.state.getCurrentVersion();
      this.item.text = `$(symbol-structure) ${project.name} v${version}`;
      this.item.tooltip = 'Open Canonical State';
      this.item.show();
    } catch {
      this.item.hide();
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
