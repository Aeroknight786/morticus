import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../../src/runtime/prompt-builder.js';
import type { ContextPack } from '../../../src/domain/task-spec.js';

const basePack: ContextPack = {
  stablePrefix: 'You are a helpful assistant working on project Morticus.',
  canonicalStateSummary: 'Phase: alpha | Goal: Build the engine | Next: Write tests',
  relevantMemoryEntries: ['Entry A', 'Entry B'],
  scopeDescription: 'src/runtime/',
  taskGoal: 'Understand the runtime layer',
  constraints: ['Do not modify production data', 'Read-only scope'],
  estimatedTokens: 120,
};

describe('buildPrompt', () => {
  it('includes stablePrefix at the top', () => {
    const prompt = buildPrompt(basePack);
    expect(prompt.startsWith(basePack.stablePrefix)).toBe(true);
  });

  it('includes canonical state summary', () => {
    const prompt = buildPrompt(basePack);
    expect(prompt).toContain('## Current Project State');
    expect(prompt).toContain(basePack.canonicalStateSummary);
  });

  it('includes relevant memory entries under Relevant Context', () => {
    const prompt = buildPrompt(basePack);
    expect(prompt).toContain('## Relevant Context');
    expect(prompt).toContain('Entry A');
    expect(prompt).toContain('Entry B');
  });

  it('includes task goal and scope', () => {
    const prompt = buildPrompt(basePack);
    expect(prompt).toContain('## Task');
    expect(prompt).toContain(`Goal: ${basePack.taskGoal}`);
    expect(prompt).toContain(`Scope: ${basePack.scopeDescription}`);
  });

  it('includes constraints', () => {
    const prompt = buildPrompt(basePack);
    expect(prompt).toContain('- Do not modify production data');
    expect(prompt).toContain('- Read-only scope');
  });

  it('includes output contract markers', () => {
    const prompt = buildPrompt(basePack);
    expect(prompt).toContain('---MORTICUS-OUTPUT-START---');
    expect(prompt).toContain('---MORTICUS-OUTPUT-END---');
  });

  it('includes Output Instructions section', () => {
    const prompt = buildPrompt(basePack);
    expect(prompt).toContain('## Output Instructions');
  });

  it('does NOT emit estimatedTokens in prompt', () => {
    const prompt = buildPrompt(basePack);
    expect(prompt).not.toContain('estimatedTokens');
    expect(prompt).not.toContain('120');
  });

  it('omits Relevant Context section when memory entries are empty', () => {
    const pack = { ...basePack, relevantMemoryEntries: [] };
    const prompt = buildPrompt(pack);
    expect(prompt).not.toContain('## Relevant Context');
  });

  it('omits stablePrefix section when empty string', () => {
    const pack = { ...basePack, stablePrefix: '' };
    const prompt = buildPrompt(pack);
    // Still has project state, task, output instructions
    expect(prompt).toContain('## Current Project State');
    // stablePrefix is empty so it should not appear as a leading section
    expect(prompt.trimStart().startsWith('##')).toBe(true);
  });

  it('omits constraints block when constraints array is empty', () => {
    const pack = { ...basePack, constraints: [] };
    const prompt = buildPrompt(pack);
    expect(prompt).not.toContain('Constraints you must respect:');
  });

  it('output contract section is always last', () => {
    const prompt = buildPrompt(basePack);
    const outputIdx = prompt.lastIndexOf('## Output Instructions');
    const endMarkerIdx = prompt.lastIndexOf('---MORTICUS-OUTPUT-END---');
    expect(outputIdx).toBeGreaterThan(-1);
    expect(endMarkerIdx).toBeGreaterThan(outputIdx);
    // Nothing meaningful after the end marker
    const afterMarker = prompt.slice(endMarkerIdx + '---MORTICUS-OUTPUT-END---'.length).trim();
    expect(afterMarker).toMatch(/^Rules for the structured block:|^$/);
  });
});
