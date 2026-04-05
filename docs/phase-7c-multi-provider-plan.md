# Phase 7C — Multi-Provider Support (Codex CLI) Implementation Plan

## Context

Morticus currently hardcodes the Claude CLI (`claude --print "prompt"`) as its only LLM provider. Claude has aggressive rate limits that make local testing difficult. OpenAI's Codex CLI (`@openai/codex`) supports the same single-shot subprocess pattern via `codex exec`.

This phase abstracts the LLM provider behind an interface so the user can switch between Claude and Codex (and potentially others later) via a VS Code setting.

## Design Principle

Minimal abstraction. Both CLIs do the same thing: take a prompt string, produce text output on stdout. The adapter interface is trivially small. Do not overbuild — no plugin system, no provider registry, no dynamic loading.

---

## 1. Key Files to Read Before Starting

| Priority | File | Why |
|---|---|---|
| 1 | `CLAUDE.md` | Architecture and conventions |
| 2 | `src/runtime/claude-adapter.ts` | Current adapter — `runClaude()`, `findClaudeBinary()`, spawn pattern |
| 3 | `src/runtime/run-controller.ts` | Calls `runClaude()` for task execution |
| 4 | `src/runtime/chat-adapter.ts` | Calls `runClaude()` for chat turns |
| 5 | `src/runtime/memory-extractor.ts` | Calls `runClaude()` for MemCell extraction |
| 6 | `src/runtime/scratchpad-adapter.ts` | Calls `runClaude()` for scratchpad |
| 7 | `src/runtime/import-extractor.ts` | Calls `runClaude()` for import extraction |
| 8 | `package.json` | Extension settings (contributes.configuration) |

---

## 2. Implementation Steps (in order)

### Step 1: Create provider abstraction (~40 lines)

**`src/runtime/llm-provider.ts`** — NEW:

```typescript
export interface LlmRunResult {
  stdout: string;
  exitCode: number;
  timedOut: boolean;
}

export interface LlmRunOptions {
  workingDirectory: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type LlmProvider = 'claude' | 'codex';

// Runs a prompt through the configured LLM CLI and returns the output.
export async function runLlm(
  prompt: string,
  options: LlmRunOptions,
  provider?: LlmProvider,
): Promise<LlmRunResult>;

// Returns the currently configured provider from VS Code settings.
export function getConfiguredProvider(): LlmProvider;
```

The `runLlm` function dispatches to the appropriate adapter based on `provider` (or `getConfiguredProvider()` if not specified).

### Step 2: Create Codex adapter (~70 lines)

**`src/runtime/codex-adapter.ts`** — NEW:

```typescript
import * as child_process from 'node:child_process';
import { MorticusError } from '../domain/errors.js';

export interface CodexRunResult {
  stdout: string;
  exitCode: number;
  timedOut: boolean;
}

export interface CodexAdapterOptions {
  workingDirectory: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  model?: string;  // default: 'o4-mini'
}

export async function runCodex(
  prompt: string,
  options: CodexAdapterOptions,
): Promise<CodexRunResult>;
```

Implementation follows the same pattern as `claude-adapter.ts`:
- `findCodexBinary()` — `which codex`, cached
- Spawn: `codex exec --ephemeral -s read-only -a never -o /dev/stdout -C <workingDir> -m <model> "<prompt>"`
- Same timeout/abort/error handling pattern
- Error message: `'Codex CLI not found. Install with: npm i -g @openai/codex'`

Key flags:
- `exec` — single-shot subcommand (equivalent to `claude --print`)
- `--ephemeral` — don't persist session files
- `-s read-only` — sandboxed, no file writes (task runs can override to `workspace-write`)
- `-a never` — never prompt for approval (non-interactive)
- `-o /dev/stdout` — output final message to stdout
- `-C <dir>` — working directory
- `-m <model>` — model selection (default `o4-mini`)

### Step 3: Implement provider dispatch in llm-provider.ts (~30 lines)

```typescript
import * as vscode from 'vscode';
import { runClaude } from './claude-adapter.js';
import { runCodex } from './codex-adapter.js';

export function getConfiguredProvider(): LlmProvider {
  const config = vscode.workspace.getConfiguration('morticus');
  const provider = config.get<string>('llmProvider', 'claude');
  if (provider === 'codex') return 'codex';
  return 'claude'; // default
}

export function getConfiguredModel(): string | undefined {
  const config = vscode.workspace.getConfiguration('morticus');
  return config.get<string>('llmModel') || undefined;
}

export async function runLlm(
  prompt: string,
  options: LlmRunOptions,
  provider?: LlmProvider,
): Promise<LlmRunResult> {
  const p = provider ?? getConfiguredProvider();
  if (p === 'codex') {
    return runCodex(prompt, {
      ...options,
      model: getConfiguredModel(),
    });
  }
  return runClaude(prompt, options);
}
```

### Step 4: Update all callers to use runLlm (~20 lines, 5 files)

Replace `import { runClaude } from './claude-adapter.js'` with `import { runLlm } from './llm-provider.js'` and `runClaude(...)` with `runLlm(...)` in:

| File | Call site |
|---|---|
| `src/runtime/run-controller.ts` | Line ~99: task execution |
| `src/runtime/chat-adapter.ts` | Line ~243: chat turns |
| `src/runtime/memory-extractor.ts` | Line ~112: MemCell extraction |
| `src/runtime/scratchpad-adapter.ts` | Lines ~95, ~122: scratchpad turns |
| `src/runtime/import-extractor.ts` | Line ~287: import extraction |

Each change is a 2-line diff: change the import, change the function call. The return type is identical (`{ stdout, exitCode, timedOut }`).

**Keep `claude-adapter.ts` and `runClaude` as-is** — they are now called by `runLlm` internally. Do not remove them.

### Step 5: Add VS Code settings (~15 lines)

**`package.json`** — in `contributes.configuration.properties`, add:

```json
"morticus.llmProvider": {
  "type": "string",
  "default": "claude",
  "enum": ["claude", "codex"],
  "enumDescriptions": [
    "Claude CLI (claude --print)",
    "OpenAI Codex CLI (codex exec)"
  ],
  "description": "LLM provider for task execution, chat, and memory extraction."
},
"morticus.llmModel": {
  "type": "string",
  "default": "",
  "description": "Model override for the LLM provider (e.g., 'o4-mini' for Codex, 'sonnet' for Claude). Leave empty for provider default."
}
```

### Step 6: Add Codex sandbox mode for task runs (~15 lines)

Task runs need write access. The Codex adapter should accept a `sandbox` option:

```typescript
export interface CodexAdapterOptions {
  // ... existing ...
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
}
```

Default is `read-only`. `runLlm` should accept an optional `sandbox` parameter that the run-controller passes as `'workspace-write'` for task execution.

Update `LlmRunOptions`:
```typescript
export interface LlmRunOptions {
  workingDirectory: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  sandbox?: string;  // Codex-specific, ignored by Claude
}
```

### Step 7: Add provider indicator to UI (~10 lines)

**`src/ui/webviews/run-detail-panel.ts`** — show which provider was used in the run detail. Add `provider` field to `ContextMetrics` or display from the run metadata.

**`src/runtime/run-controller.ts`** — log the provider at run start:
```typescript
console.log(`[morticus] run ${runId} — provider: ${getConfiguredProvider()}`);
```

### Step 8: Re-export and backward compat (~10 lines)

**`src/runtime/index.ts`** — update exports:
```typescript
export { runLlm, getConfiguredProvider, getConfiguredModel } from './llm-provider.js';
export type { LlmRunResult, LlmRunOptions, LlmProvider } from './llm-provider.js';
// Keep backward compat exports
export { runClaude } from './claude-adapter.js';
export type { ClaudeRunResult, ClaudeAdapterOptions } from './claude-adapter.js';
```

### Step 9: Tests (~80 lines)

**`test/unit/runtime/codex-adapter.test.ts`** — NEW:
- `findCodexBinary` throws `PROVIDER_ERROR` when not installed (mock `which`)
- Spawn args are correct: `['exec', '--ephemeral', '-s', 'read-only', '-a', 'never', '-o', '/dev/stdout', '-C', dir, '-m', model, prompt]`
- Timeout kills process
- Model defaults to `o4-mini` when not specified

**`test/unit/runtime/llm-provider.test.ts`** — NEW:
- `runLlm` with `'claude'` calls `runClaude`
- `runLlm` with `'codex'` calls `runCodex`
- `getConfiguredProvider` defaults to `'claude'`
- Sandbox option is passed through to Codex

---

## 3. What NOT to Do

- Do NOT remove `claude-adapter.ts` or break its API — it's now an internal implementation detail called by `runLlm`
- Do NOT add an API-based provider (HTTP calls to OpenAI/Anthropic APIs) — CLI-only for now
- Do NOT add a provider plugin/registry system — two providers with a switch statement is correct
- Do NOT change prompt formats per provider — both CLIs accept the same natural language prompt
- Do NOT add provider-specific prompt tuning or model-specific behavior
- Do NOT add UI for provider switching beyond the VS Code setting — settings.json is sufficient
- Domain types must stay pure (no VS Code imports) — `llm-provider.ts` is in runtime layer, which can import vscode

---

## 4. Verification

```bash
npm run lint   # clean
npm test       # all existing 516 tests pass + new tests pass
npm run build  # clean
```

### Manual testing

1. Set `"morticus.llmProvider": "codex"` in VS Code settings
2. Run a task — should use `codex exec` instead of `claude --print`
3. Switch back to `"morticus.llmProvider": "claude"` — should use Claude CLI
4. Check run detail panel shows provider used

---

## 5. Estimated Scope

| Component | ~Lines |
|---|---|
| `llm-provider.ts` (abstraction + dispatch) | 40 |
| `codex-adapter.ts` (Codex CLI adapter) | 70 |
| Caller updates (5 files, 2 lines each) | 10 |
| VS Code settings in package.json | 15 |
| Sandbox mode for task runs | 15 |
| UI provider indicator | 10 |
| Re-exports + backward compat | 10 |
| Tests | 80 |
| **Total** | **~250** |
