import { describe, it, expect } from 'vitest';
import { createChatSession } from '../../../src/domain/chat.js';
import type { DraftTask, ChatSession } from '../../../src/domain/chat.js';
import type { ChatSessionId, ProjectId } from '../../../src/domain/ids.js';
import { generateSuggestionId } from '../../../src/domain/ids.js';

function makeSession(mode: 'kickoff' | 'steering' = 'kickoff'): ChatSession {
  return createChatSession(
    'chat_test' as ChatSessionId,
    'proj_test' as ProjectId,
    mode,
  );
}

function makeDraftTask(title: string, suggestionId?: string): DraftTask {
  return {
    title,
    goal: `Goal for ${title}`,
    taskType: 'implementation',
    scopePaths: [],
    suggestionId,
  };
}

describe('ChatSession.pendingSuggestedTasks', () => {
  it('createChatSession initializes pendingSuggestedTasks as empty array', () => {
    const session = makeSession();
    expect(session.pendingSuggestedTasks).toEqual([]);
  });

  it('pendingSuggestedTasks accepts DraftTask with suggestionId', () => {
    const session = makeSession('steering');
    const id = generateSuggestionId();
    const task = makeDraftTask('Setup project', id);
    session.pendingSuggestedTasks.push(task);

    expect(session.pendingSuggestedTasks).toHaveLength(1);
    expect(session.pendingSuggestedTasks[0].suggestionId).toBe(id);
    expect(session.pendingSuggestedTasks[0].title).toBe('Setup project');
  });

  it('simulates accept: draftTasks move to pendingSuggestedTasks with suggestionId', () => {
    const session = makeSession('kickoff');
    session.draftTasks = [
      makeDraftTask('Task A'),
      makeDraftTask('Task B'),
    ];

    // Simulate accept: assign IDs and move
    const pending = session.draftTasks.map(t => ({
      ...t,
      suggestionId: generateSuggestionId(),
    }));
    session.pendingSuggestedTasks = pending;
    session.draftTasks = [];
    session.mode = 'steering';

    expect(session.draftTasks).toEqual([]);
    expect(session.pendingSuggestedTasks).toHaveLength(2);
    expect(session.pendingSuggestedTasks[0].suggestionId).toBeTruthy();
    expect(session.pendingSuggestedTasks[1].suggestionId).toBeTruthy();
    expect(session.pendingSuggestedTasks[0].suggestionId)
      .not.toBe(session.pendingSuggestedTasks[1].suggestionId);
  });

  it('drains by suggestionId on dismiss', () => {
    const session = makeSession('steering');
    const id1 = generateSuggestionId();
    const id2 = generateSuggestionId();
    session.pendingSuggestedTasks = [
      makeDraftTask('Task A', id1),
      makeDraftTask('Task B', id2),
    ];

    // Dismiss Task A
    session.pendingSuggestedTasks = session.pendingSuggestedTasks
      .filter(t => t.suggestionId !== id1);

    expect(session.pendingSuggestedTasks).toHaveLength(1);
    expect(session.pendingSuggestedTasks[0].title).toBe('Task B');
    expect(session.pendingSuggestedTasks[0].suggestionId).toBe(id2);
  });

  it('drains by suggestionId on create', () => {
    const session = makeSession('steering');
    const id1 = generateSuggestionId();
    const id2 = generateSuggestionId();
    const id3 = generateSuggestionId();
    session.pendingSuggestedTasks = [
      makeDraftTask('Task A', id1),
      makeDraftTask('Task B', id2),
      makeDraftTask('Task C', id3),
    ];

    // Create Task B
    session.pendingSuggestedTasks = session.pendingSuggestedTasks
      .filter(t => t.suggestionId !== id2);

    expect(session.pendingSuggestedTasks).toHaveLength(2);
    expect(session.pendingSuggestedTasks[0].title).toBe('Task A');
    expect(session.pendingSuggestedTasks[1].title).toBe('Task C');
  });

  it('dismiss/create with unknown suggestionId is a no-op', () => {
    const session = makeSession('steering');
    const id1 = generateSuggestionId();
    session.pendingSuggestedTasks = [
      makeDraftTask('Task A', id1),
    ];

    session.pendingSuggestedTasks = session.pendingSuggestedTasks
      .filter(t => t.suggestionId !== 'sug_nonexistent');

    expect(session.pendingSuggestedTasks).toHaveLength(1);
    expect(session.pendingSuggestedTasks[0].suggestionId).toBe(id1);
  });

  it('DraftTask without suggestionId serializes correctly', () => {
    const task = makeDraftTask('Plain task');
    const json = JSON.stringify(task);
    const parsed = JSON.parse(json) as DraftTask;

    expect(parsed.title).toBe('Plain task');
    expect(parsed.suggestionId).toBeUndefined();
  });

  it('DraftTask with suggestionId round-trips through JSON', () => {
    const id = generateSuggestionId();
    const task = makeDraftTask('Identified task', id);
    const json = JSON.stringify(task);
    const parsed = JSON.parse(json) as DraftTask;

    expect(parsed.title).toBe('Identified task');
    expect(parsed.suggestionId).toBe(id);
  });

  it('pendingSuggestedTasks round-trips through JSON on ChatSession', () => {
    const session = makeSession('steering');
    const id1 = generateSuggestionId();
    const id2 = generateSuggestionId();
    session.pendingSuggestedTasks = [
      makeDraftTask('Task A', id1),
      makeDraftTask('Task B', id2),
    ];

    const json = JSON.stringify(session);
    const restored = JSON.parse(json) as ChatSession;

    expect(restored.pendingSuggestedTasks).toHaveLength(2);
    expect(restored.pendingSuggestedTasks[0].suggestionId).toBe(id1);
    expect(restored.pendingSuggestedTasks[1].suggestionId).toBe(id2);
    expect(restored.pendingSuggestedTasks[0].title).toBe('Task A');
  });
});

describe('generateSuggestionId', () => {
  it('produces unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSuggestionId());
    }
    expect(ids.size).toBe(100);
  });

  it('starts with sug_ prefix', () => {
    const id = generateSuggestionId();
    expect(id.startsWith('sug_')).toBe(true);
  });
});
