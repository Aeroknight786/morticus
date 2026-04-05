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
  model?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

// Cached path to the codex binary after first lookup.
let resolvedCodexPath: string | null = null;

export function findCodexBinary(): string {
  if (resolvedCodexPath) return resolvedCodexPath;
  try {
    const result = child_process.execSync('which codex', { encoding: 'utf8' }).trim();
    if (!result) throw new Error('empty');
    resolvedCodexPath = result;
    return result;
  } catch {
    throw new MorticusError(
      'Codex CLI not found. Install with: npm i -g @openai/codex',
      'PROVIDER_ERROR',
    );
  }
}

// Spawns `codex exec` in single-shot mode and captures stdout.
// Follows the same contract as runClaude: non-zero exit does NOT throw.
export async function runCodex(
  prompt: string,
  options: CodexAdapterOptions,
): Promise<CodexRunResult> {
  const codexPath = findCodexBinary();
  const timeoutMs = options.timeoutMs ?? 300_000;
  const model = options.model ?? 'o4-mini';
  const sandbox = options.sandbox ?? 'read-only';

  const args = [
    'exec',
    '--ephemeral',
    '-s', sandbox,
    '-a', 'never',
    '-o', '/dev/stdout',
    '-C', options.workingDirectory,
    '-m', model,
    prompt,
  ];

  return new Promise((resolve, reject) => {
    let timedOut = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let proc: child_process.ChildProcess;
    try {
      proc = child_process.spawn(codexPath, args, {
        cwd: options.workingDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new MorticusError(
        `Failed to spawn Codex CLI: ${(err as Error).message}`,
        'PROVIDER_ERROR',
        { cause: (err as Error).message },
      ));
      return;
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        proc.kill('SIGTERM');
      }, { once: true });
    }

    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new MorticusError(
        `Codex CLI process error: ${err.message}`,
        'PROVIDER_ERROR',
        { cause: err.message },
      ));
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        exitCode: code ?? 1,
        timedOut,
      });
    });
  });
}
