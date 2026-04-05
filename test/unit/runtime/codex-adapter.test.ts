import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

import * as cp from 'node:child_process';
import { runCodex, findCodexBinary } from '../../../src/runtime/codex-adapter.js';
import { MorticusError } from '../../../src/domain/errors.js';

const mockExecSync = vi.mocked(cp.execSync);
const mockSpawn = vi.mocked(cp.spawn);

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

describe('findCodexBinary', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws MorticusError with PROVIDER_ERROR when codex binary not found', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(() => findCodexBinary()).toThrow(MorticusError);
    try {
      findCodexBinary();
    } catch (err) {
      expect((err as MorticusError).code).toBe('PROVIDER_ERROR');
      expect((err as MorticusError).message).toContain('npm i -g @openai/codex');
    }
  });
});

describe('runCodex', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecSync.mockReturnValue('/usr/local/bin/codex\n' as unknown as ReturnType<typeof cp.execSync>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('spawns with correct default args', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ stdoutData: 'output', exitCode: 0 }));

    await runCodex('test prompt', { workingDirectory: '/tmp' });

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/codex',
      ['exec', '--ephemeral', '-s', 'read-only', '-a', 'never', '-o', '/dev/stdout', '-C', '/tmp', '-m', 'o4-mini', 'test prompt'],
      expect.objectContaining({ cwd: '/tmp' }),
    );
  });

  it('returns stdout and exit code 0 on success', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ stdoutData: 'hello codex', exitCode: 0 }));

    const result = await runCodex('prompt', { workingDirectory: '/tmp' });
    expect(result.stdout).toBe('hello codex');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('returns result without throwing on non-zero exit code', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ stdoutData: 'partial', exitCode: 1 }));

    const result = await runCodex('prompt', { workingDirectory: '/tmp' });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('partial');
  });

  it('uses custom model when specified', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ stdoutData: '', exitCode: 0 }));

    await runCodex('prompt', { workingDirectory: '/tmp', model: 'gpt-4o' });

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-m', 'gpt-4o']),
      expect.anything(),
    );
  });

  it('passes sandbox option in spawn args', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ stdoutData: '', exitCode: 0 }));

    await runCodex('prompt', { workingDirectory: '/tmp', sandbox: 'workspace-write' });

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-s', 'workspace-write']),
      expect.anything(),
    );
  });

  it('sets timedOut to true when process is killed via timeout', async () => {
    const proc = makeFakeProc({ stdoutData: '', delay: 5000 });
    const killFn = vi.fn(() => {
      setImmediate(() => proc.emit('close', null));
    });
    (proc as unknown as Record<string, unknown>).kill = killFn;
    mockSpawn.mockReturnValue(proc);

    const result = await runCodex('prompt', { workingDirectory: '/tmp', timeoutMs: 10 });
    expect(result.timedOut).toBe(true);
    expect(killFn).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects with MorticusError when process emits error event', async () => {
    mockSpawn.mockReturnValue(makeFakeProc({ errorEvent: new Error('spawn ENOENT') }));

    await expect(runCodex('prompt', { workingDirectory: '/tmp' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });
});
