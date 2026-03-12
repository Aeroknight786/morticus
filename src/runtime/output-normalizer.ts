import type { NormalizedOutput, ProposedDelta, CompletionReason } from '../domain/task-run.js';

// Pure function: parses raw Claude CLI stdout into a NormalizedOutput.
// No Node APIs, no VS Code. Input is non-deterministic LLM output — this parser
// is defensive by design. It never throws; it always returns a valid object.
//
// Contract markers must match exactly what prompt-builder.ts embeds.
// If markers are absent or JSON is malformed, returns a fallback with confidence: 0
// so the review panel can still open and the user can proceed manually.

const START_MARKER = '---MORTICUS-OUTPUT-START---';
const END_MARKER = '---MORTICUS-OUTPUT-END---';

const VALID_COMPLETION_REASONS: CompletionReason[] = [
  'task_goal_met',
  'max_turns_reached',
  'user_stopped',
  'provider_stopped',
  'error',
];

export function normalizeOutput(
  rawOutput: string,
  exitCode: number,
  timedOut: boolean,
): NormalizedOutput {
  const startIdx = rawOutput.indexOf(START_MARKER);
  const endIdx = rawOutput.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return fallback(timedOut ? 'max_turns_reached' : 'provider_stopped');
  }

  const jsonStr = rawOutput.slice(startIdx + START_MARKER.length, endIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return fallback('error');
  }

  if (!parsed || typeof parsed !== 'object') {
    return fallback('error');
  }

  const raw = parsed as Record<string, unknown>;

  const summary = typeof raw['summary'] === 'string' ? raw['summary'] : '';
  const inspectedFiles = coerceStringArray(raw['inspectedFiles']);
  const modifiedFiles = coerceStringArray(raw['modifiedFiles']);
  const evidenceRefs = coerceStringArray(raw['evidenceRefs']);
  const unresolvedIssues = coerceStringArray(raw['unresolvedIssues']);
  const proposedDelta = coerceProposedDelta(raw['proposedDelta']);

  const rawConfidence = typeof raw['confidence'] === 'number' ? raw['confidence'] : 0;
  const confidence = Math.min(1, Math.max(0, rawConfidence));

  const rawReason = raw['completionReason'];
  const completionReason: CompletionReason =
    VALID_COMPLETION_REASONS.includes(rawReason as CompletionReason)
      ? (rawReason as CompletionReason)
      : 'task_goal_met';

  // If exit code is non-zero and Claude didn't set completionReason to error,
  // override confidence downward as a hint to the reviewer.
  const finalConfidence = exitCode !== 0 && completionReason !== 'error'
    ? Math.min(confidence, 0.5)
    : confidence;

  return {
    summary,
    inspectedFiles,
    modifiedFiles,
    proposedDelta,
    evidenceRefs,
    confidence: finalConfidence,
    completionReason,
    unresolvedIssues,
  };
}

function fallback(completionReason: CompletionReason): NormalizedOutput {
  return {
    summary: 'Claude did not produce a structured output block. Review the raw output manually.',
    inspectedFiles: [],
    modifiedFiles: [],
    proposedDelta: emptyProposedDelta(),
    evidenceRefs: [],
    confidence: 0,
    completionReason,
    unresolvedIssues: [],
  };
}

function coerceProposedDelta(raw: unknown): ProposedDelta {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    addConstraints: coerceStringArray(obj['addConstraints']),
    removeConstraints: coerceStringArray(obj['removeConstraints']),
    addDecisions: coerceStringArray(obj['addDecisions']),
    removeDecisions: coerceStringArray(obj['removeDecisions']),
    addRisks: coerceStringArray(obj['addRisks']),
    removeRisks: coerceStringArray(obj['removeRisks']),
    addKnownFiles: coerceStringArray(obj['addKnownFiles']),
    removeKnownFiles: coerceStringArray(obj['removeKnownFiles']),
    setGoal: typeof obj['setGoal'] === 'string' ? obj['setGoal'] : null,
    setPhase: typeof obj['setPhase'] === 'string' ? obj['setPhase'] : null,
    setNextStep: typeof obj['setNextStep'] === 'string' ? obj['setNextStep'] : null,
  };
}

function emptyProposedDelta(): ProposedDelta {
  return {
    addConstraints: [], removeConstraints: [],
    addDecisions: [], removeDecisions: [],
    addRisks: [], removeRisks: [],
    addKnownFiles: [], removeKnownFiles: [],
    setGoal: null, setPhase: null, setNextStep: null,
  };
}

function coerceStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter(item => typeof item === 'string');
}
