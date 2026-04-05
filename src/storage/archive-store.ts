import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArchiveId } from '../domain/ids.js';
import type { ArchiveRecord } from '../domain/import.js';
import { readJson, writeJson, ensureDir, listSubdirectories } from './json-backend.js';

export class ArchiveStore {
  private archiveDir: string;

  constructor(morticusPath: string) {
    this.archiveDir = path.join(morticusPath, 'archive');
  }

  private recordPath(id: ArchiveId): string {
    return path.join(this.archiveDir, id, 'record.json');
  }

  private sourcePath(id: ArchiveId): string {
    return path.join(this.archiveDir, id, 'source.txt');
  }

  async save(record: ArchiveRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await ensureDir(path.join(this.archiveDir, record.id));
    await writeJson(this.recordPath(record.id), record);
  }

  async get(id: ArchiveId): Promise<ArchiveRecord> {
    return readJson<ArchiveRecord>(this.recordPath(id));
  }

  async list(): Promise<ArchiveRecord[]> {
    const dirs = await listSubdirectories(this.archiveDir);
    const archiveDirs = dirs.filter(d => d.startsWith('arch_'));
    const records: ArchiveRecord[] = [];
    for (const dir of archiveDirs) {
      try {
        const record = await readJson<ArchiveRecord>(
          path.join(this.archiveDir, dir, 'record.json'),
        );
        records.push(record);
      } catch {
        // Skip corrupted or incomplete archives
      }
    }
    return records;
  }

  async saveRawContent(id: ArchiveId, content: string): Promise<void> {
    await ensureDir(path.join(this.archiveDir, id));
    await fs.promises.writeFile(this.sourcePath(id), content, 'utf-8');
  }

  async getRawContent(id: ArchiveId): Promise<string> {
    return fs.promises.readFile(this.sourcePath(id), 'utf-8');
  }
}
