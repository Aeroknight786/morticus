import * as path from 'node:path';
import type { TaskSpec } from '../domain/task-spec.js';
import type { SpecId } from '../domain/ids.js';
import { readJson, writeJson, ensureDir } from './json-backend.js';

export class SpecStore {
  private specsDir: string;

  constructor(morticusPath: string) {
    this.specsDir = path.join(morticusPath, 'specs');
  }

  async initialize(): Promise<void> {
    await ensureDir(this.specsDir);
  }

  async save(spec: TaskSpec): Promise<void> {
    await writeJson(this.specPath(spec.id), spec);
  }

  async get(specId: SpecId): Promise<TaskSpec> {
    return readJson<TaskSpec>(this.specPath(specId));
  }

  private specPath(specId: SpecId): string {
    return path.join(this.specsDir, `${specId}.json`);
  }
}
