import * as path from 'node:path';
import type { ScratchpadId } from '../domain/ids.js';
import type { ScratchpadSession } from '../domain/scratchpad.js';
import { readJson, writeJson, fileExists, ensureDir, listJsonFiles } from './json-backend.js';

// Scratchpad storage: one file per session at .morticus/scratchpad/<id>.json
// At most one active scratchpad at a time (v1 constraint).

export class ScratchpadStore {
  private readonly scratchpadDir: string;

  constructor(morticusPath: string) {
    this.scratchpadDir = path.join(morticusPath, 'scratchpad');
  }

  async initialize(): Promise<void> {
    await ensureDir(this.scratchpadDir);
  }

  async save(session: ScratchpadSession): Promise<void> {
    await ensureDir(this.scratchpadDir);
    const filePath = path.join(this.scratchpadDir, `${session.id}.json`);
    await writeJson(filePath, session);
  }

  async get(id: ScratchpadId): Promise<ScratchpadSession | null> {
    const filePath = path.join(this.scratchpadDir, `${id}.json`);
    if (!(await fileExists(filePath))) return null;
    return readJson<ScratchpadSession>(filePath);
  }

  async getActive(): Promise<ScratchpadSession | null> {
    const sessions = await this.list();
    const active = sessions
      .filter(s => s.status === 'active')
      .sort((a, b) => b.spawnedAt.localeCompare(a.spawnedAt));
    if (active.length > 1) {
      console.warn(`[morticus] ${active.length} active scratchpads found — expected at most 1. Returning newest.`);
    }
    return active[0] ?? null;
  }

  async list(): Promise<ScratchpadSession[]> {
    if (!(await fileExists(this.scratchpadDir))) return [];
    const files = await listJsonFiles(this.scratchpadDir);
    const sessions: ScratchpadSession[] = [];
    for (const file of files) {
      sessions.push(await readJson<ScratchpadSession>(file));
    }
    return sessions;
  }
}
