import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { ProjectStore } from '../../storage/store.js';
import type { TaskNode } from '../../domain/task.js';

export type TaskDetailAction = 'compile' | 'run' | 'review' | 'archive' | 'retry';

export class TaskDetailPanel extends WebviewBase {
  private task: TaskNode | null = null;

  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
    private onAction: (action: TaskDetailAction, task: TaskNode) => Promise<void>,
  ) {
    super(extensionUri, 'morticus.taskDetailPanel', 'Task Detail');
  }

  async showTask(task: TaskNode): Promise<void> {
    this.task = task;
    super.show(vscode.ViewColumn.One);

    let spec = null;
    if (task.specId) {
      try { spec = await this.store.specs.get(task.specId); } catch { /* missing spec */ }
    }

    const runs = await this.store.runs.listByTask(task.id);
    runs.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));

    let delta = null;
    if (task.candidateDeltaId) {
      try { delta = await this.store.deltas.get(task.candidateDeltaId); } catch { /* missing delta */ }
    }

    this.postMessage({ type: 'loadTask', task, spec, runs, delta });
  }

  protected getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h2 { margin-top: 0; }
    .section { margin-bottom: 16px; padding: 12px; background: var(--vscode-input-background); border-radius: 6px; }
    .section h3 { margin: 0 0 8px 0; font-size: 13px; color: var(--vscode-textLink-foreground); }
    .field { margin: 4px 0; font-size: 13px; }
    .label { font-weight: bold; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold; color: white; }
    .badge-draft { background: #888; }
    .badge-ready { background: #2196f3; }
    .badge-running { background: #ff9800; }
    .badge-awaiting_completion, .badge-normalizing_output { background: #ff9800; }
    .badge-awaiting_review { background: #e65100; }
    .badge-merged { background: #4caf50; }
    .badge-rejected { background: #f44336; }
    .badge-archived { background: #9e9e9e; }
    .run-item { padding: 6px 8px; margin: 4px 0; background: var(--vscode-editor-background); border-left: 3px solid var(--vscode-textLink-foreground); font-size: 12px; }
    .delta-op { padding: 4px 8px; margin: 2px 0; font-size: 12px; border-left: 3px solid var(--vscode-textLink-foreground); }
    .delta-op.op-add { border-left-color: #4caf50; }
    .delta-op.op-remove { border-left-color: #f44336; }
    .delta-op.op-set { border-left-color: #2196f3; }
    #action-bar { margin-top: 16px; display: flex; gap: 8px; }
    #action-bar button { padding: 8px 16px; border: none; cursor: pointer; font-size: 13px; border-radius: 4px; }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .empty { color: var(--vscode-descriptionForeground); font-size: 12px; font-style: italic; }
  </style>
</head>
<body>
  <div id="task-header"></div>
  <div id="task-goal" class="section"></div>
  <div id="spec-section" class="section"></div>
  <div id="runs-section" class="section"></div>
  <div id="delta-section" class="section" style="display:none"></div>
  <div id="action-bar"></div>

  <script>
    const vscode = acquireVsCodeApi();

    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s || '';
      return d.innerHTML;
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'loadTask') {
        renderTask(msg.task, msg.spec, msg.runs, msg.delta);
      }
    });

    function renderTask(task, spec, runs, delta) {
      document.getElementById('task-header').innerHTML =
        '<h2>' + esc(task.title) + ' <span class="badge badge-' + task.status + '">' + task.status.replace(/_/g, ' ') + '</span></h2>' +
        '<div class="field"><span class="label">Type</span> ' + esc(task.taskType) + '</div>' +
        '<div class="field"><span class="label">Scope</span> ' + (task.scope.paths.length ? esc(task.scope.paths.join(', ')) : 'entire project') + '</div>' +
        '<div class="field"><span class="label">Base State</span> v' + task.baseStateVersion + '</div>';

      document.getElementById('task-goal').innerHTML =
        '<h3>Goal</h3><div>' + esc(task.goal) + '</div>';

      var specEl = document.getElementById('spec-section');
      if (spec) {
        var tools = spec.allowedTools ? spec.allowedTools.join(', ') : 'none';
        var write = spec.writePermissions ? spec.writePermissions.join(', ') : 'none';
        specEl.innerHTML =
          '<h3>Compiled Spec</h3>' +
          '<div class="field"><span class="label">Tools</span> ' + esc(tools) + '</div>' +
          '<div class="field"><span class="label">Write Permissions</span> ' + esc(write) + '</div>' +
          '<div class="field"><span class="label">Est. Tokens</span> ' + (spec.contextPack ? spec.contextPack.estimatedTokens : 'N/A') + '</div>' +
          '<div class="field"><span class="label">Compiled</span> ' + esc(spec.compiledAt) + '</div>';
      } else {
        specEl.innerHTML = '<h3>Compiled Spec</h3><div class="empty">Not compiled yet</div>';
      }

      var runsEl = document.getElementById('runs-section');
      if (runs.length > 0) {
        var runsHtml = '<h3>Run History (' + runs.length + ')</h3>';
        runs.forEach(function(run) {
          var duration = '';
          if (run.startedAt && run.endedAt) {
            var ms = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
            duration = ' \\u2014 ' + (ms / 1000).toFixed(1) + 's';
          }
          runsHtml += '<div class="run-item">' +
            '<strong>' + run.status + '</strong>' + duration +
            (run.id ? ' <span style="opacity:0.6;font-size:11px">(' + run.id.slice(0, 8) + ')</span>' : '') +
          '</div>';
        });
        runsEl.innerHTML = runsHtml;
      } else {
        runsEl.innerHTML = '<h3>Run History</h3><div class="empty">No runs yet</div>';
      }

      var deltaEl = document.getElementById('delta-section');
      if (delta && delta.operations && delta.operations.length > 0) {
        deltaEl.style.display = '';
        var deltaHtml = '<h3>Candidate Delta (' + delta.operations.length + ' ops)</h3>';
        delta.operations.forEach(function(op) {
          var isAdd = op.type.startsWith('add_');
          var isRemove = op.type.startsWith('remove_');
          var cls = isAdd ? 'op-add' : isRemove ? 'op-remove' : 'op-set';
          var val = op.value || op.path || '';
          deltaHtml += '<div class="delta-op ' + cls + '">' + op.type.replace(/_/g, ' ') + (val ? ': ' + esc(val) : '') + '</div>';
        });
        deltaEl.innerHTML = deltaHtml;
      } else {
        deltaEl.style.display = 'none';
      }

      var actionEl = document.getElementById('action-bar');
      var btns = '';
      if (task.status === 'draft') btns += '<button class="btn-primary" data-action="compile">Compile Spec</button>';
      if (task.status === 'ready') btns += '<button class="btn-primary" data-action="run">Run Task</button>';
      if (task.status === 'awaiting_review') btns += '<button class="btn-primary" data-action="review">Review Delta</button>';
      var terminalStatuses = ['merged', 'rejected', 'archived'];
      if (!terminalStatuses.includes(task.status)) btns += '<button class="btn-secondary" data-action="archive">Archive</button>';
      if (task.status === 'rejected' || task.status === 'archived') btns += '<button class="btn-secondary" data-action="retry">Retry</button>';
      actionEl.innerHTML = btns;

      actionEl.querySelectorAll('button[data-action]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          vscode.postMessage({ type: 'action', action: btn.getAttribute('data-action') });
        });
      });
    }
  </script>
</body>
</html>`;
  }

  protected async onMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; action?: string };
    if (msg.type === 'action' && msg.action && this.task) {
      await this.onAction(msg.action as TaskDetailAction, this.task);
    }
  }
}
