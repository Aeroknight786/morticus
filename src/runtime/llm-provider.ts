import * as vscode from 'vscode';
import type { ProviderType } from '../domain/project.js';
import { runClaude } from './claude-adapter.js';
import { runCodex } from './codex-adapter.js';

export interface LlmRunResult {
  stdout: string;
  exitCode: number;
  timedOut: boolean;
}

export interface LlmRunOptions {
  workingDirectory: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'; // Codex-specific, ignored by Claude
}

export type LlmProvider = ProviderType;

export function getConfiguredProvider(): LlmProvider {
  const config = vscode.workspace.getConfiguration('morticus');
  const provider = config.get<string>('llmProvider', 'claude');
  if (provider === 'codex') return 'codex';
  return 'claude';
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
