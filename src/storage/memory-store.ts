import * as path from 'node:path';
import type { DurableMemory, MemoryEntry } from '../domain/durable-memory.js';
import type { MemoryEntryId } from '../domain/ids.js';
import { readJson, writeJson, ensureDir } from './json-backend.js';

export class MemoryStore {
  private memoryDir: string;
  private entriesPath: string;

  constructor(morticusPath: string) {
    this.memoryDir = path.join(morticusPath, 'memory');
    this.entriesPath = path.join(morticusPath, 'memory', 'entries.json');
  }

  async initialize(memory: DurableMemory): Promise<void> {
    await ensureDir(this.memoryDir);
    await writeJson(this.entriesPath, memory);
  }

  async get(): Promise<DurableMemory> {
    return readJson<DurableMemory>(this.entriesPath);
  }

  async save(memory: DurableMemory): Promise<void> {
    await writeJson(this.entriesPath, memory);
  }

  async addEntry(entry: MemoryEntry): Promise<void> {
    const memory = await this.get();
    memory.entries.push(entry);
    memory.version++;
    memory.updatedAt = new Date().toISOString();
    await this.save(memory);
  }

  async updateEntry(
    id: MemoryEntryId,
    updates: Partial<Pick<MemoryEntry, 'category' | 'title' | 'content' | 'active' | 'reviewed'>>,
  ): Promise<void> {
    const memory = await this.get();
    const idx = memory.entries.findIndex(e => e.id === id);
    if (idx === -1) return;
    memory.entries[idx] = {
      ...memory.entries[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    memory.version++;
    memory.updatedAt = new Date().toISOString();
    await this.save(memory);
  }

  async removeEntry(id: MemoryEntryId): Promise<void> {
    const memory = await this.get();
    memory.entries = memory.entries.filter(e => e.id !== id);
    memory.version++;
    memory.updatedAt = new Date().toISOString();
    await this.save(memory);
  }

  async getEntry(id: MemoryEntryId): Promise<MemoryEntry | undefined> {
    const memory = await this.get();
    return memory.entries.find(e => e.id === id);
  }
}
