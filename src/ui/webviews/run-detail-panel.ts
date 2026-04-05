import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { TaskRun } from '../../domain/task-run.js';
import type { ProjectStore } from '../../storage/store.js';

export class RunDetailPanel extends WebviewBase {
  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
  ) {
    super(extensionUri, 'morticus.runDetailPanel', 'Run Details');
  }

  async showRun(run: TaskRun): Promise<void> {
    super.show(vscode.ViewColumn.One);

    const rawOutput = await this.store.runs.getRawOutput(run.id);
    const normalized = await this.store.runs.getNormalizedOutput(run.id);

    this.postMessage({
      type: 'loadRun',
      run,
      rawOutput: rawOutput ?? '(no raw output available)',
      normalized,
    });
  }

  protected getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h2 { margin-top: 0; }
    .section { margin-bottom: 16px; }
    .label { font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .value { font-size: 13px; padding: 6px 8px; background: var(--vscode-input-background); margin-bottom: 8px; }
    .metric { display: inline-block; padding: 4px 10px; margin-right: 8px; background: var(--vscode-input-background); border-left: 3px solid var(--vscode-textLink-foreground); font-size: 12px; }
    .op { padding: 6px 8px; margin: 3px 0; background: var(--vscode-input-background); border-left: 3px solid var(--vscode-textLink-foreground); font-size: 13px; }
    .op-add { border-left-color: #4caf50; }
    .op-remove { border-left-color: #f44336; }
    .op-set { border-left-color: #2196f3; }
    .issue { padding: 6px 8px; margin: 3px 0; background: var(--vscode-inputValidation-warningBackground); font-size: 13px; }
    pre { padding: 8px; background: var(--vscode-input-background); overflow: auto; max-height: 400px; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
    details { margin-top: 12px; }
    summary { cursor: pointer; font-weight: bold; }
  </style>
</head>
<body>
  <h2>Run Details</h2>
  <div id="content"></div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'loadRun') {
        const run = msg.run;
        const normalized = msg.normalized;
        const rawOutput = msg.rawOutput;
        const el = document.getElementById('content');
        let html = '';

        // Header
        html += '<div class="section">';
        html += '<div class="label">Run ID</div><div class="value">' + esc(run.id) + '</div>';
        html += '<div class="label">Task</div><div class="value">' + esc(run.taskId) + '</div>';
        html += '<div class="label">Status</div><div class="value">' + esc(run.status) + '</div>';
        html += '<div class="label">Provider</div><div class="value">' + esc(run.provider || 'claude') + '</div>';
        html += '</div>';

        // Timing
        if (run.startedAt) {
          html += '<div class="section">';
          html += '<div class="label">Timing</div>';
          html += '<div class="value">Started: ' + esc(run.startedAt);
          if (run.endedAt) {
            const dur = ((new Date(run.endedAt) - new Date(run.startedAt)) / 1000).toFixed(1);
            html += ' | Ended: ' + esc(run.endedAt) + ' | Duration: ' + dur + 's';
          }
          html += '</div></div>';
        }

        // Context cost metrics
        if (run.contextMetrics) {
          const cm = run.contextMetrics;
          html += '<div class="section">';
          html += '<div class="label">Context Cost</div>';
          html += '<div class="metric">Tokens: ~' + cm.estimatedTokens + '</div>';
          html += '<div class="metric">Memory: ' + (cm.memoryIncluded != null ? cm.memoryIncluded + ' included' : cm.activeMemoryEntryCount + ' entries') + '</div>';
          if (cm.memoryExcluded) {
            html += '<div class="metric">Memory excluded: ' + cm.memoryExcluded + '</div>';
          }
          html += '<div class="metric">Stable prefix: ' + cm.stablePrefixLength + ' chars</div>';
          if (cm.contextDiagnostics) {
            html += '<details style="margin-top:8px"><summary style="font-size:12px;cursor:pointer">Context Diagnostics</summary><pre style="font-size:11px;margin-top:4px">' + esc(cm.contextDiagnostics) + '</pre></details>';
          }
          html += '</div>';
        }

        // Normalized output
        if (normalized) {
          html += '<div class="section">';
          html += '<div class="label">Summary</div><div class="value">' + esc(normalized.summary) + '</div>';
          html += '<div class="label">Confidence</div><div class="value">' + (normalized.confidence * 100).toFixed(0) + '% | ' + esc(normalized.completionReason) + '</div>';

          if (normalized.unresolvedIssues && normalized.unresolvedIssues.length > 0) {
            html += '<div class="label">Unresolved Issues</div>';
            for (const issue of normalized.unresolvedIssues) {
              html += '<div class="issue">' + esc(issue) + '</div>';
            }
          }

          if (normalized.proposedDelta) {
            const pd = normalized.proposedDelta;
            const ops = [];
            for (const c of pd.addConstraints || []) ops.push({ type: 'add_constraint', value: c });
            for (const c of pd.removeConstraints || []) ops.push({ type: 'remove_constraint', value: c });
            for (const d of pd.addDecisions || []) ops.push({ type: 'add_decision', value: d });
            for (const d of pd.removeDecisions || []) ops.push({ type: 'remove_decision', value: d });
            for (const r of pd.addRisks || []) ops.push({ type: 'add_risk', value: r });
            for (const r of pd.removeRisks || []) ops.push({ type: 'remove_risk', value: r });
            for (const f of pd.addKnownFiles || []) ops.push({ type: 'add_known_file', value: f });
            for (const f of pd.removeKnownFiles || []) ops.push({ type: 'remove_known_file', value: f });
            if (pd.setGoal) ops.push({ type: 'set_goal', value: pd.setGoal });
            if (pd.setPhase) ops.push({ type: 'set_phase', value: pd.setPhase });
            if (pd.setNextStep) ops.push({ type: 'set_next_step', value: pd.setNextStep });

            if (ops.length > 0) {
              html += '<div class="label">Proposed Operations (' + ops.length + ')</div>';
              for (const op of ops) {
                const cls = op.type.startsWith('add_') ? 'op-add' : op.type.startsWith('remove_') ? 'op-remove' : 'op-set';
                html += '<div class="op ' + cls + '">' + esc(op.type) + ': ' + esc(op.value) + '</div>';
              }
            }
          }
          html += '</div>';
        }

        // Raw output
        html += '<details><summary>Raw Output</summary><pre>' + esc(rawOutput) + '</pre></details>';

        el.innerHTML = html;
      }
    });

    function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  </script>
</body>
</html>`;
  }

  protected onMessage(_message: unknown): void {
    // Read-only panel — no messages to handle
  }
}
