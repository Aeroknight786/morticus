import * as path from 'node:path';
import type { TaskRun, NormalizedOutput } from '../domain/task-run.js';
import type { RunId } from '../domain/ids.js';
import { readJson, writeJson, ensureDir, listSubdirectories, fileExists } from './json-backend.js';

export class RunStore {
  readonly runsDir: string;

  constructor(morticusPath: string) {
    this.runsDir = path.join(morticusPath, 'runs');
  }

  async initialize(): Promise<void> {
    await ensureDir(this.runsDir);
  }

  async save(run: TaskRun): Promise<void> {
    const runDir = this.runDir(run.id);
    await ensureDir(runDir);
    await writeJson(path.join(runDir, 'run.json'), run);
  }

  async get(runId: RunId): Promise<TaskRun> {
    return readJson<TaskRun>(path.join(this.runDir(runId), 'run.json'));
  }

  async list(): Promise<TaskRun[]> {
    const dirs = await listSubdirectories(this.runsDir);
    const runs: TaskRun[] = [];
    for (const dir of dirs) {
      const runJsonPath = path.join(this.runsDir, dir, 'run.json');
      if (await fileExists(runJsonPath)) {
        runs.push(await readJson<TaskRun>(runJsonPath));
      }
    }
    return runs;
  }

  async listByTask(taskId: string): Promise<TaskRun[]> {
    const all = await this.list();
    return all.filter(r => r.taskId === taskId);
  }

  async saveRawOutput(runId: RunId, output: string): Promise<void> {
    const outputPath = path.join(this.runDir(runId), 'output.json');
    await writeJson(outputPath, { output });
  }

  async getRawOutput(runId: RunId): Promise<string | null> {
    const outputPath = path.join(this.runDir(runId), 'output.json');
    if (!(await fileExists(outputPath))) return null;
    const data = await readJson<{ output: string }>(outputPath);
    return data.output;
  }

  async saveNormalizedOutput(runId: RunId, normalized: unknown): Promise<void> {
    const normalizedPath = path.join(this.runDir(runId), 'normalized.json');
    await writeJson(normalizedPath, normalized);
  }

  async getNormalizedOutput(runId: RunId): Promise<NormalizedOutput | null> {
    const normalizedPath = path.join(this.runDir(runId), 'normalized.json');
    if (!(await fileExists(normalizedPath))) return null;
    return readJson<NormalizedOutput>(normalizedPath);
  }

  private runDir(runId: RunId): string {
    return path.join(this.runsDir, runId);
  }
}
