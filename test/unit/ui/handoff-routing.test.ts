import { describe, it, expect, vi } from 'vitest';
import {
  routeImportedTaskToChat,
  routeDeltaToReviewSurface,
  routeScratchpadTaskToChat,
  routeScratchpadDeltaToSurfaces,
} from '../../../src/ui/handoff-routing.js';

describe('handoff routing helpers', () => {
  it('routes imported tasks by ensuring chat and injecting the draft', async () => {
    const injectDraftTask = vi.fn();
    const ensureChatPanel = vi.fn(async () => ({
      postSystemMessage: vi.fn(),
      injectDraftTask,
    }));

    const draft = {
      title: 'Review import flow',
      goal: 'Surface imported tasks',
      taskType: 'implementation' as const,
      scopePaths: ['src/ui/'],
    };

    await routeImportedTaskToChat(draft, ensureChatPanel);

    expect(ensureChatPanel).toHaveBeenCalledTimes(1);
    expect(injectDraftTask).toHaveBeenCalledWith(draft);
  });

  it('routes imported deltas directly to review without chat', async () => {
    const presentDeltaReview = vi.fn();
    const operations = [{ type: 'add_decision', value: 'Use review flow' }];

    await routeDeltaToReviewSurface(operations, presentDeltaReview);

    expect(presentDeltaReview).toHaveBeenCalledWith(operations);
  });

  it('posts scratchpad summaries to chat before injecting a task', async () => {
    const postSystemMessage = vi.fn();
    const injectDraftTask = vi.fn();
    const ensureChatPanel = vi.fn(async () => ({
      postSystemMessage,
      injectDraftTask,
    }));

    const draft = {
      title: 'Investigate scratchpad handoff',
      goal: 'Recover handoff data safely',
      taskType: 'discovery' as const,
      scopePaths: ['src/ui/'],
    };

    await routeScratchpadTaskToChat('Recovered a task', draft, ensureChatPanel);

    expect(postSystemMessage).toHaveBeenCalledWith('Scratchpad handoff: Recovered a task');
    expect(injectDraftTask).toHaveBeenCalledWith(draft);
  });

  it('posts scratchpad summaries and then routes deltas to review', async () => {
    const postSystemMessage = vi.fn();
    const ensureChatPanel = vi.fn(async () => ({
      postSystemMessage,
      injectDraftTask: vi.fn(),
    }));
    const presentDeltaReview = vi.fn();
    const operations = [{ type: 'set_next_step', value: 'Open review panel' }];

    await routeScratchpadDeltaToSurfaces(
      'Recovered a delta',
      operations,
      ensureChatPanel,
      presentDeltaReview,
    );

    expect(postSystemMessage).toHaveBeenCalledWith('Scratchpad handoff: Recovered a delta');
    expect(presentDeltaReview).toHaveBeenCalledWith(operations);
  });
});
