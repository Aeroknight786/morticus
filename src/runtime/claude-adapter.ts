import * as child_process from 'node:child_process';
import { MorticusError } from '../domain/errors.js';

export interface ClaudeRunResult {
  stdout: string;
  exitCode: number;
  timedOut: boolean;
}

export interface ClaudeAdapterOptions {
  workingDirectory: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  model?: string;
}

// Cached path to the claude binary after first lookup.
let resolvedClaudePath: string | null = null;

function findClaudeBinary(): string {
  if (resolvedClaudePath) return resolvedClaudePath;
  try {
    const result = child_process.execSync('which claude', { encoding: 'utf8' }).trim();
    if (!result) throw new Error('empty');
    resolvedClaudePath = result;
    return result;
  } catch {
    throw new MorticusError(
      'Claude CLI not found. Install from https://claude.ai/code and ensure it is on PATH.',
      'PROVIDER_ERROR',
    );
  }
}

// Spawns `claude --print "<prompt>"` and captures stdout.
// Non-zero exit code does NOT throw — the caller (RunController) decides how to handle it.
// Only spawn failure or binary absence throws MorticusError.
export async function runClaude(
  prompt: string,
  options: ClaudeAdapterOptions,
): Promise<ClaudeRunResult> {
  const claudePath = findClaudeBinary();
  const timeoutMs = options.timeoutMs ?? 300_000;

  return new Promise((resolve, reject) => {
    let timedOut = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let proc: child_process.ChildProcess;
    try {
      const args = options.model
        ? ['--print', '--model', options.model, prompt]
        : ['--print', prompt];
      proc = child_process.spawn(claudePath, args, {
        cwd: options.workingDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new MorticusError(
        `Failed to spawn Claude CLI: ${(err as Error).message}`,
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
        `Claude CLI process error: ${err.message}`,
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
