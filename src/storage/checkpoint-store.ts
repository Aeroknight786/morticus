import type { Checkpoint } from '../domain/checkpoint.js';
import type { CheckpointId } from '../domain/ids.js';
import { readJson, writeJson, fileExists } from './json-backend.js';

export class CheckpointStore {
  constructor(private filePath: string) {}

  async list(): Promise<Checkpoint[]> {
    if (!(await fileExists(this.filePath))) return [];
    return readJson<Checkpoint[]>(this.filePath);
  }

  async add(checkpoint: Checkpoint): Promise<void> {
    const all = await this.list();
    all.push(checkpoint);
    await writeJson(this.filePath, all);
  }

  async remove(id: CheckpointId): Promise<void> {
    const all = await this.list();
    await writeJson(this.filePath, all.filter(c => c.id !== id));
  }
}
