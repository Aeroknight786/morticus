import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { TaskContext } from '../domain/chat.js';

export type LocalIntent =
  | { type: 'state_query'; field: 'goal' | 'phase' | 'phaseGoal' | 'nextStep' | 'constraints' | 'decisions' | 'risks' | 'phaseExitCriteria' }
  | { type: 'task_query'; filter: 'active' | 'awaiting_review' }
  | { type: 'delegate' };

export function classifyIntent(text: string, mode: 'kickoff' | 'steering'): LocalIntent {
  if (mode === 'kickoff') return { type: 'delegate' };

  const lower = text.toLowerCase().trim();

  // State field queries
  if (/\b(what('?s| is) (the |my |our )?goal)\b/.test(lower)) return { type: 'state_query', field: 'goal' };
  if (/\b(what('?s| is) (the |my |our )?phase)\b|what phase/.test(lower)) return { type: 'state_query', field: 'phase' };
  if (/\b(what('?s| is) (the |my |our )?(next step|nextstep))\b/.test(lower)) return { type: 'state_query', field: 'nextStep' };
  if (/\b(list|show|what are) (the |my |our )?constraints\b/.test(lower)) return { type: 'state_query', field: 'constraints' };
  if (/\b(list|show|what are) (the |my |our )?decisions\b/.test(lower)) return { type: 'state_query', field: 'decisions' };
  if (/\b(list|show|what are) (the |my |our )?risks\b/.test(lower)) return { type: 'state_query', field: 'risks' };
  if (/\b(exit criteria|phase criteria)\b/.test(lower)) return { type: 'state_query', field: 'phaseExitCriteria' };

  // Task queries
  if (/\b(active tasks|what('?s| is) active|tasks? (are |that are )?active)\b/.test(lower)) return { type: 'task_query', filter: 'active' };
  if (/\bawait(ing)? review\b/.test(lower)) return { type: 'task_query', filter: 'awaiting_review' };

  return { type: 'delegate' };
}

export function generateLocalResponse(
  intent: LocalIntent & { type: 'state_query' | 'task_query' },
  state: CanonicalProjectState | null,
  taskContext: TaskContext | undefined,
): string {
  if (intent.type === 'state_query') {
    if (!state) return 'No project state initialized yet.';
    const field = intent.field;
    const val = state[field];
    if (Array.isArray(val)) {
      if (val.length === 0) return `No ${formatFieldName(field)} set.`;
      return val.map((v, i) => `${i + 1}. ${v}`).join('\n');
    }
    return (val as string) || `No ${formatFieldName(field)} set.`;
  }

  if (intent.type === 'task_query' && taskContext) {
    if (intent.filter === 'active') {
      if (taskContext.activeTasks.length === 0) return 'No active tasks.';
      return taskContext.activeTasks.map(t => `- "${t.title}" [${t.taskType}] — ${t.status}`).join('\n');
    }
    if (intent.filter === 'awaiting_review') {
      if (taskContext.awaitingReview.length === 0) return 'No tasks awaiting review.';
      return taskContext.awaitingReview.map(t => `- "${t.title}"`).join('\n');
    }
  }

  return 'No data available.';
}

function formatFieldName(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').toLowerCase();
}
