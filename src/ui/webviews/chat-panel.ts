import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { ProjectStore } from '../../storage/store.js';
import type { ChatMessage, DraftCanonicalState, DraftTask, DraftMemoryEntry, ChatSession, TaskContext, ProjectSnapshot } from '../../domain/chat.js';
import { createChatSession, mergeDraftState, mergeDraftTasks } from '../../domain/chat.js';
import { generateChatSessionId, generateChatMessageId, generateTaskId, generateSuggestionId, generateDeltaId } from '../../domain/ids.js';
import { createStateDelta, type DeltaOperation, type StateDelta } from '../../domain/state-delta.js';
import { validateDelta } from '../../review/validator.js';
import { createTask, transitionTask } from '../../domain/task.js';
import { createInitialState, type CanonicalProjectState } from '../../domain/canonical-state.js';
import { sendChatTurn } from '../../runtime/chat-adapter.js';
import { resolveTaskSpec } from '../../compiler/spec-resolver.js';
import { RunController } from '../../runtime/index.js';
import type { NormalizedOutput } from '../../domain/task-run.js';
import { classifyIntent, generateLocalResponse } from '../../runtime/intent-classifier.js';
import { generateMemoryEntryId } from '../../domain/ids.js';
import type { MemoryCategory } from '../../domain/durable-memory.js';

export class ChatPanel extends WebviewBase {
  private session: ChatSession | null = null;
  private sending = false;

  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
    private workspaceRoot: string,
    private onStateAccepted: () => void,
    private onDeltaProposed?: (delta: StateDelta) => Promise<void>,
    private onRunComplete?: (delta: StateDelta, normalized: NormalizedOutput) => Promise<void>,
  ) {
    super(extensionUri, 'morticus.chatPanel', 'Morticus Chat');
  }

  async showChat(): Promise<void> {
    super.show(vscode.ViewColumn.One);
    await this.loadSession();
  }

  private async loadSession(): Promise<void> {
    this.session = await this.store.chat.get();

    // Backward compatibility: sessions saved before 4A.6 lack pendingSuggestedTasks
    if (this.session && !this.session.pendingSuggestedTasks) {
      this.session.pendingSuggestedTasks = [];
    }

    if (!this.session) {
      const project = await this.store.getProject();
      const stateVersion = await this.store.state.getCurrentVersion();
      let mode: 'kickoff' | 'steering' = 'kickoff';
      if (stateVersion >= 1) {
        const state = await this.store.state.getCurrentState();
        if (state.goal) mode = 'steering';
      }

      this.session = createChatSession(
        generateChatSessionId(),
        project.id,
        mode,
      );
      await this.store.chat.save(this.session);
    }

    // Build goal summary and snapshot for steering welcome
    let goalSummary = '';
    let snapshot: ProjectSnapshot | null = null;
    if (this.session.mode === 'steering') {
      try {
        const state = await this.store.state.getCurrentState();
        if (state.goal) {
          goalSummary = state.goal.length > 80 ? state.goal.slice(0, 77) + '...' : state.goal;
        }
      } catch { /* no state yet */ }
      snapshot = await this.buildProjectSnapshot();
    }

    this.postMessage({
      type: 'init',
      mode: this.session.mode,
      messages: this.session.messages,
      draftState: this.session.currentDraftState,
      draftTasks: this.session.draftTasks,
      pendingSuggestedTasks: this.session.pendingSuggestedTasks,
      goalSummary,
      snapshot,
    });
  }

  private async buildTaskContext(): Promise<TaskContext> {
    const tasks = await this.store.tasks.list();
    const activeStatuses = ['draft', 'ready', 'running', 'awaiting_completion', 'normalizing_output'];
    return {
      activeTasks: tasks
        .filter(t => activeStatuses.includes(t.status))
        .map(t => ({ title: t.title, taskType: t.taskType, status: t.status })),
      recentlyCompleted: tasks
        .filter(t => t.status === 'merged')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5)
        .map(t => ({ title: t.title, taskType: t.taskType, goal: t.goal })),
      awaitingReview: tasks
        .filter(t => t.status === 'awaiting_review')
        .map(t => ({ title: t.title })),
    };
  }

  protected getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }
    #mode-bar { padding: 8px 16px; font-size: 12px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-widget-border); }
    #messages { flex: 1; overflow-y: auto; padding: 16px; }
    .msg { margin-bottom: 12px; padding: 10px 14px; border-radius: 8px; max-width: 85%; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; font-size: 13px; }
    .msg-user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-left: auto; }
    .msg-assistant { background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border); }
    .msg-system { background: transparent; border: 1px dashed var(--vscode-widget-border); color: var(--vscode-descriptionForeground); font-size: 12px; max-width: 100%; text-align: center; padding: 12px 16px; }
    .draft-card { margin: 8px 0; padding: 12px; background: var(--vscode-input-background); border: 1px solid var(--vscode-textLink-foreground); border-radius: 6px; font-size: 13px; }
    .draft-card h4 { margin-bottom: 8px; color: var(--vscode-textLink-foreground); }
    .draft-card .field { margin: 4px 0; }
    .draft-card .label { font-weight: bold; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    .draft-card .value { margin-top: 2px; }
    .draft-card .list-item { margin-left: 12px; }
    .draft-card .list-item::before { content: "- "; }
    .draft-card .field.changed { border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 8px; }
    .draft-actions { margin-top: 10px; display: flex; gap: 8px; }
    .draft-actions button { padding: 6px 14px; border: none; cursor: pointer; font-size: 12px; border-radius: 4px; }
    .btn-confirm, .btn-create { background: #4caf50; color: white; }
    .btn-edit { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-cancel, .btn-dismiss { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-accept { background: #4caf50; color: white; font-size: 14px; padding: 10px 20px; }
    .btn-accept-cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); font-size: 14px; padding: 10px 20px; }
    #draft-state-section { margin: 0 16px; }
    #draft-state-section summary { cursor: pointer; font-weight: bold; padding: 8px 0; color: var(--vscode-textLink-foreground); }
    .draft-hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; font-style: italic; }
    .suggested-tasks { margin-top: 8px; }
    .suggested-tasks h5 { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .suggested-task-item { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; font-size: 12px; }
    .suggested-task-item .dismiss-btn { background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 14px; padding: 2px 6px; }
    .suggested-task-item .dismiss-btn:hover { color: var(--vscode-errorForeground); }
    #confirm-section { display: none; margin-top: 8px; padding: 12px; background: var(--vscode-input-background); border: 1px solid var(--vscode-textLink-foreground); border-radius: 6px; }
    #confirm-section .confirm-text { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
    .edit-field { margin: 6px 0; }
    .edit-field input, .edit-field select { width: 100%; padding: 4px 8px; margin-top: 2px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: inherit; font-size: 13px; }
    .edit-field textarea { width: 100%; padding: 4px 8px; margin-top: 2px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: inherit; font-size: 13px; min-height: 60px; resize: vertical; }
    #input-area { padding: 12px 16px; border-top: 1px solid var(--vscode-widget-border); display: flex; gap: 8px; }
    #input-area textarea { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: inherit; font-size: 13px; resize: none; border-radius: 4px; min-height: 40px; max-height: 120px; }
    #input-area button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; border-radius: 4px; font-size: 13px; align-self: flex-end; }
    #input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    .sending-indicator { text-align: center; padding: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .card-error { color: var(--vscode-errorForeground); font-size: 12px; margin-top: 4px; }
    .delta-op { padding: 4px 8px; margin: 2px 0; font-size: 12px; border-left: 3px solid var(--vscode-textLink-foreground); }
    .delta-op.op-add { border-left-color: #4caf50; }
    .delta-op.op-remove { border-left-color: #f44336; }
    .delta-op.op-set { border-left-color: #2196f3; }
    .memory-card { margin: 8px 0; padding: 12px; background: var(--vscode-input-background); border: 1px solid #9c27b0; border-radius: 6px; font-size: 13px; }
    .memory-card h4 { margin-bottom: 8px; color: #9c27b0; }
    #project-snapshot { padding: 8px 16px; font-size: 12px; border-bottom: 1px solid var(--vscode-widget-border); display: none; }
    #project-snapshot .snapshot-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; }
    #project-snapshot .snapshot-label { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; }
    #project-snapshot .snapshot-value { font-size: 12px; }
    .completeness-cue { font-size: 11px; margin: 2px 0; padding: 2px 8px; }
    .completeness-cue.warn { color: #e6a817; }
    .completeness-cue.hint { color: var(--vscode-textLink-foreground); }
    .completeness-cue.note { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div id="mode-bar"></div>
  <div id="project-snapshot"></div>
  <div id="draft-state-section" style="display:none">
    <details open>
      <summary>Draft Project State</summary>
      <div id="draft-state-content" class="draft-card"></div>
      <div id="suggested-tasks-area"></div>
      <div id="draft-hint-area"></div>
      <div id="accept-area" style="padding:8px 0">
        <button class="btn-accept" id="accept-draft" style="display:none">Accept Draft State</button>
      </div>
      <div id="confirm-section">
        <div class="confirm-text">This will become your project's canonical state (v1). You can edit it later in the State Panel.</div>
        <div class="draft-actions">
          <button class="btn-accept" id="confirm-accept">Confirm</button>
          <button class="btn-accept-cancel" id="cancel-accept">Cancel</button>
        </div>
      </div>
    </details>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <textarea id="input" placeholder="Describe your project..." rows="2"></textarea>
    <button id="send">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentMode = 'kickoff';
    let previousDraftState = null;

    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const modeBar = document.getElementById('mode-bar');
    const draftSection = document.getElementById('draft-state-section');
    const draftContent = document.getElementById('draft-state-content');
    const suggestedTasksArea = document.getElementById('suggested-tasks-area');
    const draftHintArea = document.getElementById('draft-hint-area');
    const acceptBtn = document.getElementById('accept-draft');
    const confirmSection = document.getElementById('confirm-section');
    const confirmAcceptBtn = document.getElementById('confirm-accept');
    const cancelAcceptBtn = document.getElementById('cancel-accept');
    const snapshotEl = document.getElementById('project-snapshot');

    function renderSnapshot(snapshot) {
      if (!snapshot) { snapshotEl.style.display = 'none'; return; }
      snapshotEl.style.display = '';
      snapshotEl.innerHTML =
        '<div class="snapshot-grid">' +
        '<span class="snapshot-label">Goal</span><span class="snapshot-value">' + esc(snapshot.goal) + '</span>' +
        (snapshot.phase ? '<span class="snapshot-label">Phase</span><span class="snapshot-value">' + esc(snapshot.phase) + (snapshot.phaseGoal ? ' \\u2014 ' + esc(snapshot.phaseGoal) : '') + '</span>' : '') +
        (snapshot.nextStep ? '<span class="snapshot-label">Next</span><span class="snapshot-value">' + esc(snapshot.nextStep) + '</span>' : '') +
        '<span class="snapshot-label">Status</span><span class="snapshot-value">' + snapshot.activeTaskCount + ' active, ' + snapshot.awaitingReviewCount + ' review \\u2014 v' + snapshot.stateVersion + '</span>' +
        '</div>';
    }

    function renderCompleteness(draft) {
      var cues = [];
      if (!draft.goal) cues.push({ level: 'warn', text: 'Missing: project goal (required)' });
      if (!draft.phase) cues.push({ level: 'hint', text: 'Consider setting a phase' });
      if (!draft.nextStep) cues.push({ level: 'hint', text: 'Consider defining a next step' });
      if (!draft.constraints || !draft.constraints.length) cues.push({ level: 'note', text: 'No constraints yet' });
      return cues;
    }

    function renderSystemMessage(text) {
      const div = document.createElement('div');
      div.className = 'msg msg-system';
      div.textContent = text;
      messagesEl.appendChild(div);
    }

    function renderMessage(msg) {
      const div = document.createElement('div');
      div.className = 'msg msg-' + msg.role;
      div.textContent = msg.content;
      messagesEl.appendChild(div);

      if (msg.draftTask) {
        renderDraftTaskCard(msg.draftTask, messagesEl, 'steering');
      }
      if (msg.draftTasks && msg.draftTasks.length > 0) {
        msg.draftTasks.forEach(function(task) {
          renderDraftTaskCard(task, messagesEl, 'steering');
        });
      }
      if (msg.draftDelta && msg.draftDelta.length > 0) {
        renderDeltaCard(msg.draftDelta, messagesEl);
      }
      if (msg.draftMemory && msg.draftMemory.length > 0) {
        msg.draftMemory.forEach(function(entry) {
          renderMemoryCard(entry, messagesEl);
        });
      }
    }

    function renderDeltaCard(operations, parent) {
      var card = document.createElement('div');
      card.className = 'draft-card';
      var opsHtml = '<h4>Proposed State Changes</h4>';
      operations.forEach(function(op) {
        var isAdd = op.type.startsWith('add_');
        var isRemove = op.type.startsWith('remove_');
        var cls = isAdd ? 'op-add' : isRemove ? 'op-remove' : 'op-set';
        var prefix = isAdd ? '+' : isRemove ? '\u2212' : '=';
        var label = op.type.replace(/_/g, ' ');
        var val = op.value || op.path || '';
        opsHtml += '<div class="delta-op ' + cls + '">' + prefix + ' ' + esc(label) + (val ? ': ' + esc(val) : '') + '</div>';
      });
      opsHtml += '<div class="draft-actions"><button class="btn-confirm" data-action="review-delta">Send to Review</button></div>';
      card.innerHTML = opsHtml;
      card.querySelector('[data-action="review-delta"]').addEventListener('click', function() {
        vscode.postMessage({ type: 'reviewDelta', operations: operations });
        var btn = card.querySelector('[data-action="review-delta"]');
        btn.textContent = 'Sent to Review';
        btn.disabled = true;
      });
      parent.appendChild(card);
    }

    function renderMemoryCard(entry, parent) {
      var card = document.createElement('div');
      card.className = 'memory-card';
      card.innerHTML =
        '<h4>Proposed Memory Entry</h4>' +
        '<div class="field"><span class="label">Category</span><div class="value">' + esc(entry.category.replace(/_/g, ' ')) + '</div></div>' +
        '<div class="field"><span class="label">Title</span><div class="value">' + esc(entry.title) + '</div></div>' +
        '<div class="field"><span class="label">Content</span><div class="value">' + esc(entry.content) + '</div></div>' +
        '<div class="draft-actions">' +
          '<button class="btn-confirm" data-action="confirm-memory" style="background:#9c27b0">Add to Memory</button>' +
          '<button class="btn-dismiss" data-action="dismiss-memory">Dismiss</button>' +
        '</div>';
      card.querySelector('[data-action="confirm-memory"]').addEventListener('click', function() {
        vscode.postMessage({ type: 'confirmMemory', entry: entry });
        var btns = card.querySelector('.draft-actions');
        if (btns) btns.remove();
        var done = document.createElement('div');
        done.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;margin-top:4px';
        done.textContent = 'Adding to memory...';
        done.setAttribute('data-memory-pending', 'true');
        card.appendChild(done);
      });
      card.querySelector('[data-action="dismiss-memory"]').addEventListener('click', function() {
        card.remove();
      });
      parent.appendChild(card);
    }

    function renderDraftTaskCard(task, parent, mode) {
      const card = document.createElement('div');
      card.className = 'draft-card';
      renderCardReadOnly(card, task, mode);
      parent.appendChild(card);
    }

    function renderCardReadOnly(card, task, mode) {
      const isPostAccept = mode === 'post-accept';
      const confirmLabel = isPostAccept ? 'Create' : 'Confirm';
      const cancelLabel = isPostAccept ? 'Dismiss' : 'Cancel';
      const confirmClass = isPostAccept ? 'btn-create' : 'btn-confirm';
      const cancelClass = isPostAccept ? 'btn-dismiss' : 'btn-cancel';

      card.innerHTML =
        '<h4>' + (isPostAccept ? 'Suggested Task' : 'Draft Task') + '</h4>' +
        '<div class="field"><span class="label">Title</span><div class="value">' + esc(task.title) + '</div></div>' +
        '<div class="field"><span class="label">Type</span><div class="value">' + esc(task.taskType) + '</div></div>' +
        '<div class="field"><span class="label">Goal</span><div class="value">' + esc(task.goal) + '</div></div>' +
        '<div class="field"><span class="label">Scope</span><div class="value">' + (task.scopePaths.length ? esc(task.scopePaths.join(', ')) : '(entire project)') + '</div></div>' +
        '<div class="draft-actions">' +
          '<button class="' + confirmClass + '" data-action="confirm-task">' + confirmLabel + '</button>' +
          '<button class="btn-confirm" data-action="confirm-run-task" style="background:#1976d2">Create & Run</button>' +
          '<button class="btn-edit" data-action="edit-task">Edit</button>' +
          '<button class="' + cancelClass + '" data-action="cancel-task">' + cancelLabel + '</button>' +
        '</div>';

      card.querySelector('[data-action="confirm-task"]').addEventListener('click', () => {
        vscode.postMessage({ type: 'confirmTask', task: task });
        const btns = card.querySelector('.draft-actions');
        if (btns) btns.remove();
        const indicator = document.createElement('div');
        indicator.className = 'sending-indicator';
        indicator.textContent = 'Creating task...';
        indicator.setAttribute('data-pending', 'true');
        card.appendChild(indicator);
      });
      card.querySelector('[data-action="confirm-run-task"]').addEventListener('click', () => {
        vscode.postMessage({ type: 'confirmAndRunTask', task: task });
        const btns = card.querySelector('.draft-actions');
        if (btns) btns.remove();
        const indicator = document.createElement('div');
        indicator.className = 'sending-indicator';
        indicator.textContent = 'Creating & running...';
        indicator.setAttribute('data-task-run', 'true');
        card.appendChild(indicator);
      });
      card.querySelector('[data-action="edit-task"]').addEventListener('click', () => {
        renderCardEditing(card, task, mode);
      });
      card.querySelector('[data-action="cancel-task"]').addEventListener('click', () => {
        if (isPostAccept && task.suggestionId) {
          vscode.postMessage({ type: 'dismissPendingTask', suggestionId: task.suggestionId });
        }
        card.remove();
      });
    }

    function renderCardEditing(card, task, mode) {
      card.innerHTML =
        '<h4>Edit Task</h4>' +
        '<div class="edit-field"><span class="label">Title</span><input type="text" data-field="title" value="' + escAttr(task.title) + '" /></div>' +
        '<div class="edit-field"><span class="label">Type</span><select data-field="taskType">' +
          '<option value="discovery"' + (task.taskType === 'discovery' ? ' selected' : '') + '>discovery</option>' +
          '<option value="implementation"' + (task.taskType === 'implementation' ? ' selected' : '') + '>implementation</option>' +
          '<option value="validation"' + (task.taskType === 'validation' ? ' selected' : '') + '>validation</option>' +
        '</select></div>' +
        '<div class="edit-field"><span class="label">Goal</span><textarea data-field="goal">' + esc(task.goal) + '</textarea></div>' +
        '<div class="edit-field"><span class="label">Scope (comma-separated)</span><input type="text" data-field="scopePaths" value="' + escAttr(task.scopePaths.join(', ')) + '" /></div>' +
        '<div class="draft-actions">' +
          '<button class="btn-confirm" data-action="save-task">Save</button>' +
          '<button class="btn-cancel" data-action="cancel-edit">Cancel</button>' +
        '</div>';

      card.querySelector('[data-action="save-task"]').addEventListener('click', () => {
        const edited = {
          title: card.querySelector('[data-field="title"]').value.trim() || task.title,
          goal: card.querySelector('[data-field="goal"]').value.trim() || task.goal,
          taskType: card.querySelector('[data-field="taskType"]').value,
          scopePaths: card.querySelector('[data-field="scopePaths"]').value.split(',').map(s => s.trim()).filter(Boolean),
          suggestionId: task.suggestionId || undefined,
        };
        vscode.postMessage({ type: 'confirmTask', task: edited });
        const btns = card.querySelector('.draft-actions');
        if (btns) btns.remove();
        const indicator = document.createElement('div');
        indicator.className = 'sending-indicator';
        indicator.textContent = 'Creating task...';
        indicator.setAttribute('data-pending', 'true');
        card.appendChild(indicator);
      });
      card.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => {
        renderCardReadOnly(card, task, mode);
      });
    }

    function renderDraftState(draft, prevDraft) {
      if (!draft) {
        draftSection.style.display = 'none';
        acceptBtn.style.display = 'none';
        return;
      }
      draftSection.style.display = '';

      const changed = (field) => {
        if (!prevDraft) return !!draft[field];
        const cur = draft[field];
        const prev = prevDraft[field];
        if (cur === prev) return false;
        if (Array.isArray(cur) && Array.isArray(prev)) return JSON.stringify(cur) !== JSON.stringify(prev);
        return cur !== prev;
      };

      let html = '';
      const cls = (field) => changed(field) ? 'field changed' : 'field';

      if (draft.goal) html += '<div class="' + cls('goal') + '"><span class="label">Goal</span><div class="value">' + esc(draft.goal) + '</div></div>';
      if (draft.phase) html += '<div class="' + cls('phase') + '"><span class="label">Phase</span><div class="value">' + esc(draft.phase) + '</div></div>';
      if (draft.phaseGoal) html += '<div class="' + cls('phaseGoal') + '"><span class="label">Phase Goal</span><div class="value">' + esc(draft.phaseGoal) + '</div></div>';
      if (draft.constraints && draft.constraints.length) {
        html += '<div class="' + cls('constraints') + '"><span class="label">Constraints</span>';
        draft.constraints.forEach(c => { html += '<div class="list-item">' + esc(c) + '</div>'; });
        html += '</div>';
      }
      if (draft.decisions && draft.decisions.length) {
        html += '<div class="' + cls('decisions') + '"><span class="label">Decisions</span>';
        draft.decisions.forEach(d => { html += '<div class="list-item">' + esc(d) + '</div>'; });
        html += '</div>';
      }
      if (draft.risks && draft.risks.length) {
        html += '<div class="' + cls('risks') + '"><span class="label">Risks</span>';
        draft.risks.forEach(r => { html += '<div class="list-item">' + esc(r) + '</div>'; });
        html += '</div>';
      }
      if (draft.nextStep) html += '<div class="' + cls('nextStep') + '"><span class="label">Next Step</span><div class="value">' + esc(draft.nextStep) + '</div></div>';

      // Completeness cues
      var cues = renderCompleteness(draft);
      if (cues.length > 0) {
        cues.forEach(function(c) { html += '<div class="completeness-cue ' + c.level + '">' + esc(c.text) + '</div>'; });
      }

      draftContent.innerHTML = html || '<div style="color:var(--vscode-descriptionForeground)">Describe your project to start building the draft...</div>';

      // Missing-goal hint
      if (!draft.goal && (draft.phase || (draft.constraints && draft.constraints.length))) {
        draftHintArea.innerHTML = '<div class="draft-hint">Set a project goal to enable acceptance. Try: "The goal is to build..."</div>';
      } else {
        draftHintArea.innerHTML = '';
      }

      // Dynamic accept button text with summary
      var parts = [];
      if (draft.goal) parts.push('goal set');
      if (draft.phase) parts.push('phase set');
      if (draft.constraints && draft.constraints.length) parts.push(draft.constraints.length + ' constraint' + (draft.constraints.length > 1 ? 's' : ''));
      if (draft.decisions && draft.decisions.length) parts.push(draft.decisions.length + ' decision' + (draft.decisions.length > 1 ? 's' : ''));
      acceptBtn.textContent = parts.length > 0 ? 'Accept Draft State (' + parts.join(', ') + ')' : 'Accept Draft State';
      acceptBtn.style.display = draft.goal ? '' : 'none';
      confirmSection.style.display = 'none';

      previousDraftState = JSON.parse(JSON.stringify(draft));
    }

    function renderSuggestedTasks(tasks) {
      if (!tasks || tasks.length === 0) {
        suggestedTasksArea.innerHTML = '';
        return;
      }
      let html = '<div class="suggested-tasks"><h5>Suggested starter tasks:</h5>';
      tasks.forEach((t, i) => {
        html += '<div class="suggested-task-item">' +
          '<span>' + (i + 1) + '. "' + esc(t.title) + '" [' + esc(t.taskType) + ']' +
            (t.scopePaths.length ? ' \\u2014 ' + esc(t.scopePaths.join(', ')) : '') +
          '</span>' +
          '<button class="dismiss-btn" data-dismiss-idx="' + i + '" title="Dismiss">\\u00d7</button>' +
        '</div>';
      });
      html += '</div>';
      suggestedTasksArea.innerHTML = html;

      suggestedTasksArea.querySelectorAll('[data-dismiss-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-dismiss-idx'));
          vscode.postMessage({ type: 'dismissSuggestedTask', index: idx });
        });
      });
    }

    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function escAttr(s) {
      return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setSending(sending) {
      sendBtn.disabled = sending;
      inputEl.disabled = sending;
      const existing = messagesEl.querySelector('.sending-indicator:not([data-pending])');
      if (sending && !existing) {
        const el = document.createElement('div');
        el.className = 'sending-indicator';
        el.textContent = 'Thinking...';
        messagesEl.appendChild(el);
        scrollToBottom();
      } else if (!sending && existing) {
        existing.remove();
      }
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'init') {
        currentMode = msg.mode;
        modeBar.textContent = msg.mode === 'kickoff' ? 'Setting up project...' : 'Project Chat';
        inputEl.placeholder = msg.mode === 'kickoff' ? 'Describe your project...' : 'Create tasks, ask questions...';
        messagesEl.innerHTML = '';

        // Welcome message
        if (msg.messages.length === 0) {
          if (msg.mode === 'kickoff') {
            renderSystemMessage('Welcome to Morticus. Describe the project you want to build \\u2014 what it does, any constraints, and what the first focus should be.\\n\\nExample: "I want to build a chess engine in Rust. Start with board representation, then move generation. Must support FEN notation."\\n\\nI\\'ll draft your project\\'s canonical state from the conversation. You can refine it across multiple messages before accepting.');
          } else {
            renderSystemMessage('Project: ' + (msg.goalSummary || 'Active project') + '\\n\\nYou can create tasks ("create a task to implement auth"), ask questions about the project, or request strategic advice.');
          }
        }

        for (const m of msg.messages) renderMessage(m);
        if (msg.mode === 'kickoff') {
          renderDraftState(msg.draftState, null);
          renderSuggestedTasks(msg.draftTasks);
        }
        // Re-render pending suggested tasks on reopen in steering mode
        if (msg.mode === 'steering' && msg.pendingSuggestedTasks && msg.pendingSuggestedTasks.length > 0) {
          msg.pendingSuggestedTasks.forEach(function(task) {
            renderDraftTaskCard(task, messagesEl, 'post-accept');
          });
        }
        if (msg.snapshot) renderSnapshot(msg.snapshot);
        scrollToBottom();
      }
      if (msg.type === 'assistantMessage') {
        setSending(false);
        renderMessage(msg.message);
        if (msg.draftState !== undefined) renderDraftState(msg.draftState, previousDraftState);
        if (msg.draftTasks !== undefined) renderSuggestedTasks(msg.draftTasks);
        scrollToBottom();
      }
      if (msg.type === 'modeChanged') {
        currentMode = msg.mode;
        modeBar.textContent = msg.mode === 'kickoff' ? 'Setting up project...' : 'Project Chat';
        inputEl.placeholder = msg.mode === 'kickoff' ? 'Describe your project...' : 'Create tasks, ask questions...';
        draftSection.style.display = 'none';
      }
      if (msg.type === 'postAcceptTasks') {
        msg.tasks.forEach(task => {
          renderDraftTaskCard(task, messagesEl, 'post-accept');
        });
        scrollToBottom();
      }
      if (msg.type === 'systemMessage') {
        renderSystemMessage(msg.text);
        scrollToBottom();
      }
      if (msg.type === 'taskCreated') {
        const cards = messagesEl.querySelectorAll('.draft-card');
        for (const card of cards) {
          const pending = card.querySelector('[data-pending="true"]');
          if (pending) {
            pending.remove();
            const done = document.createElement('div');
            done.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;margin-top:4px';
            done.textContent = 'Task "' + msg.title + '" created (' + msg.taskId + '). Compile its spec when ready.';
            card.appendChild(done);
            break;
          }
        }
        scrollToBottom();
      }
      if (msg.type === 'taskCreateFailed') {
        const cards = messagesEl.querySelectorAll('.draft-card');
        for (const card of cards) {
          const pending = card.querySelector('[data-pending="true"]');
          if (pending) {
            pending.remove();
            const err = document.createElement('div');
            err.className = 'card-error';
            err.textContent = 'Failed to create task: ' + msg.error;
            card.appendChild(err);
            break;
          }
        }
      }
      if (msg.type === 'suggestedTasksUpdated') {
        renderSuggestedTasks(msg.tasks);
      }
      if (msg.type === 'projectSnapshot') {
        renderSnapshot(msg.snapshot);
      }
      if (msg.type === 'taskRunProgress') {
        var cards = messagesEl.querySelectorAll('.draft-card');
        for (var ci = 0; ci < cards.length; ci++) {
          var ind = cards[ci].querySelector('[data-task-run="true"]');
          if (ind) { ind.textContent = msg.text; break; }
        }
      }
      if (msg.type === 'taskRunComplete') {
        var cards2 = messagesEl.querySelectorAll('.draft-card');
        for (var cj = 0; cj < cards2.length; cj++) {
          var ind2 = cards2[cj].querySelector('[data-task-run="true"]');
          if (ind2) {
            ind2.textContent = 'Run complete \\u2014 review ready (confidence: ' + msg.confidence + '%)';
            ind2.removeAttribute('data-task-run');
            break;
          }
        }
      }
      if (msg.type === 'memoryAdded') {
        var memCards = messagesEl.querySelectorAll('.memory-card');
        for (var mk = 0; mk < memCards.length; mk++) {
          var mp = memCards[mk].querySelector('[data-memory-pending="true"]');
          if (mp) {
            mp.textContent = 'Memory entry "' + msg.title + '" added.';
            mp.removeAttribute('data-memory-pending');
            break;
          }
        }
      }
      if (msg.type === 'memoryAddFailed') {
        var memCards2 = messagesEl.querySelectorAll('.memory-card');
        for (var ml = 0; ml < memCards2.length; ml++) {
          var mp2 = memCards2[ml].querySelector('[data-memory-pending="true"]');
          if (mp2) {
            mp2.textContent = 'Failed: ' + msg.error;
            mp2.style.color = 'var(--vscode-errorForeground)';
            mp2.removeAttribute('data-memory-pending');
            break;
          }
        }
      }
      if (msg.type === 'error') {
        setSending(false);
        const div = document.createElement('div');
        div.className = 'msg msg-assistant';
        div.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
        div.textContent = 'Error: ' + msg.error;
        messagesEl.appendChild(div);
        scrollToBottom();
      }
    });

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    acceptBtn.addEventListener('click', () => {
      acceptBtn.style.display = 'none';
      confirmSection.style.display = '';
    });

    confirmAcceptBtn.addEventListener('click', () => {
      confirmSection.style.display = 'none';
      vscode.postMessage({ type: 'acceptDraftState' });
    });

    cancelAcceptBtn.addEventListener('click', () => {
      confirmSection.style.display = 'none';
      acceptBtn.style.display = '';
    });

    function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';

      const userMsg = { role: 'user', content: text };
      renderMessage(userMsg);
      scrollToBottom();
      setSending(true);

      vscode.postMessage({ type: 'sendMessage', text: text });
    }
  </script>
</body>
</html>`;
  }

  protected async onMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; text?: string; task?: DraftTask; index?: number; suggestionId?: string; operations?: DeltaOperation[]; entry?: DraftMemoryEntry };

    if (msg.type === 'sendMessage' && msg.text) {
      await this.handleSendMessage(msg.text);
    } else if (msg.type === 'acceptDraftState') {
      await this.handleAcceptDraftState();
    } else if (msg.type === 'confirmTask' && msg.task) {
      await this.handleConfirmTask(msg.task);
    } else if (msg.type === 'dismissSuggestedTask' && typeof msg.index === 'number') {
      await this.handleDismissSuggestedTask(msg.index);
    } else if (msg.type === 'confirmAndRunTask' && msg.task) {
      await this.handleConfirmAndRunTask(msg.task);
    } else if (msg.type === 'dismissPendingTask' && msg.suggestionId) {
      await this.handleDismissPendingTask(msg.suggestionId);
    } else if (msg.type === 'reviewDelta' && msg.operations) {
      await this.handleReviewDelta(msg.operations);
    } else if (msg.type === 'confirmMemory' && msg.entry) {
      await this.handleConfirmMemory(msg.entry);
    }
  }

  private async handleSendMessage(text: string): Promise<void> {
    if (this.sending || !this.session) return;
    this.sending = true;

    const userMsg: ChatMessage = {
      id: generateChatMessageId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    this.session.messages.push(userMsg);
    await this.store.chat.save(this.session);

    try {
      let state: CanonicalProjectState | null = null;
      try {
        const current = await this.store.state.getCurrentState();
        if (current.goal) state = current;
      } catch { /* no state yet */ }

      // Local intent classification — skip Claude for simple queries
      const intent = classifyIntent(text, this.session.mode);
      if (intent.type !== 'delegate') {
        let taskContext: TaskContext | undefined;
        if (intent.type === 'task_query') taskContext = await this.buildTaskContext();
        const localResponse = generateLocalResponse(intent, state, taskContext);
        const assistantMsg: ChatMessage = {
          id: generateChatMessageId(),
          role: 'assistant',
          content: localResponse,
          timestamp: new Date().toISOString(),
        };
        this.session.messages.push(assistantMsg);
        await this.store.chat.save(this.session);
        this.postMessage({ type: 'assistantMessage', message: assistantMsg });
        this.sending = false;
        return;
      }

      const memory = await this.store.memory.get();

      // Build task context for steering mode
      let taskContext: TaskContext | undefined;
      if (this.session.mode === 'steering') {
        taskContext = await this.buildTaskContext();
      }

      const result = await sendChatTurn(
        this.session.messages,
        state,
        memory,
        this.session.mode,
        { workingDirectory: this.workspaceRoot },
        taskContext,
      );

      const assistantMsg: ChatMessage = {
        id: generateChatMessageId(),
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString(),
        draftState: result.draftState,
        draftTask: result.draftTask,
        draftTasks: result.draftTasks,
        draftDelta: result.draftDelta,
        draftMemory: result.draftMemory,
      };
      this.session.messages.push(assistantMsg);

      // Update accumulated draft state in kickoff mode
      if (this.session.mode === 'kickoff' && result.draftState) {
        this.session.currentDraftState = mergeDraftState(
          this.session.currentDraftState,
          result.draftState,
        );
      }

      // Merge suggested tasks in kickoff mode (merge semantics, not replace)
      if (this.session.mode === 'kickoff' && result.draftTasks && result.draftTasks.length > 0) {
        this.session.draftTasks = mergeDraftTasks(
          this.session.draftTasks,
          result.draftTasks,
        );
      }

      await this.store.chat.save(this.session);

      this.postMessage({
        type: 'assistantMessage',
        message: assistantMsg,
        draftState: this.session.mode === 'kickoff' ? this.session.currentDraftState : undefined,
        draftTasks: this.session.mode === 'kickoff' ? this.session.draftTasks : undefined,
      });
    } catch (err) {
      this.postMessage({ type: 'error', error: (err as Error).message });
    } finally {
      this.sending = false;
    }
  }

  private async handleAcceptDraftState(): Promise<void> {
    if (!this.session?.currentDraftState) return;

    const draft = this.session.currentDraftState;
    if (!draft.goal) {
      vscode.window.showWarningMessage('Draft state needs at least a goal before accepting.');
      return;
    }

    try {
      const state: CanonicalProjectState = {
        ...createInitialState(),
        goal: draft.goal || '',
        phase: draft.phase || '',
        phaseGoal: draft.phaseGoal || '',
        phaseExitCriteria: [],
        constraints: draft.constraints || [],
        decisions: draft.decisions || [],
        risks: draft.risks || [],
        knownFiles: draft.knownFiles || [],
        nextStep: draft.nextStep || '',
      };

      await this.store.state.saveVersion(state);
      const project = await this.store.getProject();
      project.currentStateVersion = state.version;
      await this.store.updateProject(project);

      // Move suggested tasks to pendingSuggestedTasks with stable IDs
      const suggestedTasks = this.session.draftTasks.map(t => ({
        ...t,
        suggestionId: generateSuggestionId(),
      }));

      // Transition chat to steering mode
      this.session.mode = 'steering';
      this.session.currentDraftState = null;
      this.session.draftTasks = [];
      this.session.pendingSuggestedTasks = suggestedTasks;
      await this.store.chat.save(this.session);

      vscode.commands.executeCommand('setContext', 'morticus.projectInitialized', true);

      this.postMessage({ type: 'modeChanged', mode: 'steering' });

      // Post-accept system message
      this.postMessage({
        type: 'systemMessage',
        text: 'Project state v1 created. You\'re now in steering mode.\n\nTry: "Create a task to ' +
          (draft.nextStep || 'get started') + '" or ask "What should we tackle first?"',
      });

      // Show suggested tasks as cards (not auto-created — user must confirm each)
      if (suggestedTasks.length > 0) {
        this.postMessage({
          type: 'postAcceptTasks',
          tasks: suggestedTasks,
        });
      }

      // Toast with action
      const taskCountMsg = suggestedTasks.length > 0
        ? ` Review ${suggestedTasks.length} suggested starter task${suggestedTasks.length > 1 ? 's' : ''} in chat.`
        : '';
      const action = await vscode.window.showInformationMessage(
        `Project state v1 created. Goal: "${draft.goal}"${taskCountMsg}`,
        'Open State Panel',
      );
      if (action === 'Open State Panel') {
        vscode.commands.executeCommand('morticus.openStatePanel');
      }

      this.onStateAccepted();

    } catch (err) {
      vscode.window.showErrorMessage(`Failed to accept draft: ${(err as Error).message}`);
    }
  }

  private async handleConfirmTask(draft: DraftTask): Promise<void> {
    try {
      const project = await this.store.getProject();
      const currentVersion = await this.store.state.getCurrentVersion();
      const readOnly = draft.taskType === 'discovery' || draft.taskType === 'validation';

      const task = createTask(
        generateTaskId(),
        project.id,
        draft.title,
        draft.goal,
        draft.taskType,
        { paths: draft.scopePaths, readOnly, writePermissions: [] },
        currentVersion,
      );
      await this.store.tasks.save(task);

      // Drain from pendingSuggestedTasks if this was a suggested task
      if (draft.suggestionId && this.session) {
        this.session.pendingSuggestedTasks = this.session.pendingSuggestedTasks
          .filter(t => t.suggestionId !== draft.suggestionId);
        await this.store.chat.save(this.session);
      }

      // Non-optimistic: notify webview of success with task ID
      this.postMessage({
        type: 'taskCreated',
        title: draft.title,
        taskId: task.id,
      });

      // Toast with action
      const action = await vscode.window.showInformationMessage(
        `Task "${draft.title}" created.`,
        'Open Tasks Panel',
      );
      if (action === 'Open Tasks Panel') {
        vscode.commands.executeCommand('morticus-tasks.focus');
      }

      this.onStateAccepted(); // refresh tree views
    } catch (err) {
      this.postMessage({
        type: 'taskCreateFailed',
        error: (err as Error).message,
      });
      vscode.window.showErrorMessage(`Failed to create task: ${(err as Error).message}`);
    }
  }

  private async handleDismissSuggestedTask(index: number): Promise<void> {
    if (!this.session) return;
    if (index >= 0 && index < this.session.draftTasks.length) {
      this.session.draftTasks.splice(index, 1);
      await this.store.chat.save(this.session);
      this.postMessage({
        type: 'suggestedTasksUpdated',
        tasks: this.session.draftTasks,
      });
    }
  }

  private async handleDismissPendingTask(suggestionId: string): Promise<void> {
    if (!this.session) return;
    this.session.pendingSuggestedTasks = this.session.pendingSuggestedTasks
      .filter(t => t.suggestionId !== suggestionId);
    await this.store.chat.save(this.session);
  }

  private async handleReviewDelta(operations: DeltaOperation[]): Promise<void> {
    try {
      const currentState = await this.store.state.getCurrentState();
      const delta = createStateDelta(
        generateDeltaId(),
        null,
        currentState.version,
        operations,
      );
      delta.confidence = 1.0;
      delta.conflicts = validateDelta(delta, currentState);
      await this.store.deltas.save(delta);

      if (this.onDeltaProposed) {
        await this.onDeltaProposed(delta);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to create delta: ${(err as Error).message}`);
    }
  }

  private async handleConfirmMemory(draft: DraftMemoryEntry): Promise<void> {
    try {
      const now = new Date().toISOString();
      await this.store.memory.addEntry({
        id: generateMemoryEntryId(),
        category: draft.category as MemoryCategory,
        title: draft.title,
        content: draft.content,
        origin: 'user',
        active: true,
        reviewed: true,
        normalizedValue: null,
        sourceTaskId: null,
        sourceRunId: null,
        sourceDeltaId: null,
        sourceOperationType: null,
        createdAt: now,
        updatedAt: now,
      });
      this.postMessage({ type: 'memoryAdded', title: draft.title });
    } catch (err) {
      this.postMessage({ type: 'memoryAddFailed', error: (err as Error).message });
    }
  }

  // --- Phase 6: Public methods for cross-panel communication ---

  public postSystemMessage(text: string): void {
    this.postMessage({ type: 'systemMessage', text });
  }

  public async refreshSnapshot(): Promise<void> {
    const snapshot = await this.buildProjectSnapshot();
    if (snapshot) {
      this.postMessage({ type: 'projectSnapshot', snapshot });
    }
  }

  private async buildProjectSnapshot(): Promise<ProjectSnapshot | null> {
    try {
      const state = await this.store.state.getCurrentState();
      if (!state.goal) return null;
      const tasks = await this.store.tasks.list();
      const activeStatuses = ['draft', 'ready', 'running', 'awaiting_completion', 'normalizing_output'];
      return {
        goal: state.goal,
        phase: state.phase,
        phaseGoal: state.phaseGoal,
        nextStep: state.nextStep,
        stateVersion: state.version,
        activeTaskCount: tasks.filter(t => activeStatuses.includes(t.status)).length,
        awaitingReviewCount: tasks.filter(t => t.status === 'awaiting_review').length,
      };
    } catch {
      return null;
    }
  }

  private async handleConfirmAndRunTask(draft: DraftTask): Promise<void> {
    try {
      // 1. Create task (same logic as handleConfirmTask)
      const project = await this.store.getProject();
      const currentVersion = await this.store.state.getCurrentVersion();
      const readOnly = draft.taskType === 'discovery' || draft.taskType === 'validation';

      const task = createTask(
        generateTaskId(),
        project.id,
        draft.title,
        draft.goal,
        draft.taskType,
        { paths: draft.scopePaths, readOnly, writePermissions: [] },
        currentVersion,
      );
      await this.store.tasks.save(task);

      // Drain from pendingSuggestedTasks if applicable
      if (draft.suggestionId && this.session) {
        this.session.pendingSuggestedTasks = this.session.pendingSuggestedTasks
          .filter(t => t.suggestionId !== draft.suggestionId);
        await this.store.chat.save(this.session);
      }

      this.postMessage({ type: 'taskRunProgress', text: 'Compiling spec...' });

      // 2. Compile spec
      const state = await this.store.state.getCurrentState();
      const memory = await this.store.memory.get();
      const spec = resolveTaskSpec(task, state, memory);
      await this.store.specs.save(spec);

      const readyTask = transitionTask(
        { ...task, specId: spec.id, updatedAt: new Date().toISOString() },
        'ready',
      );
      await this.store.tasks.save(readyTask);

      this.postMessage({ type: 'taskRunProgress', text: 'Running task...' });

      // 3. Run
      const controller = new RunController({ store: this.store, workspaceRoot: this.workspaceRoot });
      const { normalizedOutput, delta } = await controller.execute(readyTask);

      const pct = (normalizedOutput.confidence * 100).toFixed(0);
      this.postMessage({ type: 'taskRunComplete', confidence: pct });

      // 4. Open review
      if (this.onRunComplete) {
        await this.onRunComplete(delta, normalizedOutput);
      }

      // 5. Refresh trees
      this.onStateAccepted();
    } catch (err) {
      this.postMessage({ type: 'taskRunProgress', text: 'Failed: ' + (err as Error).message });
    }
  }
}
