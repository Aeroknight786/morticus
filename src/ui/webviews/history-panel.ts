import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { ProjectStore } from '../../storage/store.js';
import type { VersionSummary } from '../../storage/state-store.js';
import { diffStates, type StateDiff } from '../../domain/state-diff.js';

export class HistoryPanel extends WebviewBase {
  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
  ) {
    super(extensionUri, 'morticus.historyPanel', 'State History');
  }

  async show(column?: vscode.ViewColumn): Promise<void> {
    super.show(column);
    await this.loadAndSend();
  }

  private async loadAndSend(): Promise<void> {
    try {
      const versions = await this.store.state.listVersions();
      this.postMessage({ type: 'loadHistory', versions });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load history: ${(err as Error).message}`);
    }
  }

  protected getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h2 { margin-top: 0; }
    .version-item { padding: 10px; margin: 6px 0; background: var(--vscode-input-background); border-left: 3px solid var(--vscode-textLink-foreground); cursor: pointer; }
    .version-item:hover { background: var(--vscode-list-hoverBackground); }
    .version-item.selected { border-left-color: #4caf50; }
    .version-num { font-weight: bold; }
    .version-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .diff-section { margin-top: 16px; padding: 12px; background: var(--vscode-input-background); }
    .diff-title { font-weight: bold; margin-bottom: 8px; }
    .diff-add { color: #4caf50; }
    .diff-remove { color: #f44336; }
    .diff-change { color: #2196f3; }
    .diff-item { padding: 3px 0; font-size: 13px; }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
    .state-detail { margin-top: 12px; padding: 12px; background: var(--vscode-input-background); }
    .field { margin: 4px 0; font-size: 13px; }
    .field-label { font-weight: bold; color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; }
  </style>
</head>
<body>
  <h2>State Version History</h2>
  <div id="timeline"></div>
  <div id="detail"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let versions = [];

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'loadHistory') {
        versions = msg.versions;
        renderTimeline();
      }
      if (msg.type === 'loadDiff') {
        renderDiff(msg.diff, msg.fromVersion, msg.toVersion);
      }
      if (msg.type === 'loadVersionDetail') {
        renderState(msg.state);
      }
    });

    function renderTimeline() {
      const el = document.getElementById('timeline');
      if (versions.length === 0) {
        el.innerHTML = '<div class="empty">No state versions yet.</div>';
        return;
      }
      let html = '';
      for (let i = versions.length - 1; i >= 0; i--) {
        const v = versions[i];
        const date = new Date(v.createdAt).toLocaleString();
        const delta = v.createdFromDeltaId ? ' | delta: ' + v.createdFromDeltaId : ' | initial';
        html += '<div class="version-item" data-version="' + v.version + '">';
        html += '<span class="version-num">v' + v.version + '</span>';
        html += '<div class="version-meta">' + date + delta + '</div>';
        html += '</div>';
      }
      el.innerHTML = html;

      el.querySelectorAll('.version-item').forEach(item => {
        item.addEventListener('click', () => {
          const ver = parseInt(item.getAttribute('data-version'));
          vscode.postMessage({ type: 'selectVersion', version: ver });
          // Also request diff with previous version
          if (ver > 1) {
            vscode.postMessage({ type: 'compareVersions', fromVersion: ver - 1, toVersion: ver });
          }
        });
      });
    }

    function renderDiff(diff, from, to) {
      const el = document.getElementById('detail');
      let html = '<div class="diff-section">';
      html += '<div class="diff-title">Changes: v' + from + ' → v' + to + '</div>';

      let hasChanges = false;
      const pairs = [
        ['Constraints', diff.addedConstraints, diff.removedConstraints],
        ['Decisions', diff.addedDecisions, diff.removedDecisions],
        ['Risks', diff.addedRisks, diff.removedRisks],
        ['Known Files', diff.addedKnownFiles, diff.removedKnownFiles],
      ];
      for (const [name, added, removed] of pairs) {
        for (const a of added) { html += '<div class="diff-item diff-add">+ ' + name + ': ' + esc(a) + '</div>'; hasChanges = true; }
        for (const r of removed) { html += '<div class="diff-item diff-remove">- ' + name + ': ' + esc(r) + '</div>'; hasChanges = true; }
      }
      const fields = [
        ['Goal', diff.goalChanged],
        ['Phase', diff.phaseChanged],
        ['Next Step', diff.nextStepChanged],
      ];
      for (const [name, change] of fields) {
        if (change) {
          html += '<div class="diff-item diff-change">' + name + ': "' + esc(change.from) + '" → "' + esc(change.to) + '"</div>';
          hasChanges = true;
        }
      }
      if (!hasChanges) html += '<div class="empty">No changes</div>';
      html += '</div>';
      el.innerHTML = html;
    }

    function renderState(state) {
      const el = document.getElementById('detail');
      let html = '<div class="state-detail">';
      html += '<div class="field-label">Version</div><div class="field">v' + state.version + '</div>';
      if (state.goal) { html += '<div class="field-label">Goal</div><div class="field">' + esc(state.goal) + '</div>'; }
      if (state.phase) { html += '<div class="field-label">Phase</div><div class="field">' + esc(state.phase) + '</div>'; }
      if (state.constraints.length) { html += '<div class="field-label">Constraints</div><div class="field">' + state.constraints.map(esc).join('<br>') + '</div>'; }
      if (state.decisions.length) { html += '<div class="field-label">Decisions</div><div class="field">' + state.decisions.map(esc).join('<br>') + '</div>'; }
      if (state.risks.length) { html += '<div class="field-label">Risks</div><div class="field">' + state.risks.map(esc).join('<br>') + '</div>'; }
      if (state.nextStep) { html += '<div class="field-label">Next Step</div><div class="field">' + esc(state.nextStep) + '</div>'; }
      html += '</div>';
      el.innerHTML = html;
    }

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  </script>
</body>
</html>`;
  }

  protected async onMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; [key: string]: unknown };

    if (msg.type === 'selectVersion') {
      const version = msg.version as number;
      const state = await this.store.state.getVersion(version);
      this.postMessage({ type: 'loadVersionDetail', state });
    }

    if (msg.type === 'compareVersions') {
      const fromVersion = msg.fromVersion as number;
      const toVersion = msg.toVersion as number;
      const prev = await this.store.state.getVersion(fromVersion);
      const next = await this.store.state.getVersion(toVersion);
      const diff: StateDiff = diffStates(prev, next);
      this.postMessage({ type: 'loadDiff', diff, fromVersion, toVersion });
    }
  }
}
