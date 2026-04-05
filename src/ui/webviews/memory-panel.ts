import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { MemoryEntry, MemoryCategory } from '../../domain/durable-memory.js';
import type { ProjectStore } from '../../storage/store.js';
import { generateMemoryEntryId } from '../../domain/ids.js';

export class MemoryPanel extends WebviewBase {
  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
    private onChanged: () => void,
  ) {
    super(extensionUri, 'morticus.memoryPanel', 'Durable Memory');
  }

  async show(column?: vscode.ViewColumn): Promise<void> {
    super.show(column);
    await this.loadAndSend();
  }

  private async loadAndSend(): Promise<void> {
    try {
      const memory = await this.store.memory.get();
      this.postMessage({ type: 'loadMemory', memory });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load memory: ${(err as Error).message}`);
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
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-input-border); font-size: 13px; }
    th { font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; }
    .badge-user { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .badge-auto { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningBorder); }
    .badge-unreviewed { background: var(--vscode-inputValidation-warningBackground); font-size: 10px; margin-left: 4px; }
    .inactive { opacity: 0.5; }
    button { padding: 4px 10px; border: none; cursor: pointer; font-size: 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-right: 4px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.danger { background: #f44336; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    h3 { margin-top: 20px; }
    label { display: block; margin-top: 8px; font-weight: bold; font-size: 12px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    input, textarea, select { width: 100%; box-sizing: border-box; padding: 6px 8px; margin-top: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-font-family); font-size: 13px; }
    textarea { min-height: 80px; resize: vertical; }
    .form-actions { margin-top: 12px; }
    .meta { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
  </style>
</head>
<body>
  <h2>Durable Memory</h2>
  <div class="meta" id="meta"></div>
  <table>
    <thead><tr><th>Category</th><th>Title</th><th>Origin</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody id="entries"></tbody>
  </table>

  <h3 id="form-title">Add Entry</h3>
  <input type="hidden" id="edit-id" value="" />
  <label>Category</label>
  <select id="category">
    <option value="coding_standard">Coding Standard</option>
    <option value="architecture_invariant">Architecture Invariant</option>
    <option value="environment_setup">Environment Setup</option>
    <option value="domain_glossary">Domain Glossary</option>
    <option value="workflow_preference">Workflow Preference</option>
    <option value="test_convention">Test Convention</option>
    <option value="custom">Custom</option>
  </select>
  <label>Title</label>
  <input id="title" placeholder="Short descriptive title" />
  <label>Content</label>
  <textarea id="content" placeholder="Full content of this memory entry"></textarea>
  <div class="form-actions">
    <button id="save-btn">Save</button>
    <button id="cancel-btn" style="display:none">Cancel</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let entries = [];
    let editingId = null;

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'loadMemory') {
        const memory = msg.memory;
        entries = memory.entries;
        document.getElementById('meta').textContent =
          'Version: ' + memory.version + ' | Entries: ' + entries.length;
        renderTable();
      }
    });

    function renderTable() {
      const tbody = document.getElementById('entries');
      tbody.innerHTML = '';
      for (const e of entries) {
        const tr = document.createElement('tr');
        if (!e.active) tr.className = 'inactive';

        const catTd = document.createElement('td');
        catTd.textContent = e.category.replace(/_/g, ' ');
        tr.appendChild(catTd);

        const titleTd = document.createElement('td');
        titleTd.textContent = e.title;
        if (!e.reviewed) {
          const badge = document.createElement('span');
          badge.className = 'badge badge-unreviewed';
          badge.textContent = 'unreviewed';
          titleTd.appendChild(badge);
        }
        tr.appendChild(titleTd);

        const originTd = document.createElement('td');
        const originBadge = document.createElement('span');
        originBadge.className = 'badge ' + (e.origin === 'user' ? 'badge-user' : 'badge-auto');
        originBadge.textContent = e.origin === 'user' ? 'user' : 'auto';
        originTd.appendChild(originBadge);
        tr.appendChild(originTd);

        const statusTd = document.createElement('td');
        statusTd.textContent = e.active ? 'active' : 'inactive';
        tr.appendChild(statusTd);

        const actionsTd = document.createElement('td');

        if (!e.reviewed && e.origin === 'auto_extracted') {
          const reviewBtn = document.createElement('button');
          reviewBtn.textContent = 'Review';
          reviewBtn.onclick = () => vscode.postMessage({ type: 'markReviewed', entryId: e.id });
          actionsTd.appendChild(reviewBtn);
        }

        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = e.active ? 'Deactivate' : 'Activate';
        toggleBtn.disabled = !e.reviewed;
        toggleBtn.title = !e.reviewed ? 'Review before activating' : '';
        toggleBtn.onclick = () => vscode.postMessage({ type: 'toggleActive', entryId: e.id });
        actionsTd.appendChild(toggleBtn);

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.onclick = () => startEdit(e);
        actionsTd.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.className = 'danger';
        delBtn.onclick = () => vscode.postMessage({ type: 'removeEntry', entryId: e.id });
        actionsTd.appendChild(delBtn);

        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
      }
    }

    function startEdit(e) {
      editingId = e.id;
      document.getElementById('edit-id').value = e.id;
      document.getElementById('category').value = e.category;
      document.getElementById('title').value = e.title;
      document.getElementById('content').value = e.content;
      document.getElementById('form-title').textContent = 'Edit Entry';
      document.getElementById('cancel-btn').style.display = '';
    }

    document.getElementById('cancel-btn').addEventListener('click', () => {
      editingId = null;
      document.getElementById('edit-id').value = '';
      document.getElementById('category').value = 'coding_standard';
      document.getElementById('title').value = '';
      document.getElementById('content').value = '';
      document.getElementById('form-title').textContent = 'Add Entry';
      document.getElementById('cancel-btn').style.display = 'none';
    });

    document.getElementById('save-btn').addEventListener('click', () => {
      const category = document.getElementById('category').value;
      const title = document.getElementById('title').value.trim();
      const content = document.getElementById('content').value.trim();
      if (!title || !content) return;

      if (editingId) {
        vscode.postMessage({ type: 'updateEntry', entryId: editingId, updates: { category, title, content } });
      } else {
        vscode.postMessage({ type: 'addEntry', entry: { category, title, content } });
      }
      editingId = null;
      document.getElementById('edit-id').value = '';
      document.getElementById('title').value = '';
      document.getElementById('content').value = '';
      document.getElementById('form-title').textContent = 'Add Entry';
      document.getElementById('cancel-btn').style.display = 'none';
    });
  </script>
</body>
</html>`;
  }

  protected async onMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; [key: string]: unknown };

    if (msg.type === 'addEntry') {
      const data = msg.entry as { category: MemoryCategory; title: string; content: string };
      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        id: generateMemoryEntryId(),
        category: data.category,
        title: data.title,
        content: data.content,
        origin: 'user',
        active: true,
        reviewed: true,
        normalizedValue: null,
        sourceArchiveId: null,
        memCellId: null,
        sourceTaskId: null,
        sourceRunId: null,
        sourceDeltaId: null,
        sourceOperationType: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.memory.addEntry(entry);
      this.onChanged();
      await this.loadAndSend();
    }

    if (msg.type === 'updateEntry') {
      const entryId = msg.entryId as string;
      const updates = msg.updates as { category?: MemoryCategory; title?: string; content?: string };

      // If content is being edited, check if this is an auto-extracted entry
      // whose content has changed — convert to user-owned
      if (updates.content !== undefined) {
        const existing = await this.store.memory.getEntry(entryId as never);
        if (existing && existing.origin === 'auto_extracted' && updates.content !== existing.content) {
          await this.store.memory.updateEntry(entryId as never, {
            ...updates,
            reviewed: true,
          });
          // Convert origin and clear normalizedValue — must do a full get/save
          const memory = await this.store.memory.get();
          const idx = memory.entries.findIndex(e => e.id === entryId);
          if (idx !== -1) {
            memory.entries[idx].origin = 'user';
            memory.entries[idx].normalizedValue = null;
            await this.store.memory.save(memory);
          }
          this.onChanged();
          await this.loadAndSend();
          return;
        }
      }

      await this.store.memory.updateEntry(entryId as never, updates);
      this.onChanged();
      await this.loadAndSend();
    }

    if (msg.type === 'removeEntry') {
      await this.store.memory.removeEntry(msg.entryId as never);
      this.onChanged();
      await this.loadAndSend();
    }

    if (msg.type === 'toggleActive') {
      const existing = await this.store.memory.getEntry(msg.entryId as never);
      if (existing) {
        // Cannot activate unreviewed entries
        if (!existing.reviewed && !existing.active) {
          vscode.window.showWarningMessage('Review this entry before activating it.');
          return;
        }
        await this.store.memory.updateEntry(msg.entryId as never, { active: !existing.active });
        this.onChanged();
        await this.loadAndSend();
      }
    }

    if (msg.type === 'markReviewed') {
      await this.store.memory.updateEntry(msg.entryId as never, { reviewed: true });
      this.onChanged();
      await this.loadAndSend();
    }
  }
}
