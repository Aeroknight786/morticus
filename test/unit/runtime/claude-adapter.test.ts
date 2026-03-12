import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// We mock the entire child_process module BEFORE importing the adapter
// so that findClaudeBinary() and spawn() use our fakes.
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

import * as cp from 'node:child_process';
import { runClaude } from '../../../src/runtime/claude-adapter.js';
import { MorticusError } from '../../../src/domain/errors.js';

const mockExecSync = vi.mocked(cp.execSync);
const mockSpawn = vi.mocked(cp.spawn);

// Helper to create a fake child process that emits events programmatically
function makeFakeProc(options: {
  stdoutData?: string;
  exitCode?: number;
  errorEvent?: Error;
  delay?: number;
}): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stdout = stdout;
  (proc as unknown as Record<string, unknown>).stderr = stderr;
  (proc as unknown as Record<string, unknown>).kill = vi.fn(() => {
    // Simulate kill by emitting close with null code
    setImmediate(() => proc.emit('close', null));
  });

  const delay = options.delay ?? 0;
  setTimeout(() => {
    if (options.errorEvent) {
      proc.emit('error', options.errorEvent);
      return;
    }
    if (options.stdoutData !== undefined) {
      stdout.emit('data', Buffer.from(options.stdoutData));
    }
    proc.emit('close', options.exitCode ?? 0);
  }, delay);

  return proc;
}

describe('runClaude', () => {
  beforeEach(() => {
    // Reset cached path between tests
    vi.resetModules();
    // Default: which claude succeeds
    mockExecSync.mockReturnValue('/usr/local/bin/claude\n' as unknown as ReturnType<typeof cp.execSync>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws MorticusError with PROVIDER_ERROR when claude binary not found', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });

    await expect(runClaude('hello', { workingDirectory: '/tmp' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    await expect(runClaude('hello', { workingDirectory: '/tmp' })).rejects.toBeInstanceOf(MorticusError);
  });

  it('returns stdout and exit code 0 on success', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ stdoutData: 'hello world', exitCode: 0 }));

    const result = await runClaude('prompt text', { workingDirectory: '/tmp' });
    expect(result.stdout).toBe('hello world');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('returns result without throwing on non-zero exit code', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ stdoutData: 'partial output', exitCode: 1 }));

    const result = await runClaude('prompt', { workingDirectory: '/tmp' });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('partial output');
    expect(result.timedOut).toBe(false);
  });

  it('sets timedOut to true when process is killed via timeout', async () => {
    const proc = makeFakeProc({ stdoutData: '', exitCode: null as unknown as number, delay: 5000 });
    const killFn = vi.fn(() => {
      setImmediate(() => proc.emit('close', null));
    });
    (proc as unknown as Record<string, unknown>).kill = killFn;
    mockSpawn.mockReturnValue(proc);

    const result = await runClaude('prompt', { workingDirectory: '/tmp', timeoutMs: 10 });
    expect(result.timedOut).toBe(true);
    expect(killFn).toHaveBeenCalledWith('SIGTERM');
  });

  it('kills process and resolves when AbortSignal fires', async () => {
    const proc = makeFakeProc({ stdoutData: 'some output', exitCode: null as unknown as number, delay: 5000 });
    const killFn = vi.fn(() => {
      setImmediate(() => proc.emit('close', null));
    });
    (proc as unknown as Record<string, unknown>).kill = killFn;
    mockSpawn.mockReturnValue(proc);

    const controller = new AbortController();
    const promise = runClaude('prompt', { workingDirectory: '/tmp', signal: controller.signal });
    // Abort immediately
    controller.abort();

    const result = await promise;
    expect(killFn).toHaveBeenCalledWith('SIGTERM');
    // exitCode null → defaults to 1 in the adapter
    expect(result.exitCode).toBe(1);
  });

  it('rejects with MorticusError when process emits error event', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ errorEvent: new Error('spawn ENOENT') }));

    await expect(runClaude('prompt', { workingDirectory: '/tmp' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });
});
