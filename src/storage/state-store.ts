import * as path from 'node:path';
import type { CanonicalProjectState } from '../domain/canonical-state.js';
import type { StateVersion, DeltaId } from '../domain/ids.js';
import { readJson, writeJson, ensureDir, listJsonFiles } from './json-backend.js';

export interface VersionSummary {
  version: StateVersion;
  parentVersion: StateVersion | null;
  createdAt: string;
  createdFromDeltaId: DeltaId | null;
}

interface CurrentStatePointer {
  version: StateVersion;
}

export class StateStore {
  private stateDir: string;
  private versionsDir: string;
  private currentPath: string;

  constructor(morticusPath: string) {
    this.stateDir = path.join(morticusPath, 'state');
    this.versionsDir = path.join(morticusPath, 'state', 'versions');
    this.currentPath = path.join(morticusPath, 'state', 'current.json');
  }

  async initialize(initialState: CanonicalProjectState): Promise<void> {
    await ensureDir(this.versionsDir);
    await this.saveVersion(initialState);
  }

  async getCurrentVersion(): Promise<StateVersion> {
    const pointer = await readJson<CurrentStatePointer>(this.currentPath);
    return pointer.version;
  }

  async getCurrentState(): Promise<CanonicalProjectState> {
    const version = await this.getCurrentVersion();
    return this.getVersion(version);
  }

  async getVersion(version: StateVersion): Promise<CanonicalProjectState> {
    const filePath = this.versionPath(version);
    return readJson<CanonicalProjectState>(filePath);
  }

  async saveVersion(state: CanonicalProjectState): Promise<void> {
    await ensureDir(this.versionsDir);
    const filePath = this.versionPath(state.version);
    await writeJson(filePath, state);
    await writeJson(this.currentPath, { version: state.version });
  }

  async listVersions(): Promise<VersionSummary[]> {
    const files = await listJsonFiles(this.versionsDir);
    const summaries: VersionSummary[] = [];
    for (const file of files) {
      const match = path.basename(file).match(/^v(\d+)\.json$/);
      if (!match) continue;
      const state = await readJson<CanonicalProjectState>(file);
      summaries.push({
        version: state.version,
        parentVersion: state.parentVersion ?? null,
        createdAt: state.createdAt,
        createdFromDeltaId: state.createdFromDeltaId,
      });
    }
    return summaries.sort((a, b) => a.version - b.version);
  }

  async getNextVersion(): Promise<StateVersion> {
    const files = await listJsonFiles(this.versionsDir);
    let max = 0;
    for (const file of files) {
      const match = path.basename(file).match(/^v(\d+)\.json$/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return (max + 1) as StateVersion;
  }

  async setCurrentVersion(version: StateVersion): Promise<void> {
    await writeJson(this.currentPath, { version });
  }

  private versionPath(version: StateVersion): string {
    const padded = String(version).padStart(3, '0');
    return path.join(this.versionsDir, `v${padded}.json`);
  }
}
