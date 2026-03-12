import { ProjectId, StateVersion } from './ids.js';

export type ProviderType = 'claude';

export interface ProjectSettings {
  defaultProvider: ProviderType;
  autoNormalize: boolean;
  requireReviewBeforeMerge: boolean;
}

export interface Project {
  schemaVersion: number;
  id: ProjectId;
  name: string;
  repoPath: string;
  createdAt: string;
  updatedAt: string;
  currentStateVersion: StateVersion;
  durableMemoryVersion: number;
  settings: ProjectSettings;
}

export function createDefaultProject(id: ProjectId, name: string, repoPath: string): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id,
    name,
    repoPath,
    createdAt: now,
    updatedAt: now,
    currentStateVersion: 1,
    durableMemoryVersion: 1,
    settings: {
      defaultProvider: 'claude',
      autoNormalize: false,
      requireReviewBeforeMerge: true,
    },
  };
}
