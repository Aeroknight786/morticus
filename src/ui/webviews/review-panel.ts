import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { StateDelta } from '../../domain/state-delta.js';
import type { NormalizedOutput } from '../../domain/task-run.js';
import type { ProjectStore } from '../../storage/store.js';
import { applyAcceptedDelta } from '../../review/delta-applier.js';
import { extractKnowledge, deduplicateEntries } from '../../review/knowledge-extractor.js';

export class ReviewPanel extends WebviewBase {
  private delta: StateDelta | null = null;

  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
    private onMerged: () => void,
  ) {
    super(extensionUri, 'morticus.reviewPanel', 'Review State Delta');
  }

  async showDelta(delta: StateDelta): Promise<void> {
    this.delta = delta;
    super.show(vscode.ViewColumn.One);
    this.postMessage({ type: 'loadDelta', delta });
  }

  // Called after a real run: shows both Claude's output summary and the delta.
  async showRun(delta: StateDelta, normalized: NormalizedOutput): Promise<void> {
    this.delta = delta;
    super.show(vscode.ViewColumn.One);
    this.postMessage({ type: 'loadDelta', delta });
    this.postMessage({ type: 'loadRunContext', normalized });
  }

  protected getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h2 { margin-top: 0; }
    .op { padding: 8px; margin: 4px 0; background: var(--vscode-input-background); border-left: 3px solid var(--vscode-textLink-foreground); }
    .op-add { border-left-color: #4caf50; }
    .op-remove { border-left-color: #f44336; }
    .op-set { border-left-color: #2196f3; }
    .conflict { padding: 8px; margin: 4px 0; background: var(--vscode-inputValidation-warningBackground); border-left: 3px solid var(--vscode-inputValidation-warningBorder); }
    .conflict.error { background: var(--vscode-inputValidation-errorBackground); border-left-color: var(--vscode-inputValidation-errorBorder); }
    .meta { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .actions { margin-top: 16px; }
    button { padding: 8px 16px; margin-right: 8px; border: none; cursor: pointer; font-size: 13px; }
    .accept { background: #4caf50; color: white; }
    .reject { background: #f44336; color: white; }
  </style>
</head>
<body>
  <h2>Review State Delta</h2>
  <div class="meta" id="meta"></div>
  <details id="claude-output-section" style="margin-bottom:12px;display:none">
    <summary style="cursor:pointer;font-weight:bold">Claude's Output (click to expand)</summary>
    <div id="run-summary" style="padding:8px;margin:4px 0;background:var(--vscode-input-background);white-space:pre-wrap;font-size:13px"></div>
    <div id="confidence-line" style="padding:4px 8px;font-size:12px;opacity:0.8"></div>
    <div id="run-unresolved"></div>
  </details>
  <div id="conflicts"></div>
  <h3>Operations</h3>
  <div id="operations"></div>
  <div class="actions">
    <button class="accept" id="accept">Accept Delta</button>
    <button class="reject" id="reject">Reject Delta</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'loadRunContext') {
        const n = msg.normalized;
        const section = document.getElementById('claude-output-section');
        section.style.display = '';
        document.getElementById('run-summary').textContent = n.summary;
        document.getElementById('confidence-line').textContent =
          'Confidence: ' + (n.confidence * 100).toFixed(0) + '%  |  ' + n.completionReason;
        const issuesEl = document.getElementById('run-unresolved');
        issuesEl.innerHTML = '';
        for (const issue of n.unresolvedIssues) {
          const div = document.createElement('div');
          div.className = 'conflict';
          div.textContent = issue;
          issuesEl.appendChild(div);
        }
      }
      if (msg.type === 'loadDelta') {
        const delta = msg.delta;
        document.getElementById('meta').textContent =
          'Base state: v' + delta.baseStateVersion +
          ' | Confidence: ' + (delta.confidence * 100).toFixed(0) + '%' +
          ' | Operations: ' + delta.operations.length;

        const conflictsEl = document.getElementById('conflicts');
        conflictsEl.innerHTML = '';
        for (const c of delta.conflicts) {
          const div = document.createElement('div');
          div.className = 'conflict' + (c.severity === 'error' ? ' error' : '');
          div.textContent = '[' + c.severity.toUpperCase() + '] ' + c.description;
          conflictsEl.appendChild(div);
        }

        const opsEl = document.getElementById('operations');
        opsEl.innerHTML = '';
        for (const op of delta.operations) {
          const div = document.createElement('div');
          const isAdd = op.type.startsWith('add_');
          const isRemove = op.type.startsWith('remove_');
          div.className = 'op' + (isAdd ? ' op-add' : isRemove ? ' op-remove' : ' op-set');
          div.textContent = op.type + ': ' + (op.value || op.path || '');
          opsEl.appendChild(div);
        }
      }
    });

    document.getElementById('accept').addEventListener('click', () => {
      vscode.postMessage({ type: 'accept' });
    });

    document.getElementById('reject').addEventListener('click', () => {
      vscode.postMessage({ type: 'reject' });
    });
  </script>
</body>
</html>`;
  }

  protected async onMessage(message: unknown): Promise<void> {
    const msg = message as { type: string };
    if (!this.delta) return;

    if (msg.type === 'accept') {
      try {
        const currentState = await this.store.state.getCurrentState();
        const result = await applyAcceptedDelta(this.delta, currentState, this.store.state, this.store.deltas);

        const project = await this.store.getProject();
        project.currentStateVersion = result.newState.version;
        await this.store.updateProject(project);

        // Auto-extract knowledge from accepted decisions
        let extractedCount = 0;
        if (this.delta.operations.length > 0) {
          let taskTitle = 'Chat proposal';
          if (this.delta.taskId) {
            try {
              const task = await this.store.tasks.get(this.delta.taskId);
              taskTitle = task.title;
            } catch {
              // Task may have been deleted; use fallback title
            }
          }
          const latestRunId = null; // RunId is on the task, not the delta
          const candidates = extractKnowledge(
            this.delta.operations,
            taskTitle,
            this.delta.taskId,
            latestRunId,
            this.delta.id,
          );

          if (candidates.length > 0) {
            const memory = await this.store.memory.get();
            const newEntries = deduplicateEntries(candidates, memory.entries);
            for (const entry of newEntries) {
              await this.store.memory.addEntry(entry);
            }
            extractedCount = newEntries.length;
          }
        }

        let message = `Delta accepted. State updated to v${result.newState.version}.`;
        if (extractedCount > 0) {
          message += ` ${extractedCount} new memory ${extractedCount === 1 ? 'entry' : 'entries'} extracted from decisions. Open Memory Panel to review.`;
          const action = await vscode.window.showInformationMessage(message, 'Open Memory');
          if (action === 'Open Memory') {
            vscode.commands.executeCommand('morticus.openMemoryPanel');
          }
        } else {
          vscode.window.showInformationMessage(message);
        }

        this.onMerged();
        this.panel?.dispose();
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to apply delta: ${(err as Error).message}`);
      }
    } else if (msg.type === 'reject') {
      this.delta = { ...this.delta, status: 'rejected', reviewedAt: new Date().toISOString() };
      await this.store.deltas.save(this.delta);
      vscode.window.showInformationMessage('Delta rejected.');
      this.onMerged();
      this.panel?.dispose();
    }
  }
}
