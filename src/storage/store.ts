import * as path from 'node:path';
import { generateProjectId } from '../domain/ids.js';
import { createDefaultProject, type Project } from '../domain/project.js';
import { createInitialState } from '../domain/canonical-state.js';
import { createEmptyMemory } from '../domain/durable-memory.js';
import { MorticusError } from '../domain/errors.js';
import { readJson, writeJson, fileExists, ensureDir } from './json-backend.js';
import { runMigrations } from './migrator.js';
import { StateStore } from './state-store.js';
import { TaskStore } from './task-store.js';
import { DeltaStore } from './delta-store.js';
import { MemoryStore } from './memory-store.js';
import { SpecStore } from './spec-store.js';
import { RunStore } from './run-store.js';
import { ChatStore } from './chat-store.js';

const MORTICUS_DIR = '.morticus';
const PROJECT_FILE = 'project.json';

export class ProjectStore {
  readonly morticusPath: string;
  readonly projectFilePath: string;
  readonly state: StateStore;
  readonly tasks: TaskStore;
  readonly deltas: DeltaStore;
  readonly memory: MemoryStore;
  readonly specs: SpecStore;
  readonly runs: RunStore;
  readonly chat: ChatStore;
  private migrated = false;

  constructor(workspacePath: string) {
    this.morticusPath = path.join(workspacePath, MORTICUS_DIR);
    this.projectFilePath = path.join(this.morticusPath, PROJECT_FILE);
    this.state = new StateStore(this.morticusPath);
    this.tasks = new TaskStore(this.morticusPath);
    this.deltas = new DeltaStore(this.morticusPath);
    this.memory = new MemoryStore(this.morticusPath);
    this.specs = new SpecStore(this.morticusPath);
    this.runs = new RunStore(this.morticusPath);
    this.chat = new ChatStore(this.morticusPath);
  }

  async isInitialized(): Promise<boolean> {
    return fileExists(this.projectFilePath);
  }

  async initialize(projectName: string): Promise<Project> {
    if (await this.isInitialized()) {
      throw new MorticusError(
        'Project already initialized in this workspace',
        'PROJECT_ALREADY_EXISTS',
      );
    }

    await ensureDir(this.morticusPath);

    const project = createDefaultProject(
      generateProjectId(),
      projectName,
      path.dirname(this.morticusPath),
    );
    await writeJson(this.projectFilePath, project);

    const initialState = createInitialState();
    await this.state.initialize(initialState);

    const emptyMemory = createEmptyMemory();
    await this.memory.initialize(emptyMemory);

    await this.tasks.initialize();
    await this.deltas.initialize();
    await this.specs.initialize();
    await this.runs.initialize();
    await this.chat.initialize();

    return project;
  }

  async ensureMigrated(): Promise<void> {
    if (this.migrated) return;
    await runMigrations(this.morticusPath);
    this.migrated = true;
  }

  async getProject(): Promise<Project> {
    if (!(await this.isInitialized())) {
      throw new MorticusError('No project found', 'PROJECT_NOT_FOUND');
    }
    await this.ensureMigrated();
    return readJson<Project>(this.projectFilePath);
  }

  async updateProject(project: Project): Promise<void> {
    project.updatedAt = new Date().toISOString();
    await writeJson(this.projectFilePath, project);
  }
}
