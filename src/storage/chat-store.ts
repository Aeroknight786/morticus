import * as path from 'node:path';
import type { ChatSession } from '../domain/chat.js';
import { readJson, writeJson, fileExists, ensureDir } from './json-backend.js';

// Chat storage: single main session per project.
// Stored at .morticus/chat/main.json

export class ChatStore {
  private readonly chatDir: string;
  private readonly mainSessionPath: string;

  constructor(morticusPath: string) {
    this.chatDir = path.join(morticusPath, 'chat');
    this.mainSessionPath = path.join(this.chatDir, 'main.json');
  }

  async initialize(): Promise<void> {
    await ensureDir(this.chatDir);
  }

  async hasSession(): Promise<boolean> {
    return fileExists(this.mainSessionPath);
  }

  async get(): Promise<ChatSession | null> {
    if (!(await this.hasSession())) return null;
    return readJson<ChatSession>(this.mainSessionPath);
  }

  async save(session: ChatSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await writeJson(this.mainSessionPath, session);
  }
}
