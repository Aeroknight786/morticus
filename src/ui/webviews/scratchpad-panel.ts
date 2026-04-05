import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { ProjectStore } from '../../storage/store.js';
import type { ChatMessage } from '../../domain/chat.js';
import type { ScratchpadSession, ScratchpadHandoff } from '../../domain/scratchpad.js';
import type { ScratchpadId } from '../../domain/ids.js';
import { generateChatMessageId } from '../../domain/ids.js';
import { sendScratchpadTurn, requestScratchpadHandoff } from '../../runtime/scratchpad-adapter.js';

// View-layer type for handoff actions dispatched back to commands.ts
export type ScratchpadHandoffAction =
  | { type: 'create_task'; handoff: ScratchpadHandoff; scratchpadId: ScratchpadId }
  | { type: 'send_draft_update'; handoff: ScratchpadHandoff; scratchpadId: ScratchpadId }
  | { type: 'archive'; handoff: ScratchpadHandoff; scratchpadId: ScratchpadId }
  | { type: 'discard'; scratchpadId: ScratchpadId }
  | { type: 'reopen'; scratchpadId: ScratchpadId };

export class ScratchpadPanel extends WebviewBase {
  private session: ScratchpadSession | null = null;
  private sending = false;

  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
    private workspaceRoot: string,
    private onHandoffAction: (action: ScratchpadHandoffAction) => Promise<void>,
  ) {
    super(extensionUri, 'morticus.scratchpadPanel', 'Scratchpad');
  }

  async showScratchpad(session: ScratchpadSession): Promise<void> {
    this.session = session;
    super.show(vscode.ViewColumn.Two);

    // Override dispose handler to auto-archive on close without handoff
    if (this.panel) {
      this.panel.onDidDispose(() => {
        if (this.session && this.session.status === 'active') {
          this.session.status = 'archived';
          this.session.closedAt = new Date().toISOString();
          this.store.scratchpad.save(this.session);
          vscode.window.showInformationMessage(
            'Scratchpad auto-archived. Reopen with "Morticus: Open Scratchpad".',
          );
        }
        this.panel = undefined;
      });
    }

    this.postMessage({
      type: 'init',
      messages: session.messages,
      origin: session.origin,
      parentContextSummary: session.parentContextSummary,
      status: session.status,
      handoff: session.handoff,
    });

    // Welcome message for new sessions
    if (session.messages.length === 0 && session.status === 'active') {
      this.postMessage({
        type: 'systemMessage',
        text: 'Scratchpad opened. Explore freely \u2014 nothing here affects your project until you hand off.\n\nClick "End Scratchpad" when you\'re done to generate a structured handoff summary.',
      });
    }
  }

  protected getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }
    #mode-bar { padding: 8px 16px; font-size: 12px; color: #e6a817; border-bottom: 2px solid #e6a817; font-weight: bold; }
    #origin-chip { padding: 6px 16px; font-size: 11px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-widget-border); }
    #origin-chip .origin-field { display: inline-block; margin-right: 12px; }
    #origin-chip .origin-label { font-weight: bold; text-transform: uppercase; font-size: 10px; margin-right: 4px; }
    #messages { flex: 1; overflow-y: auto; padding: 16px; }
    .msg { margin-bottom: 12px; padding: 10px 14px; border-radius: 8px; max-width: 85%; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; font-size: 13px; }
    .msg-user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-left: auto; }
    .msg-assistant { background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border); }
    .msg-system { background: transparent; border: 1px dashed #e6a817; color: var(--vscode-descriptionForeground); font-size: 12px; max-width: 100%; text-align: center; padding: 12px 16px; }
    .sending-indicator { text-align: center; padding: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    #input-area { padding: 12px 16px; border-top: 1px solid var(--vscode-widget-border); display: flex; gap: 8px; align-items: flex-end; }
    #input-area textarea { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: inherit; font-size: 13px; resize: none; border-radius: 4px; min-height: 40px; max-height: 120px; }
    #input-area button { padding: 8px 16px; border: none; cursor: pointer; border-radius: 4px; font-size: 13px; }
    #input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    #send-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    #end-btn { background: #e6a817; color: #1a1a1a; font-weight: bold; }
    .handoff-card { margin: 12px 0; padding: 16px; background: var(--vscode-input-background); border: 2px solid #e6a817; border-radius: 8px; }
    .handoff-card h3 { color: #e6a817; margin-bottom: 12px; font-size: 14px; }
    .handoff-section { margin: 8px 0; }
    .handoff-label { font-weight: bold; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .handoff-value { font-size: 13px; margin-bottom: 8px; }
    .handoff-list-item { margin-left: 12px; font-size: 13px; }
    .handoff-list-item::before { content: "\\2022 "; }
    .handoff-candidate { margin: 8px 0; padding: 10px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
    .handoff-candidate h4 { font-size: 12px; color: var(--vscode-textLink-foreground); margin-bottom: 6px; }
    .handoff-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
    .handoff-actions button { padding: 6px 14px; border: none; cursor: pointer; font-size: 12px; border-radius: 4px; }
    .btn-task { background: #4caf50; color: white; }
    .btn-delta { background: #1976d2; color: white; }
    .btn-archive { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-discard { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-reopen { background: #e6a817; color: #1a1a1a; }
    .empty-note { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 12px; }
    #archive-hint { padding: 4px 16px; font-size: 11px; color: var(--vscode-descriptionForeground); text-align: center; border-top: 1px solid var(--vscode-widget-border); }
  </style>
</head>
<body>
  <div id="mode-bar">SCRATCHPAD (exploratory \u2014 changes require handoff)</div>
  <div id="origin-chip"></div>
  <div id="messages"></div>
  <div id="archive-hint">Closing this panel without clicking "End Scratchpad" will auto-archive the session.</div>
  <div id="input-area">
    <textarea id="input" placeholder="Explore freely..." rows="2"></textarea>
    <button id="send-btn">Send</button>
    <button id="end-btn">End Scratchpad</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const endBtn = document.getElementById('end-btn');
    const originChip = document.getElementById('origin-chip');
    const archiveHint = document.getElementById('archive-hint');
    let inputDisabled = false;

    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function renderOrigin(origin) {
      if (!origin) { originChip.style.display = 'none'; return; }
      let html = '<span class="origin-field"><span class="origin-label">From:</span> Main Chat</span>';
      if (origin.goal) {
        const short = origin.goal.length > 60 ? origin.goal.slice(0, 57) + '...' : origin.goal;
        html += '<span class="origin-field"><span class="origin-label">Goal:</span> ' + esc(short) + '</span>';
      }
      if (origin.phase) {
        html += '<span class="origin-field"><span class="origin-label">Phase:</span> ' + esc(origin.phase) + '</span>';
      }
      originChip.innerHTML = html;
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
    }

    function renderHandoff(handoff) {
      const card = document.createElement('div');
      card.className = 'handoff-card';
      let html = '<h3>Handoff Summary</h3>';

      html += '<div class="handoff-section"><div class="handoff-label">Summary</div>';
      html += '<div class="handoff-value">' + esc(handoff.summary) + '</div></div>';

      if (handoff.keyFindings && handoff.keyFindings.length > 0) {
        html += '<div class="handoff-section"><div class="handoff-label">Key Findings</div>';
        handoff.keyFindings.forEach(function(f) {
          html += '<div class="handoff-list-item">' + esc(f) + '</div>';
        });
        html += '</div>';
      }

      if (handoff.unresolvedQuestions && handoff.unresolvedQuestions.length > 0) {
        html += '<div class="handoff-section"><div class="handoff-label">Unresolved Questions</div>';
        handoff.unresolvedQuestions.forEach(function(q) {
          html += '<div class="handoff-list-item">' + esc(q) + '</div>';
        });
        html += '</div>';
      }

      if (handoff.candidateTask) {
        html += '<div class="handoff-candidate"><h4>Candidate Task</h4>';
        html += '<div class="handoff-value">"' + esc(handoff.candidateTask.title) + '" [' + esc(handoff.candidateTask.taskType) + ']</div>';
        html += '<div class="handoff-value">' + esc(handoff.candidateTask.goal) + '</div>';
        html += '</div>';
      }

      if (handoff.candidateDelta) {
        html += '<div class="handoff-candidate"><h4>Candidate State Update</h4>';
        handoff.candidateDelta.operations.forEach(function(op) {
          html += '<div class="handoff-list-item">' + esc(op.type) + (op.value ? ': ' + esc(op.value) : '') + (op.path ? ': ' + esc(op.path) : '') + '</div>';
        });
        if (handoff.candidateDelta.rationale) {
          html += '<div class="handoff-value" style="margin-top:4px;font-size:12px;color:var(--vscode-descriptionForeground)">' + esc(handoff.candidateDelta.rationale) + '</div>';
        }
        html += '</div>';
      }

      html += '<div class="handoff-actions">';
      if (handoff.candidateTask) {
        html += '<button class="btn-task" data-action="create_task">Create Task</button>';
      }
      if (handoff.candidateDelta) {
        html += '<button class="btn-delta" data-action="send_draft_update">Send to Review</button>';
      }
      html += '<button class="btn-archive" data-action="archive">Archive Only</button>';
      html += '<button class="btn-discard" data-action="discard">Discard</button>';
      html += '<button class="btn-reopen" data-action="reopen">Continue Exploring</button>';
      html += '</div>';

      card.innerHTML = html;

      // Wire action buttons
      card.querySelectorAll('[data-action]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var action = btn.getAttribute('data-action');
          vscode.postMessage({ type: 'handoffAction', action: action });
        });
      });

      messagesEl.appendChild(card);
    }

    function setSending(sending) {
      sendBtn.disabled = sending;
      inputEl.disabled = sending;
      var existing = messagesEl.querySelector('.sending-indicator');
      if (sending && !existing) {
        var el = document.createElement('div');
        el.className = 'sending-indicator';
        el.textContent = 'Thinking...';
        messagesEl.appendChild(el);
        scrollToBottom();
      } else if (!sending && existing) {
        existing.remove();
      }
    }

    function setInputDisabled(disabled) {
      inputDisabled = disabled;
      inputEl.disabled = disabled;
      sendBtn.disabled = disabled;
      endBtn.disabled = disabled;
      if (disabled) {
        inputEl.placeholder = 'Scratchpad ended. Choose a handoff action above.';
        archiveHint.style.display = 'none';
      }
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Handle messages from extension
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.type === 'init') {
        messagesEl.innerHTML = '';
        renderOrigin(msg.origin);
        for (var i = 0; i < msg.messages.length; i++) {
          renderMessage(msg.messages[i]);
        }
        if (msg.status === 'handed_off' && msg.handoff) {
          renderHandoff(msg.handoff);
          setInputDisabled(true);
        }
        scrollToBottom();
      }
      if (msg.type === 'systemMessage') {
        renderSystemMessage(msg.text);
        scrollToBottom();
      }
      if (msg.type === 'assistantMessage') {
        setSending(false);
        renderMessage(msg.message);
        scrollToBottom();
      }
      if (msg.type === 'handoffReady') {
        setSending(false);
        renderHandoff(msg.handoff);
        setInputDisabled(true);
        scrollToBottom();
      }
      if (msg.type === 'reopened') {
        setInputDisabled(false);
        inputEl.placeholder = 'Explore freely...';
        renderSystemMessage('Scratchpad reopened. Continue exploring.');
        scrollToBottom();
      }
      if (msg.type === 'error') {
        setSending(false);
        var div = document.createElement('div');
        div.className = 'msg msg-assistant';
        div.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
        div.textContent = 'Error: ' + msg.error;
        messagesEl.appendChild(div);
        scrollToBottom();
      }
    });

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    endBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'endScratchpad' });
    });

    function send() {
      if (inputDisabled) return;
      var text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      renderMessage({ role: 'user', content: text });
      scrollToBottom();
      setSending(true);
      vscode.postMessage({ type: 'sendMessage', text: text });
    }
  </script>
</body>
</html>`;
  }

  protected async onMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; text?: string; action?: string };

    if (msg.type === 'sendMessage' && msg.text) {
      await this.handleSendMessage(msg.text);
    } else if (msg.type === 'endScratchpad') {
      await this.handleEndScratchpad();
    } else if (msg.type === 'handoffAction' && msg.action) {
      await this.handleHandoffAction(msg.action);
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
    await this.store.scratchpad.save(this.session);

    try {
      let state = null;
      try {
        const current = await this.store.state.getCurrentState();
        if (current.goal) state = current;
      } catch { /* no state yet */ }

      const memory = await this.store.memory.get();
      const result = await sendScratchpadTurn(
        this.session.messages,
        this.session.parentContextSummary,
        state,
        memory,
        { workingDirectory: this.workspaceRoot },
      );

      const assistantMsg: ChatMessage = {
        id: generateChatMessageId(),
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString(),
      };
      this.session.messages.push(assistantMsg);
      await this.store.scratchpad.save(this.session);

      this.postMessage({ type: 'assistantMessage', message: assistantMsg });
    } catch (err) {
      this.postMessage({ type: 'error', error: (err as Error).message });
    } finally {
      this.sending = false;
    }
  }

  private async handleEndScratchpad(): Promise<void> {
    if (this.sending || !this.session) return;
    this.sending = true;

    this.postMessage({
      type: 'systemMessage',
      text: 'Generating handoff summary...',
    });

    try {
      let state = null;
      try {
        const current = await this.store.state.getCurrentState();
        if (current.goal) state = current;
      } catch { /* no state yet */ }

      const memory = await this.store.memory.get();
      const handoff = await requestScratchpadHandoff(
        this.session.messages,
        this.session.parentContextSummary,
        state,
        memory,
        { workingDirectory: this.workspaceRoot },
      );

      this.session.handoff = handoff;
      this.session.status = 'handed_off';
      await this.store.scratchpad.save(this.session);

      this.postMessage({ type: 'handoffReady', handoff });
    } catch (err) {
      this.postMessage({ type: 'error', error: (err as Error).message });
    } finally {
      this.sending = false;
    }
  }

  private async handleHandoffAction(action: string): Promise<void> {
    if (!this.session) return;

    if (action === 'reopen') {
      this.session.status = 'active';
      this.session.handoff = null;
      this.session.closedAt = null;
      await this.store.scratchpad.save(this.session);
      this.postMessage({ type: 'reopened' });
      await this.onHandoffAction({ type: 'reopen', scratchpadId: this.session.id });
      return;
    }

    try {
      if (action === 'discard') {
        const scratchpadId = this.session.id;
        await this.onHandoffAction({ type: 'discard', scratchpadId });
        this.session.status = 'discarded';
        this.session.closedAt = new Date().toISOString();
        await this.store.scratchpad.save(this.session);
        this.session = null; // prevent auto-archive on dispose
        this.dispose();
        return;
      }

      const handoff = this.session.handoff;
      if (!handoff) return;

      if (action === 'archive') {
        await this.onHandoffAction({ type: 'archive', handoff, scratchpadId: this.session.id });
      } else if (action === 'create_task' && handoff.candidateTask) {
        await this.onHandoffAction({ type: 'create_task', handoff, scratchpadId: this.session.id });
      } else if (action === 'send_draft_update' && handoff.candidateDelta) {
        await this.onHandoffAction({ type: 'send_draft_update', handoff, scratchpadId: this.session.id });
      } else {
        return;
      }

      this.session.status = 'archived';
      this.session.closedAt = new Date().toISOString();
      await this.store.scratchpad.save(this.session);
      this.session = null;
      this.dispose();
    } catch (err) {
      this.postMessage({ type: 'error', error: (err as Error).message });
    }
  }
}
