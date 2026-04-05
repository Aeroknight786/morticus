import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock vscode
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
}));

// Mock adapters
vi.mock('../../../src/runtime/claude-adapter.js', () => ({
  runClaude: vi.fn(),
}));

vi.mock('../../../src/runtime/codex-adapter.js', () => ({
  runCodex: vi.fn(),
}));

import * as vscode from 'vscode';
import { runClaude } from '../../../src/runtime/claude-adapter.js';
import { runCodex } from '../../../src/runtime/codex-adapter.js';
import { runLlm, getConfiguredProvider, getConfiguredModel } from '../../../src/runtime/llm-provider.js';

const mockGetConfiguration = vi.mocked(vscode.workspace.getConfiguration);
const mockRunClaude = vi.mocked(runClaude);
const mockRunCodex = vi.mocked(runCodex);

function mockConfig(values: Record<string, unknown>) {
  mockGetConfiguration.mockReturnValue({
    get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue,
  } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>);
}

describe('getConfiguredProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to claude when no setting', () => {
    mockConfig({});
    expect(getConfiguredProvider()).toBe('claude');
  });

  it('returns codex when setting is codex', () => {
    mockConfig({ llmProvider: 'codex' });
    expect(getConfiguredProvider()).toBe('codex');
  });

  it('returns claude for unknown values', () => {
    mockConfig({ llmProvider: 'unknown-provider' });
    expect(getConfiguredProvider()).toBe('claude');
  });
});

describe('getConfiguredModel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when empty', () => {
    mockConfig({ llmModel: '' });
    expect(getConfiguredModel()).toBeUndefined();
  });

  it('returns model string when set', () => {
    mockConfig({ llmModel: 'gpt-4o' });
    expect(getConfiguredModel()).toBe('gpt-4o');
  });
});

describe('runLlm', () => {
  const baseOptions = { workingDirectory: '/tmp' };
  const fakeResult = { stdout: 'output', exitCode: 0, timedOut: false };

  beforeEach(() => {
    mockRunClaude.mockResolvedValue(fakeResult);
    mockRunCodex.mockResolvedValue(fakeResult);
    mockConfig({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches to runClaude when provider is claude', async () => {
    const result = await runLlm('prompt', baseOptions, 'claude');
    expect(mockRunClaude).toHaveBeenCalledWith('prompt', baseOptions);
    expect(mockRunCodex).not.toHaveBeenCalled();
    expect(result).toEqual(fakeResult);
  });

  it('dispatches to runCodex when provider is codex', async () => {
    mockConfig({ llmModel: 'o4-mini' });
    const result = await runLlm('prompt', baseOptions, 'codex');
    expect(mockRunCodex).toHaveBeenCalledWith('prompt', expect.objectContaining({
      workingDirectory: '/tmp',
      model: 'o4-mini',
    }));
    expect(mockRunClaude).not.toHaveBeenCalled();
    expect(result).toEqual(fakeResult);
  });

  it('uses configured provider when none specified', async () => {
    mockConfig({ llmProvider: 'codex' });
    await runLlm('prompt', baseOptions);
    expect(mockRunCodex).toHaveBeenCalled();
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it('passes sandbox option through to codex', async () => {
    const opts = { ...baseOptions, sandbox: 'workspace-write' };
    await runLlm('prompt', opts, 'codex');
    expect(mockRunCodex).toHaveBeenCalledWith('prompt', expect.objectContaining({
      sandbox: 'workspace-write',
    }));
  });

  it('defaults to claude when configured provider is claude', async () => {
    mockConfig({ llmProvider: 'claude' });
    await runLlm('prompt', baseOptions);
    expect(mockRunClaude).toHaveBeenCalled();
    expect(mockRunCodex).not.toHaveBeenCalled();
  });
});
