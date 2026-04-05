import * as path from 'node:path';
import type { MemCell } from '../domain/durable-memory.js';
import type { MemCellId } from '../domain/ids.js';
import { readJson, writeJson, listJsonFiles, ensureDir } from './json-backend.js';

export class MemCellStore {
  private memcellsDir: string;

  constructor(morticusPath: string) {
    this.memcellsDir = path.join(morticusPath, 'memcells');
  }

  async initialize(): Promise<void> {
    await ensureDir(this.memcellsDir);
  }

  async save(cell: MemCell): Promise<void> {
    const filePath = path.join(this.memcellsDir, `${cell.id}.json`);
    await writeJson(filePath, cell);
  }

  async get(id: MemCellId): Promise<MemCell | null> {
    const filePath = path.join(this.memcellsDir, `${id}.json`);
    try {
      return await readJson<MemCell>(filePath);
    } catch {
      return null;
    }
  }

  async list(): Promise<MemCell[]> {
    const files = await listJsonFiles(this.memcellsDir);
    const cells: MemCell[] = [];
    for (const file of files) {
      try {
        const cell = await readJson<MemCell>(file);
        cells.push(cell);
      } catch {
        // Skip corrupted files
      }
    }
    return cells.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  async listBySource(sourcePrefix: string): Promise<MemCell[]> {
    const all = await this.list();
    return all.filter(c => c.source.startsWith(sourcePrefix));
  }

  async update(id: MemCellId, patch: Partial<MemCell>): Promise<void> {
    const cell = await this.get(id);
    if (!cell) return;
    const updated: MemCell = {
      ...cell,
      ...patch,
      id: cell.id, // never overwrite id
      updatedAt: new Date().toISOString(),
    };
    await this.save(updated);
  }
}
