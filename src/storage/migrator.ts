import * as path from 'node:path';
import { readJson, writeJson, listJsonFiles } from './json-backend.js';
import { MorticusError } from '../domain/errors.js';

// Current schema version. Bump this when adding a new migration step.
export const CURRENT_SCHEMA_VERSION = 2;

export interface MigrationStep {
  fromVersion: number;
  toVersion: number;
  description: string;
  // Receives morticusPath so it can read/write any file in .morticus/.
  // Must be idempotent: if a crash interrupts, re-running from the same
  // fromVersion must produce the same result.
  migrate: (morticusPath: string) => Promise<void>;
}

// Ordered registry of migration steps.
const MIGRATIONS: MigrationStep[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    description: 'Add parentVersion to state snapshots',
    async migrate(morticusPath: string) {
      const versionsDir = path.join(morticusPath, 'state', 'versions');
      const files = await listJsonFiles(versionsDir);
      for (const file of files) {
        const state = await readJson<Record<string, unknown>>(file);
        if (state.parentVersion === undefined) {
          const version = state.version as number;
          state.parentVersion = version > 1 ? version - 1 : null;
          await writeJson(file, state);
        }
      }
    },
  },
];

export function getMigrationSteps(from: number, to: number): MigrationStep[] {
  return MIGRATIONS.filter(m => m.fromVersion >= from && m.toVersion <= to)
    .sort((a, b) => a.fromVersion - b.fromVersion);
}

// Lower-level runner that takes explicit steps. Exported for testability —
// tests inject their own step functions without touching the global registry.
export async function runMigrationsWithSteps(
  morticusPath: string,
  steps: MigrationStep[],
): Promise<void> {
  const projectPath = path.join(morticusPath, 'project.json');
  const project = await readJson<Record<string, unknown>>(projectPath);
  const currentVersion = typeof project.schemaVersion === 'number'
    ? project.schemaVersion
    : 1;

  const sorted = [...steps].sort((a, b) => a.fromVersion - b.fromVersion);
  const applicable = sorted.filter(
    s => s.fromVersion >= currentVersion && s.toVersion <= sorted[sorted.length - 1].toVersion,
  );

  for (const step of applicable) {
    await step.migrate(morticusPath);

    // Update schemaVersion AFTER the step succeeds.
    // If a crash occurs mid-step, the version hasn't advanced,
    // so the step will re-run on next open (idempotent by contract).
    const proj = await readJson<Record<string, unknown>>(projectPath);
    proj.schemaVersion = step.toVersion;
    await writeJson(projectPath, proj);
  }
}

// Public entry point — uses the global MIGRATIONS registry.
export async function runMigrations(morticusPath: string): Promise<void> {
  const projectPath = path.join(morticusPath, 'project.json');

  let project: Record<string, unknown>;
  try {
    project = await readJson<Record<string, unknown>>(projectPath);
  } catch {
    // No project.json — nothing to migrate
    return;
  }

  const currentVersion = typeof project.schemaVersion === 'number'
    ? project.schemaVersion
    : 1;

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    return; // Already up to date
  }

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new MorticusError(
      `Project schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}. Please update the Morticus extension.`,
      'SCHEMA_VERSION_TOO_NEW',
      { currentVersion, supportedVersion: CURRENT_SCHEMA_VERSION },
    );
  }

  const steps = getMigrationSteps(currentVersion, CURRENT_SCHEMA_VERSION);
  if (steps.length === 0) {
    return;
  }

  try {
    await runMigrationsWithSteps(morticusPath, steps);
  } catch (err) {
    if (err instanceof MorticusError) throw err;
    throw new MorticusError(
      `Migration failed: ${(err as Error).message}`,
      'MIGRATION_ERROR',
      { fromVersion: currentVersion, toVersion: CURRENT_SCHEMA_VERSION },
    );
  }
}
