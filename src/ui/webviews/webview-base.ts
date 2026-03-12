import * as vscode from 'vscode';

export abstract class WebviewBase {
  protected panel: vscode.WebviewPanel | undefined;

  constructor(
    protected readonly extensionUri: vscode.Uri,
    protected readonly viewType: string,
    protected readonly title: string,
  ) {}

  show(column: vscode.ViewColumn = vscode.ViewColumn.One): void {
    if (this.panel) {
      this.panel.reveal(column);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      this.viewType,
      this.title,
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
    this.panel.onDidDispose(() => { this.panel = undefined; });
  }

  protected postMessage(message: unknown): void {
    this.panel?.webview.postMessage(message);
  }

  protected abstract getHtml(): string;
  protected abstract onMessage(message: unknown): void;

  dispose(): void {
    this.panel?.dispose();
  }
}
