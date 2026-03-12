import * as path from 'node:path';
import type { StateDelta } from '../domain/state-delta.js';
import type { DeltaId } from '../domain/ids.js';
import { readJson, writeJson, ensureDir } from './json-backend.js';

export class DeltaStore {
  private deltasDir: string;

  constructor(morticusPath: string) {
    this.deltasDir = path.join(morticusPath, 'state', 'deltas');
  }

  async initialize(): Promise<void> {
    await ensureDir(this.deltasDir);
  }

  async save(delta: StateDelta): Promise<void> {
    const filePath = this.deltaPath(delta.id);
    await writeJson(filePath, delta);
  }

  async get(deltaId: DeltaId): Promise<StateDelta> {
    const filePath = this.deltaPath(deltaId);
    return readJson<StateDelta>(filePath);
  }

  private deltaPath(deltaId: DeltaId): string {
    return path.join(this.deltasDir, `${deltaId}.json`);
  }
}
