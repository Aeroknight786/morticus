import type { DraftTask } from '../domain/chat.js';

export interface ChatRouteTarget {
  postSystemMessage(text: string): void;
  injectDraftTask(draft: DraftTask): void;
}

export type RoutedDeltaOperation = Array<{ type: string; value?: string; path?: string }>;

export async function routeImportedTaskToChat(
  draft: DraftTask,
  ensureChatPanel: () => Promise<ChatRouteTarget>,
): Promise<void> {
  const chatPanel = await ensureChatPanel();
  chatPanel.injectDraftTask(draft);
}

export async function routeDeltaToReviewSurface(
  operations: RoutedDeltaOperation,
  presentDeltaReview: (operations: RoutedDeltaOperation) => Promise<void>,
): Promise<void> {
  await presentDeltaReview(operations);
}

export async function routeScratchpadTaskToChat(
  summary: string,
  draft: DraftTask,
  ensureChatPanel: () => Promise<ChatRouteTarget>,
): Promise<void> {
  const chatPanel = await ensureChatPanel();
  chatPanel.postSystemMessage(`Scratchpad handoff: ${summary}`);
  chatPanel.injectDraftTask(draft);
}

export async function routeScratchpadDeltaToSurfaces(
  summary: string,
  operations: RoutedDeltaOperation,
  ensureChatPanel: () => Promise<ChatRouteTarget>,
  presentDeltaReview: (operations: RoutedDeltaOperation) => Promise<void>,
): Promise<void> {
  const chatPanel = await ensureChatPanel();
  chatPanel.postSystemMessage(`Scratchpad handoff: ${summary}`);
  await presentDeltaReview(operations);
}
