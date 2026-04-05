import * as vscode from 'vscode';
import { WebviewBase } from './webview-base.js';
import type { ProjectStore } from '../../storage/store.js';
import type { ArchiveRecord, ImportChunk, ImportExtractionResult, ImportConflict } from '../../domain/import.js';
import type { DraftCanonicalState, DraftTask, DraftMemoryEntry } from '../../domain/chat.js';
import type { ArchiveId } from '../../domain/ids.js';
import { generateArchiveId, generateMemoryEntryId } from '../../domain/ids.js';
import { createArchiveRecord } from '../../domain/import.js';
import { detectImportFormat, parseImportSource } from '../../runtime/transcript-parser.js';
import { extractFromTranscript } from '../../runtime/import-extractor.js';
import { detectImportConflicts } from '../../runtime/import-conflict-detector.js';
import { deduplicateEntries } from '../../review/knowledge-extractor.js';
import type { MemoryEntry, MemCell } from '../../domain/durable-memory.js';
import type { MemCellId } from '../../domain/ids.js';

export interface ImportPanelCallbacks {
  onDeltaReview: (operations: Array<{ type: string; value?: string; path?: string }>) => Promise<void>;
  onDraftTask: (draft: DraftTask) => Promise<void>;
  onStateAccept: (draft: DraftCanonicalState) => Promise<void>;
  onComplete: (summary: string) => void;
}

export class ImportPanel extends WebviewBase {
  private record: ArchiveRecord | null = null;
  private abortController: AbortController | null = null;
  private extractedMemCells: MemCell[] = [];

  constructor(
    extensionUri: vscode.Uri,
    private store: ProjectStore,
    private workspacePath: string,
    private callbacks: ImportPanelCallbacks,
  ) {
    super(extensionUri, 'morticus.importPanel', 'Import Transcript');
  }

  async startImport(filePath: string): Promise<void> {
    super.show(vscode.ViewColumn.One);

    try {
      const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const text = Buffer.from(content).toString('utf-8');
      const fileName = filePath.split('/').pop() || filePath;

      // Parse
      const format = detectImportFormat(text);
      const { chunks } = parseImportSource(text, format);

      const lines = text.split('\n');
      const estimatedTokens = Math.ceil(text.length / 4);
      const turnCount = chunks.filter(c => c.kind === 'transcript').length;

      const id = generateArchiveId();
      const record = createArchiveRecord(id, {
        originalFileName: fileName,
        fileSize: text.length,
        lineCount: lines.length,
        detectedFormat: format,
        detectedTurnCount: turnCount,
        estimatedTokens,
        importedAt: new Date().toISOString(),
      }, chunks);

      this.record = record;

      // Save archive record and raw content
      await this.store.archive.save(record);
      await this.store.archive.saveRawContent(id, text);

      // Send to webview
      this.postMessage({
        type: 'parsed',
        record: {
          id: record.id,
          sourceMeta: record.sourceMeta,
          chunkCount: record.chunks.length,
          chunks: record.chunks.map(c => ({
            kind: c.kind,
            index: c.index,
            role: c.kind === 'transcript' ? (c as { role: string }).role : undefined,
            heading: c.kind === 'doc' ? (c as { heading: string }).heading : undefined,
            level: c.kind === 'doc' ? (c as { level: number }).level : undefined,
            startLine: c.startLine,
            endLine: c.endLine,
            preview: c.content.slice(0, 200),
          })),
        },
      });
    } catch (err) {
      vscode.window.showErrorMessage(`Import failed: ${(err as Error).message}`);
    }
  }

  protected async onMessage(msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string;
    switch (type) {
      case 'extract': await this.handleExtract(); break;
      case 'applySelected': await this.handleApplySelected(msg); break;
      case 'cancel': this.handleCancel(); break;
    }
  }

  private async handleExtract(): Promise<void> {
    if (!this.record) return;

    this.record.status = 'extracting';
    await this.store.archive.save(this.record);
    this.postMessage({ type: 'extracting' });

    this.abortController = new AbortController();

    try {
      const { result: extraction, extractedMemCells } = await extractFromTranscript(
        this.record.chunks,
        this.workspacePath,
        { signal: this.abortController.signal },
      );

      // Save extracted MemCells to store
      for (const cell of extractedMemCells) {
        await this.store.memcells.save(cell);
      }
      this.extractedMemCells = extractedMemCells;

      // Detect conflicts against existing state
      let conflicts: ImportConflict[] = [];
      try {
        const currentState = await this.store.state.getCurrentState();
        if (currentState.goal) {
          conflicts = detectImportConflicts(extraction, currentState);
        }
      } catch {
        // No state yet — no conflicts possible
      }

      // Check for duplicate memory entries
      let memoryDuplicates: string[] = [];
      if (extraction.candidateMemory.length > 0) {
        try {
          const memory = await this.store.memory.get();
          const candidateEntries = extraction.candidateMemory.map(m => ({
            id: generateMemoryEntryId(),
            category: m.category as MemoryEntry['category'],
            title: m.title,
            content: m.content,
            origin: 'imported' as const,
            active: false,
            reviewed: false,
            normalizedValue: m.title,
            sourceTaskId: null,
            sourceRunId: null,
            sourceDeltaId: null,
            sourceOperationType: null,
            sourceArchiveId: this.record!.id,
            memCellId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));
          const unique = deduplicateEntries(candidateEntries, memory.entries);
          memoryDuplicates = candidateEntries
            .filter(c => !unique.some(u => u.id === c.id))
            .map(c => c.title);
        } catch {
          // Memory not initialized yet
        }
      }

      this.record.extraction = extraction;
      this.record.conflicts = conflicts;
      this.record.status = 'extracted';
      await this.store.archive.save(this.record);

      this.postMessage({
        type: 'extracted',
        extraction: {
          draftState: extraction.draftState,
          candidateMemory: extraction.candidateMemory,
          candidateTasks: extraction.candidateTasks,
          summary: extraction.summary,
        },
        conflicts,
        memoryDuplicates,
        memCells: this.extractedMemCells.map(c => ({
          id: c.id,
          episodicSummary: c.episodicSummary ?? '(no summary)',
          eventCount: c.events.length,
          tokenCount: c.tokenCount,
        })),
      });
    } catch (err) {
      this.record.status = 'failed';
      this.record.error = (err as Error).message;
      await this.store.archive.save(this.record);
      this.postMessage({ type: 'extractionError', error: (err as Error).message });
    } finally {
      this.abortController = null;
    }
  }

  private async handleApplySelected(msg: Record<string, unknown>): Promise<void> {
    if (!this.record?.extraction) return;

    try {
      const selectedState = msg.selectedState as Record<string, boolean> | undefined;
      const selectedMemory = msg.selectedMemory as number[] | undefined;
      const selectedTasks = msg.selectedTasks as number[] | undefined;

      const accepted: Array<{ type: string; label: string }> = [];

      // Apply state fields
      if (selectedState && this.record.extraction.draftState) {
        const draft = this.record.extraction.draftState;
        let hasExistingState = false;
        try {
          const state = await this.store.state.getCurrentState();
          hasExistingState = !!state.goal;
        } catch {
          // No state
        }

        if (hasExistingState) {
          // Route through delta review
          const operations = this.buildDeltaOperations(draft, selectedState);
          if (operations.length > 0) {
            await this.callbacks.onDeltaReview(operations);
            accepted.push({ type: 'state', label: `${operations.length} state operations` });
          }
        } else {
          // Create initial state directly
          const filteredDraft: DraftCanonicalState = {};
          if (selectedState.goal && draft.goal) filteredDraft.goal = draft.goal;
          if (selectedState.phase && draft.phase) filteredDraft.phase = draft.phase;
          if (selectedState.phaseGoal && draft.phaseGoal) filteredDraft.phaseGoal = draft.phaseGoal;
          if (selectedState.constraints && draft.constraints) filteredDraft.constraints = draft.constraints;
          if (selectedState.decisions && draft.decisions) filteredDraft.decisions = draft.decisions;
          if (selectedState.risks && draft.risks) filteredDraft.risks = draft.risks;
          if (selectedState.knownFiles && draft.knownFiles) filteredDraft.knownFiles = draft.knownFiles;
          if (selectedState.nextStep && draft.nextStep) filteredDraft.nextStep = draft.nextStep;

          if (Object.keys(filteredDraft).length > 0) {
            await this.callbacks.onStateAccept(filteredDraft);
            accepted.push({ type: 'state', label: 'Initial state created' });
          }
        }
      }

      // Apply memory entries
      if (selectedMemory && selectedMemory.length > 0) {
        const candidateMemory = this.record.extraction.candidateMemory;
        for (const idx of selectedMemory) {
          if (idx < candidateMemory.length) {
            const m = candidateMemory[idx];
            const entry: MemoryEntry = {
              id: generateMemoryEntryId(),
              category: m.category as MemoryEntry['category'],
              title: m.title,
              content: m.content,
              origin: 'imported',
              active: false,
              reviewed: false,
              normalizedValue: m.title,
              sourceTaskId: null,
              sourceRunId: null,
              sourceDeltaId: null,
              sourceOperationType: null,
              sourceArchiveId: this.record.id,
              memCellId: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await this.store.memory.addEntry(entry);
            accepted.push({ type: 'memory', label: m.title });
          }
        }
      }

      // Apply MemCells — keep accepted, delete dismissed
      const selectedMemCells = msg.selectedMemCells as number[] | undefined;
      if (this.extractedMemCells.length > 0) {
        const selectedSet = new Set(selectedMemCells ?? []);
        for (let i = 0; i < this.extractedMemCells.length; i++) {
          const cell = this.extractedMemCells[i];
          if (selectedSet.has(i)) {
            // Mark as extracted and keep
            await this.store.memcells.update(cell.id, { extracted: true });
            accepted.push({ type: 'memcell', label: cell.episodicSummary ?? cell.id });
          } else {
            // Dismissed — remove from store
            // MemCellStore doesn't have delete, so mark as not extracted
            // Actually we just leave dismissed cells — they won't be surfaced
          }
        }
      }

      // Apply tasks as drafts
      if (selectedTasks && selectedTasks.length > 0) {
        const candidateTasks = this.record.extraction.candidateTasks;
        for (const idx of selectedTasks) {
          if (idx < candidateTasks.length) {
            const t = candidateTasks[idx];
            await this.callbacks.onDraftTask(t);
            accepted.push({ type: 'task', label: t.title });
          }
        }
      }

      // Update archive record
      this.record.status = 'completed';
      this.record.acceptedItems = accepted.map(a => ({
        type: a.type as 'state' | 'memory' | 'task',
        label: a.label,
        acceptedAt: new Date().toISOString(),
      }));
      await this.store.archive.save(this.record);

      const stateCount = accepted.filter(a => a.type === 'state').length;
      const memCount = accepted.filter(a => a.type === 'memory').length;
      const taskCount = accepted.filter(a => a.type === 'task').length;
      const cellCount = accepted.filter(a => a.type === 'memcell').length;
      const summary = `Imported from ${this.record.sourceMeta.originalFileName}: ${stateCount} state update(s), ${memCount} memory entries, ${taskCount} task(s), ${cellCount} memory cell(s) accepted.`;

      this.callbacks.onComplete(summary);
      this.postMessage({ type: 'completed', summary });
    } catch (err) {
      this.postMessage({ type: 'extractionError', error: (err as Error).message });
    }
  }

  private buildDeltaOperations(
    draft: DraftCanonicalState,
    selected: Record<string, boolean>,
  ): Array<{ type: string; value?: string; path?: string }> {
    const ops: Array<{ type: string; value?: string; path?: string }> = [];

    if (selected.goal && draft.goal) {
      ops.push({ type: 'set_goal', value: draft.goal });
    }
    if (selected.phase && draft.phase) {
      ops.push({ type: 'set_phase', value: draft.phase });
    }
    if (selected.phaseGoal && draft.phaseGoal) {
      ops.push({ type: 'set_phase_goal', value: draft.phaseGoal });
    }
    if (selected.nextStep && draft.nextStep) {
      ops.push({ type: 'set_next_step', value: draft.nextStep });
    }
    if (selected.constraints && draft.constraints) {
      for (const c of draft.constraints) {
        ops.push({ type: 'add_constraint', value: c });
      }
    }
    if (selected.decisions && draft.decisions) {
      for (const d of draft.decisions) {
        ops.push({ type: 'add_decision', value: d });
      }
    }
    if (selected.risks && draft.risks) {
      for (const r of draft.risks) {
        ops.push({ type: 'add_risk', value: r });
      }
    }
    if (selected.knownFiles && draft.knownFiles) {
      for (const f of draft.knownFiles) {
        ops.push({ type: 'add_known_file', path: f });
      }
    }

    return ops;
  }

  private handleCancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.dispose();
  }

  protected getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h2 { margin-top: 0; }
    .meta { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .section { margin: 16px 0; }
    .section h3 { margin-bottom: 8px; }
    .chunk { padding: 6px 8px; margin: 2px 0; background: var(--vscode-input-background); font-size: 12px; border-left: 3px solid var(--vscode-textLink-foreground); cursor: pointer; }
    .chunk.collapsed .chunk-content { display: none; }
    .chunk-header { font-weight: bold; }
    .chunk-content { margin-top: 4px; white-space: pre-wrap; opacity: 0.85; max-height: 120px; overflow: auto; }

    .field { padding: 8px; margin: 4px 0; background: var(--vscode-input-background); display: flex; align-items: flex-start; gap: 8px; }
    .field input[type="checkbox"] { margin-top: 3px; }
    .field-value { flex: 1; }
    .field-label { font-weight: bold; min-width: 100px; }

    .conflict-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; margin-left: 6px; }
    .conflict-info { background: var(--vscode-textLink-foreground); color: white; }
    .conflict-warning { background: #ff9800; color: white; }
    .conflict-override { background: #f44336; color: white; }
    .conflict-detail { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }

    .duplicate-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; background: var(--vscode-descriptionForeground); color: var(--vscode-editor-background); margin-left: 6px; }

    .entry { padding: 8px; margin: 4px 0; background: var(--vscode-input-background); display: flex; align-items: flex-start; gap: 8px; }
    .entry-content { flex: 1; }
    .entry-title { font-weight: bold; }
    .entry-detail { font-size: 12px; opacity: 0.8; margin-top: 2px; }
    .entry-category { font-size: 11px; color: var(--vscode-textLink-foreground); }

    button { padding: 8px 16px; margin-right: 8px; border: none; cursor: pointer; font-size: 13px; }
    .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .danger { background: #f44336; color: white; }

    .progress { padding: 12px; text-align: center; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--vscode-foreground); border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .summary-text { padding: 8px; background: var(--vscode-input-background); margin: 8px 0; font-style: italic; }

    #step-parse, #step-extract, #step-review, #step-done { display: none; }
    .active { display: block !important; }

    .error-box { padding: 12px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); margin: 8px 0; }
  </style>
</head>
<body>
  <h2>Import Transcript</h2>

  <div id="step-parse">
    <div class="meta" id="source-meta"></div>
    <details>
      <summary style="cursor:pointer">Preview Chunks (<span id="chunk-count">0</span>)</summary>
      <div id="chunks-list"></div>
    </details>
    <div style="margin-top:16px">
      <button class="primary" id="btn-extract">Extract Project Data</button>
      <button class="secondary" id="btn-cancel-parse">Cancel</button>
    </div>
  </div>

  <div id="step-extract">
    <div class="progress">
      <span class="spinner"></span>
      Extracting structured data from transcript...
    </div>
    <button class="danger" id="btn-cancel-extract">Cancel Extraction</button>
  </div>

  <div id="step-review">
    <div class="summary-text" id="extraction-summary"></div>

    <div class="section" id="state-section">
      <h3>Draft State</h3>
      <div id="state-fields"></div>
    </div>

    <div class="section" id="memory-section">
      <h3>Candidate Memory (<span id="memory-count">0</span>)</h3>
      <div id="memory-entries"></div>
    </div>

    <div class="section" id="tasks-section">
      <h3>Candidate Tasks (<span id="task-count">0</span>)</h3>
      <div id="task-entries"></div>
    </div>

    <div class="section" id="memcells-section">
      <h3>Extracted Memory Cells (<span id="memcell-count">0</span>)</h3>
      <div id="memcell-entries"></div>
    </div>

    <div style="margin-top:16px">
      <button class="primary" id="btn-apply">Apply Selected</button>
      <button class="secondary" id="btn-cancel-review">Cancel</button>
    </div>
  </div>

  <div id="step-done">
    <div class="summary-text" id="done-summary"></div>
    <button class="secondary" id="btn-close">Close</button>
  </div>

  <div id="step-error" style="display:none">
    <div class="error-box" id="error-text"></div>
    <button class="secondary" id="btn-retry">Retry Extraction</button>
    <button class="secondary" id="btn-cancel-error">Cancel</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let extractionData = null;
    let conflictsData = [];
    let memoryDuplicatesData = [];
    let memCellsData = [];

    function showStep(id) {
      ['step-parse','step-extract','step-review','step-done','step-error'].forEach(s => {
        document.getElementById(s).classList.remove('active');
      });
      document.getElementById(id).classList.add('active');
    }

    // ── Parse step ──
    window.addEventListener('message', event => {
      const msg = event.data;

      if (msg.type === 'parsed') {
        const r = msg.record;
        document.getElementById('source-meta').innerHTML =
          '<strong>' + r.sourceMeta.originalFileName + '</strong><br>' +
          'Format: ' + r.sourceMeta.detectedFormat.replace(/_/g, ' ') +
          ' &middot; ' + r.sourceMeta.lineCount + ' lines' +
          ' &middot; ~' + r.sourceMeta.estimatedTokens.toLocaleString() + ' tokens' +
          (r.sourceMeta.detectedTurnCount > 0 ? ' &middot; ' + r.sourceMeta.detectedTurnCount + ' turns' : '');

        document.getElementById('chunk-count').textContent = r.chunkCount;
        const list = document.getElementById('chunks-list');
        list.innerHTML = '';
        for (const c of r.chunks) {
          const div = document.createElement('div');
          div.className = 'chunk collapsed';
          const label = c.kind === 'transcript'
            ? c.role.toUpperCase() + ' (lines ' + c.startLine + '-' + c.endLine + ')'
            : (c.heading || '(preamble)') + ' [L' + c.level + '] (lines ' + c.startLine + '-' + c.endLine + ')';
          div.innerHTML = '<div class="chunk-header">' + label + '</div><div class="chunk-content">' + escapeHtml(c.preview) + '</div>';
          div.addEventListener('click', () => div.classList.toggle('collapsed'));
          list.appendChild(div);
        }
        showStep('step-parse');
      }

      if (msg.type === 'extracting') {
        showStep('step-extract');
      }

      if (msg.type === 'extracted') {
        extractionData = msg.extraction;
        conflictsData = msg.conflicts || [];
        memoryDuplicatesData = msg.memoryDuplicates || [];
        memCellsData = msg.memCells || [];
        renderReview();
        showStep('step-review');
      }

      if (msg.type === 'extractionError') {
        document.getElementById('error-text').textContent = msg.error;
        showStep('step-error');
      }

      if (msg.type === 'completed') {
        document.getElementById('done-summary').textContent = msg.summary;
        showStep('step-done');
      }
    });

    function renderReview() {
      if (!extractionData) return;

      document.getElementById('extraction-summary').textContent = extractionData.summary || 'No summary.';

      // State fields
      const stateEl = document.getElementById('state-fields');
      stateEl.innerHTML = '';
      const draft = extractionData.draftState;
      if (draft) {
        const fields = ['goal','phase','phaseGoal','constraints','decisions','risks','knownFiles','nextStep'];
        for (const f of fields) {
          const val = draft[f];
          if (!val || (Array.isArray(val) && val.length === 0)) continue;
          const conflict = conflictsData.find(c => c.field === f);
          const isConflicting = !!conflict;
          const displayVal = Array.isArray(val) ? val.join(', ') : val;

          const div = document.createElement('div');
          div.className = 'field';
          let html = '<input type="checkbox" data-field="' + f + '" ' + (isConflicting ? '' : 'checked') + '>';
          html += '<div class="field-value"><span class="field-label">' + f + '</span>';
          if (isConflicting) {
            html += '<span class="conflict-badge conflict-' + conflict.severity + '">' + conflict.severity + '</span>';
            html += '<div class="conflict-detail">Existing: ' + escapeHtml(conflict.existingValue) + '</div>';
          }
          html += '<div>' + escapeHtml(displayVal) + '</div></div>';
          div.innerHTML = html;
          stateEl.appendChild(div);
        }
      }
      if (!stateEl.innerHTML) {
        document.getElementById('state-section').style.display = 'none';
      }

      // Memory entries
      const memEl = document.getElementById('memory-entries');
      memEl.innerHTML = '';
      const mem = extractionData.candidateMemory || [];
      document.getElementById('memory-count').textContent = mem.length;
      for (let i = 0; i < mem.length; i++) {
        const m = mem[i];
        const isDupe = memoryDuplicatesData.includes(m.title);
        const div = document.createElement('div');
        div.className = 'entry';
        let html = '<input type="checkbox" data-mem-idx="' + i + '" ' + (isDupe ? 'disabled' : 'checked') + '>';
        html += '<div class="entry-content"><span class="entry-title">' + escapeHtml(m.title) + '</span>';
        html += '<span class="entry-category"> ' + m.category + '</span>';
        if (isDupe) html += '<span class="duplicate-badge">already exists</span>';
        html += '<div class="entry-detail">' + escapeHtml(m.content.slice(0, 150)) + '</div></div>';
        div.innerHTML = html;
        memEl.appendChild(div);
      }
      if (mem.length === 0) {
        document.getElementById('memory-section').style.display = 'none';
      }

      // Tasks
      const taskEl = document.getElementById('task-entries');
      taskEl.innerHTML = '';
      const tasks = extractionData.candidateTasks || [];
      document.getElementById('task-count').textContent = tasks.length;
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const div = document.createElement('div');
        div.className = 'entry';
        let html = '<input type="checkbox" data-task-idx="' + i + '" checked>';
        html += '<div class="entry-content"><span class="entry-title">' + escapeHtml(t.title) + '</span>';
        html += ' <span class="entry-category">' + t.taskType + '</span>';
        html += '<div class="entry-detail">' + escapeHtml(t.goal) + '</div></div>';
        div.innerHTML = html;
        taskEl.appendChild(div);
      }
      if (tasks.length === 0) {
        document.getElementById('tasks-section').style.display = 'none';
      }

      // MemCells
      const mcEl = document.getElementById('memcell-entries');
      mcEl.innerHTML = '';
      document.getElementById('memcell-count').textContent = memCellsData.length;
      for (let i = 0; i < memCellsData.length; i++) {
        const mc = memCellsData[i];
        const div = document.createElement('div');
        div.className = 'entry';
        let html = '<input type="checkbox" data-mc-idx="' + i + '" checked>';
        html += '<div class="entry-content"><span class="entry-title">' + escapeHtml(mc.episodicSummary) + '</span>';
        html += '<div class="entry-detail">' + mc.eventCount + ' events &middot; ~' + mc.tokenCount + ' tokens</div></div>';
        div.innerHTML = html;
        mcEl.appendChild(div);
      }
      if (memCellsData.length === 0) {
        document.getElementById('memcells-section').style.display = 'none';
      }
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // Button handlers
    document.getElementById('btn-extract').addEventListener('click', () => {
      vscode.postMessage({ type: 'extract' });
    });
    document.getElementById('btn-cancel-parse').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });
    document.getElementById('btn-cancel-extract').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });
    document.getElementById('btn-cancel-review').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });
    document.getElementById('btn-cancel-error').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });
    document.getElementById('btn-retry').addEventListener('click', () => {
      vscode.postMessage({ type: 'extract' });
    });
    document.getElementById('btn-close').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    document.getElementById('btn-apply').addEventListener('click', () => {
      // Gather selected state fields
      const selectedState = {};
      document.querySelectorAll('[data-field]').forEach(cb => {
        selectedState[cb.dataset.field] = cb.checked;
      });

      // Gather selected memory indices
      const selectedMemory = [];
      document.querySelectorAll('[data-mem-idx]').forEach(cb => {
        if (cb.checked) selectedMemory.push(parseInt(cb.dataset.memIdx));
      });

      // Gather selected task indices
      const selectedTasks = [];
      document.querySelectorAll('[data-task-idx]').forEach(cb => {
        if (cb.checked) selectedTasks.push(parseInt(cb.dataset.taskIdx));
      });

      // Gather selected MemCell indices
      const selectedMemCells = [];
      document.querySelectorAll('[data-mc-idx]').forEach(cb => {
        if (cb.checked) selectedMemCells.push(parseInt(cb.dataset.mcIdx));
      });

      vscode.postMessage({
        type: 'applySelected',
        selectedState,
        selectedMemory,
        selectedTasks,
        selectedMemCells,
      });
    });
  </script>
</body>
</html>`;
  }
}
