import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { ProjectStore } from '../../storage/store.js';
import type { ChatMessage, DraftCanonicalState, DraftTask, ChatSession } from '../../domain/chat.js';
import { createChatSession, mergeDraftState } from '../../domain/chat.js';
import { generateChatSessionId, generateChatMessageId, generateTaskId } from '../../domain/ids.js';
import { createTask } from '../../domain/task.js';
import { createInitialState, type CanonicalProjectState } from '../../domain/canonical-state.js';
import { sendChatTurn } from '../../runtime/chat-adapter.js';

export class ChatPanel extends WebviewBase {
  private session: ChatSession | null = null;
  private sending = false;

  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
    private workspaceRoot: string,
    private onStateAccepted: () => void,
  ) {
    super(extensionUri, 'morticus.chatPanel', 'Morticus Chat');
  }

  async showChat(): Promise<void> {
    super.show(vscode.ViewColumn.One);
    await this.loadSession();
  }

  private async loadSession(): Promise<void> {
    this.session = await this.store.chat.get();

    if (!this.session) {
      const project = await this.store.getProject();
      const stateVersion = await this.store.state.getCurrentVersion();
      // Check if state is empty (kickoff) or populated (steering)
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

    this.postMessage({
      type: 'init',
      mode: this.session.mode,
      messages: this.session.messages,
      draftState: this.session.currentDraftState,
    });
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
    .draft-card { margin: 8px 0; padding: 12px; background: var(--vscode-input-background); border: 1px solid var(--vscode-textLink-foreground); border-radius: 6px; font-size: 13px; }
    .draft-card h4 { margin-bottom: 8px; color: var(--vscode-textLink-foreground); }
    .draft-card .field { margin: 4px 0; }
    .draft-card .label { font-weight: bold; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    .draft-card .value { margin-top: 2px; }
    .draft-card .list-item { margin-left: 12px; }
    .draft-card .list-item::before { content: "- "; }
    .draft-actions { margin-top: 10px; display: flex; gap: 8px; }
    .draft-actions button { padding: 6px 14px; border: none; cursor: pointer; font-size: 12px; border-radius: 4px; }
    .btn-confirm { background: #4caf50; color: white; }
    .btn-edit { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-accept { background: #4caf50; color: white; font-size: 14px; padding: 10px 20px; }
    #draft-state-section { margin: 0 16px; }
    #draft-state-section summary { cursor: pointer; font-weight: bold; padding: 8px 0; color: var(--vscode-textLink-foreground); }
    #input-area { padding: 12px 16px; border-top: 1px solid var(--vscode-widget-border); display: flex; gap: 8px; }
    #input-area textarea { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: inherit; font-size: 13px; resize: none; border-radius: 4px; min-height: 40px; max-height: 120px; }
    #input-area button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; border-radius: 4px; font-size: 13px; align-self: flex-end; }
    #input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    .sending-indicator { text-align: center; padding: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div id="mode-bar"></div>
  <div id="draft-state-section" style="display:none">
    <details open>
      <summary>Draft Project State</summary>
      <div id="draft-state-content" class="draft-card"></div>
      <div style="padding:8px 0">
        <button class="btn-accept" id="accept-draft" style="display:none">Accept Draft State</button>
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

    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const modeBar = document.getElementById('mode-bar');
    const draftSection = document.getElementById('draft-state-section');
    const draftContent = document.getElementById('draft-state-content');
    const acceptBtn = document.getElementById('accept-draft');

    function renderMessage(msg) {
      const div = document.createElement('div');
      div.className = 'msg msg-' + msg.role;
      div.textContent = msg.content;
      messagesEl.appendChild(div);

      if (msg.draftTask) {
        renderDraftTaskCard(msg.draftTask, messagesEl);
      }
    }

    function renderDraftTaskCard(task, parent) {
      const card = document.createElement('div');
      card.className = 'draft-card';
      card.innerHTML =
        '<h4>Draft Task</h4>' +
        '<div class="field"><span class="label">Title</span><div class="value">' + esc(task.title) + '</div></div>' +
        '<div class="field"><span class="label">Type</span><div class="value">' + esc(task.taskType) + '</div></div>' +
        '<div class="field"><span class="label">Goal</span><div class="value">' + esc(task.goal) + '</div></div>' +
        '<div class="field"><span class="label">Scope</span><div class="value">' + (task.scopePaths.length ? esc(task.scopePaths.join(', ')) : '(entire project)') + '</div></div>' +
        '<div class="draft-actions">' +
          '<button class="btn-confirm" data-action="confirm-task">Confirm</button>' +
          '<button class="btn-edit" data-action="edit-task">Edit</button>' +
          '<button class="btn-cancel" data-action="cancel-task">Cancel</button>' +
        '</div>';

      card.querySelector('[data-action="confirm-task"]').addEventListener('click', () => {
        vscode.postMessage({ type: 'confirmTask', task: task });
        card.innerHTML = '<div style="color:var(--vscode-descriptionForeground);font-size:12px">Task created.</div>';
      });
      card.querySelector('[data-action="edit-task"]').addEventListener('click', () => {
        vscode.postMessage({ type: 'editTask', task: task });
        card.innerHTML = '<div style="color:var(--vscode-descriptionForeground);font-size:12px">Opening editor...</div>';
      });
      card.querySelector('[data-action="cancel-task"]').addEventListener('click', () => {
        card.remove();
      });

      parent.appendChild(card);
    }

    function renderDraftState(draft) {
      if (!draft) {
        draftSection.style.display = 'none';
        acceptBtn.style.display = 'none';
        return;
      }
      draftSection.style.display = '';

      let html = '';
      if (draft.goal) html += '<div class="field"><span class="label">Goal</span><div class="value">' + esc(draft.goal) + '</div></div>';
      if (draft.phase) html += '<div class="field"><span class="label">Phase</span><div class="value">' + esc(draft.phase) + '</div></div>';
      if (draft.phaseGoal) html += '<div class="field"><span class="label">Phase Goal</span><div class="value">' + esc(draft.phaseGoal) + '</div></div>';
      if (draft.constraints && draft.constraints.length) {
        html += '<div class="field"><span class="label">Constraints</span>';
        draft.constraints.forEach(c => { html += '<div class="list-item">' + esc(c) + '</div>'; });
        html += '</div>';
      }
      if (draft.decisions && draft.decisions.length) {
        html += '<div class="field"><span class="label">Decisions</span>';
        draft.decisions.forEach(d => { html += '<div class="list-item">' + esc(d) + '</div>'; });
        html += '</div>';
      }
      if (draft.risks && draft.risks.length) {
        html += '<div class="field"><span class="label">Risks</span>';
        draft.risks.forEach(r => { html += '<div class="list-item">' + esc(r) + '</div>'; });
        html += '</div>';
      }
      if (draft.nextStep) html += '<div class="field"><span class="label">Next Step</span><div class="value">' + esc(draft.nextStep) + '</div></div>';

      draftContent.innerHTML = html || '<div style="color:var(--vscode-descriptionForeground)">Describe your project to start building the draft...</div>';
      acceptBtn.style.display = draft.goal ? '' : 'none';
    }

    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setSending(sending) {
      sendBtn.disabled = sending;
      inputEl.disabled = sending;
      const existing = messagesEl.querySelector('.sending-indicator');
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

    // Handle init
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'init') {
        currentMode = msg.mode;
        modeBar.textContent = msg.mode === 'kickoff' ? 'Setting up project...' : 'Project Chat';
        inputEl.placeholder = msg.mode === 'kickoff' ? 'Describe your project...' : 'Create tasks, ask questions...';
        messagesEl.innerHTML = '';
        for (const m of msg.messages) renderMessage(m);
        if (msg.mode === 'kickoff') renderDraftState(msg.draftState);
        scrollToBottom();
      }
      if (msg.type === 'assistantMessage') {
        setSending(false);
        renderMessage(msg.message);
        if (msg.draftState !== undefined) renderDraftState(msg.draftState);
        scrollToBottom();
      }
      if (msg.type === 'modeChanged') {
        currentMode = msg.mode;
        modeBar.textContent = msg.mode === 'kickoff' ? 'Setting up project...' : 'Project Chat';
        inputEl.placeholder = msg.mode === 'kickoff' ? 'Describe your project...' : 'Create tasks, ask questions...';
        draftSection.style.display = 'none';
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
      vscode.postMessage({ type: 'acceptDraftState' });
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
    const msg = message as { type: string; text?: string; task?: DraftTask };

    if (msg.type === 'sendMessage' && msg.text) {
      await this.handleSendMessage(msg.text);
    } else if (msg.type === 'acceptDraftState') {
      await this.handleAcceptDraftState();
    } else if (msg.type === 'confirmTask' && msg.task) {
      await this.handleConfirmTask(msg.task);
    } else if (msg.type === 'editTask' && msg.task) {
      await this.handleEditTask(msg.task);
    }
  }

  private async handleSendMessage(text: string): Promise<void> {
    if (this.sending || !this.session) return;
    this.sending = true;

    // Add user message to session
    const userMsg: ChatMessage = {
      id: generateChatMessageId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    this.session.messages.push(userMsg);
    await this.store.chat.save(this.session);

    try {
      // Get current state (null if kickoff)
      let state: CanonicalProjectState | null = null;
      try {
        const current = await this.store.state.getCurrentState();
        if (current.goal) state = current;
      } catch { /* no state yet */ }

      const memory = await this.store.memory.get();

      const result = await sendChatTurn(
        this.session.messages,
        state,
        memory,
        this.session.mode,
        { workingDirectory: this.workspaceRoot },
      );

      // Build assistant message
      const assistantMsg: ChatMessage = {
        id: generateChatMessageId(),
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString(),
        draftState: result.draftState,
        draftTask: result.draftTask,
      };
      this.session.messages.push(assistantMsg);

      // Update accumulated draft state in kickoff mode
      if (this.session.mode === 'kickoff' && result.draftState) {
        this.session.currentDraftState = mergeDraftState(
          this.session.currentDraftState,
          result.draftState,
        );
      }

      await this.store.chat.save(this.session);

      this.postMessage({
        type: 'assistantMessage',
        message: assistantMsg,
        draftState: this.session.mode === 'kickoff' ? this.session.currentDraftState : undefined,
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
      // Create populated initial state from draft
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

      // Transition chat to steering mode
      this.session.mode = 'steering';
      this.session.currentDraftState = null;
      await this.store.chat.save(this.session);

      vscode.commands.executeCommand('setContext', 'morticus.projectInitialized', true);

      this.postMessage({ type: 'modeChanged', mode: 'steering' });
      vscode.window.showInformationMessage(`Project state v1 created. Goal: "${draft.goal}"`);
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

      vscode.window.showInformationMessage(`Task "${draft.title}" created.`);
      this.onStateAccepted(); // refresh tree views
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to create task: ${(err as Error).message}`);
    }
  }

  private async handleEditTask(draft: DraftTask): Promise<void> {
    // Prefill the existing manual task creation flow
    const title = await vscode.window.showInputBox({ prompt: 'Task title', value: draft.title });
    if (title === undefined) return;

    const goal = await vscode.window.showInputBox({ prompt: 'Task goal', value: draft.goal });
    if (goal === undefined) return;

    const taskType = await vscode.window.showQuickPick(
      ['discovery', 'implementation', 'validation'],
      { placeHolder: 'Task type' },
    );
    if (!taskType) return;

    const scopeInput = await vscode.window.showInputBox({
      prompt: 'Scope paths (comma-separated)',
      value: draft.scopePaths.join(', '),
    });
    if (scopeInput === undefined) return;

    const scopePaths = scopeInput ? scopeInput.split(',').map(s => s.trim()).filter(Boolean) : [];

    await this.handleConfirmTask({
      title: title || draft.title,
      goal: goal || draft.goal,
      taskType: taskType as DraftTask['taskType'],
      scopePaths,
    });
  }
}
