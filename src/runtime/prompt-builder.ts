import type { ContextPack } from '../domain/task-spec.js';

// Pure function: renders a ContextPack into a prompt string for the Claude CLI.
// No Node APIs, no VS Code. Deterministic given the same inputs.
//
// Design: the prompt is intentionally minimal — only what is needed for the task.
// The stablePrefix is isolated at the top so it is structurally distinct from
// per-run content. estimatedTokens is internal metadata and is NOT emitted.
//
// The output contract section at the bottom is verbatim and must match exactly
// what output-normalizer.ts expects to parse.

const OUTPUT_CONTRACT = `After completing your work, output EXACTLY this block anywhere in your response:

---MORTICUS-OUTPUT-START---
{
  "summary": "One to two sentences describing what you did and found.",
  "inspectedFiles": [],
  "modifiedFiles": [],
  "proposedDelta": {
    "addConstraints": [],
    "removeConstraints": [],
    "addDecisions": [],
    "removeDecisions": [],
    "addRisks": [],
    "removeRisks": [],
    "addKnownFiles": [],
    "removeKnownFiles": [],
    "setGoal": null,
    "setPhase": null,
    "setNextStep": null
  },
  "evidenceRefs": [],
  "confidence": 0.0,
  "completionReason": "task_goal_met",
  "unresolvedIssues": []
}
---MORTICUS-OUTPUT-END---

Rules for the structured block:
- confidence: number between 0.0 and 1.0 (how confident you are the task goal was met)
- completionReason: one of "task_goal_met", "max_turns_reached", "provider_stopped", "error"
- Only include operations that represent genuine findings. Do not invent changes.
- addKnownFiles / removeKnownFiles: use paths relative to the project root.
- setGoal / setPhase / setNextStep: null if unchanged.`;

export function buildPrompt(pack: ContextPack): string {
  const sections: string[] = [];

  // Stable prefix: durable memory and project rules. Structurally isolated.
  if (pack.stablePrefix) {
    sections.push(pack.stablePrefix);
  }

  // Current project state
  sections.push(`## Current Project State\n\n${pack.canonicalStateSummary}`);

  // Relevant memory entries (may overlap with stablePrefix content — that is fine)
  if (pack.relevantMemoryEntries.length > 0) {
    sections.push(`## Relevant Context\n\n${pack.relevantMemoryEntries.join('\n\n')}`);
  }

  // Task definition
  const taskParts: string[] = [
    `## Task`,
    ``,
    `Scope: ${pack.scopeDescription}`,
    `Goal: ${pack.taskGoal}`,
  ];
  if (pack.constraints.length > 0) {
    taskParts.push(`\nConstraints you must respect:\n${pack.constraints.map(c => `- ${c}`).join('\n')}`);
  }
  sections.push(taskParts.join('\n'));

  // Output contract — always last
  sections.push(`## Output Instructions\n\n${OUTPUT_CONTRACT}`);

  return sections.join('\n\n');
}
