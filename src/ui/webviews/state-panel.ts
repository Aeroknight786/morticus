import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { CanonicalProjectState } from '../../domain/canonical-state.js';
import { applyDeltaOperations } from '../../domain/canonical-state.js';
import { generateDeltaId } from '../../domain/ids.js';
import type { DeltaOperation } from '../../domain/state-delta.js';
import type { ProjectStore } from '../../storage/store.js';

export class StatePanel extends WebviewBase {
  private currentState: CanonicalProjectState | null = null;

  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
    private onStateChanged: () => void,
  ) {
    super(extensionUri, 'morticus.statePanel', 'Canonical State');
  }

  async show(column?: vscode.ViewColumn): Promise<void> {
    super.show(column);
    await this.loadAndSend();
  }

  private async loadAndSend(): Promise<void> {
    try {
      this.currentState = await this.store.state.getCurrentState();
      this.postMessage({ type: 'loadState', state: this.currentState });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load state: ${(err as Error).message}`);
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
    label { display: block; margin-top: 12px; font-weight: bold; font-size: 12px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    input, textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; margin-top: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-font-family); font-size: 13px; }
    textarea { min-height: 80px; resize: vertical; }
    .version { color: var(--vscode-descriptionForeground); font-size: 12px; }
    button { margin-top: 16px; padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; font-size: 13px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  </style>
</head>
<body>
  <h2>Canonical Project State <span class="version" id="version"></span></h2>

  <label>Goal</label>
  <input id="goal" placeholder="What is this project trying to achieve?" />

  <label>Phase</label>
  <input id="phase" placeholder="Current development phase" />

  <label>Phase Goal</label>
  <input id="phaseGoal" placeholder="What this phase aims to achieve" />

  <label>Constraints</label>
  <textarea id="constraints" placeholder="One constraint per line"></textarea>
  <div class="hint">One per line</div>

  <label>Decisions</label>
  <textarea id="decisions" placeholder="One decision per line"></textarea>
  <div class="hint">One per line</div>

  <label>Risks</label>
  <textarea id="risks" placeholder="One risk per line"></textarea>
  <div class="hint">One per line</div>

  <label>Known Files</label>
  <textarea id="knownFiles" placeholder="One file path per line"></textarea>
  <div class="hint">One per line</div>

  <label>Next Step</label>
  <input id="nextStep" placeholder="What should happen next?" />

  <button id="save">Save State</button>

  <script>
    const vscode = acquireVsCodeApi();
    let currentState = null;

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'loadState') {
        currentState = msg.state;
        document.getElementById('version').textContent = 'v' + currentState.version;
        document.getElementById('goal').value = currentState.goal || '';
        document.getElementById('phase').value = currentState.phase || '';
        document.getElementById('phaseGoal').value = currentState.phaseGoal || '';
        document.getElementById('constraints').value = (currentState.constraints || []).join('\\n');
        document.getElementById('decisions').value = (currentState.decisions || []).join('\\n');
        document.getElementById('risks').value = (currentState.risks || []).join('\\n');
        document.getElementById('knownFiles').value = (currentState.knownFiles || []).join('\\n');
        document.getElementById('nextStep').value = currentState.nextStep || '';
      }
    });

    document.getElementById('save').addEventListener('click', () => {
      const toLines = id => document.getElementById(id).value.split('\\n').map(s => s.trim()).filter(Boolean);
      vscode.postMessage({
        type: 'saveState',
        fields: {
          goal: document.getElementById('goal').value,
          phase: document.getElementById('phase').value,
          phaseGoal: document.getElementById('phaseGoal').value,
          constraints: toLines('constraints'),
          decisions: toLines('decisions'),
          risks: toLines('risks'),
          knownFiles: toLines('knownFiles'),
          nextStep: document.getElementById('nextStep').value,
        }
      });
    });
  </script>
</body>
</html>`;
  }

  protected async onMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; fields?: Record<string, unknown> };
    if (msg.type === 'saveState' && msg.fields && this.currentState) {
      const f = msg.fields as {
        goal: string; phase: string; phaseGoal: string;
        constraints: string[]; decisions: string[]; risks: string[];
        knownFiles: string[]; nextStep: string;
      };

      // Build delta operations from changes
      const ops: DeltaOperation[] = [];
      if (f.goal !== this.currentState.goal) ops.push({ type: 'set_goal', value: f.goal });
      if (f.phase !== this.currentState.phase) ops.push({ type: 'set_phase', value: f.phase });
      if (f.phaseGoal !== this.currentState.phaseGoal) ops.push({ type: 'set_phase_goal', value: f.phaseGoal });
      if (f.nextStep !== this.currentState.nextStep) ops.push({ type: 'set_next_step', value: f.nextStep });

      // Constraints diff
      for (const c of f.constraints) {
        if (!this.currentState.constraints.includes(c)) ops.push({ type: 'add_constraint', value: c });
      }
      for (const c of this.currentState.constraints) {
        if (!f.constraints.includes(c)) ops.push({ type: 'remove_constraint', value: c });
      }
      // Decisions diff
      for (const d of f.decisions) {
        if (!this.currentState.decisions.includes(d)) ops.push({ type: 'add_decision', value: d });
      }
      for (const d of this.currentState.decisions) {
        if (!f.decisions.includes(d)) ops.push({ type: 'remove_decision', value: d });
      }
      // Risks diff
      for (const r of f.risks) {
        if (!this.currentState.risks.includes(r)) ops.push({ type: 'add_risk', value: r });
      }
      for (const r of this.currentState.risks) {
        if (!f.risks.includes(r)) ops.push({ type: 'remove_risk', value: r });
      }
      // Known files diff
      for (const p of f.knownFiles) {
        if (!this.currentState.knownFiles.includes(p)) ops.push({ type: 'add_known_file', path: p });
      }
      for (const p of this.currentState.knownFiles) {
        if (!f.knownFiles.includes(p)) ops.push({ type: 'remove_known_file', path: p });
      }

      if (ops.length === 0) {
        vscode.window.showInformationMessage('No changes to save.');
        return;
      }

      const deltaId = generateDeltaId();
      const newState = applyDeltaOperations(this.currentState, ops, deltaId);

      // Override version to prevent collision after resume
      const safeVersion = await this.store.state.getNextVersion();
      const versionedState = { ...newState, version: safeVersion };
      await this.store.state.saveVersion(versionedState);

      // Update project version pointer
      const project = await this.store.getProject();
      project.currentStateVersion = versionedState.version;
      await this.store.updateProject(project);

      vscode.window.showInformationMessage(`State updated to v${versionedState.version}`);
      this.onStateChanged();
      await this.loadAndSend();
    }
  }
}
