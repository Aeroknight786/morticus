export type ErrorCode =
  | 'INVALID_TRANSITION'
  | 'STALE_BASE_VERSION'
  | 'STORE_READ_ERROR'
  | 'STORE_WRITE_ERROR'
  | 'PROVIDER_ERROR'
  | 'SPEC_COMPILATION_ERROR'
  | 'NORMALIZATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'WORKTREE_ERROR'
  | 'PROJECT_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'PROJECT_ALREADY_EXISTS'
  | 'SCHEMA_VERSION_TOO_NEW'
  | 'MIGRATION_ERROR'
  | 'IMPORT_PARSE_ERROR'
  | 'IMPORT_EXTRACTION_ERROR';

export class MorticusError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MorticusError';
  }
}
