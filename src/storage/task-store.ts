import * as path from 'node:path';
import type { TaskNode } from '../domain/task.js';
import type { TaskId } from '../domain/ids.js';
import { readJson, writeJson, ensureDir, listJsonFiles } from './json-backend.js';

export class TaskStore {
  private tasksDir: string;

  constructor(morticusPath: string) {
    this.tasksDir = path.join(morticusPath, 'tasks');
  }

  async initialize(): Promise<void> {
    await ensureDir(this.tasksDir);
  }

  async save(task: TaskNode): Promise<void> {
    const filePath = this.taskPath(task.id);
    await writeJson(filePath, task);
  }

  async get(taskId: TaskId): Promise<TaskNode> {
    const filePath = this.taskPath(taskId);
    return readJson<TaskNode>(filePath);
  }

  async list(): Promise<TaskNode[]> {
    const files = await listJsonFiles(this.tasksDir);
    const tasks: TaskNode[] = [];
    for (const f of files) {
      tasks.push(await readJson<TaskNode>(f));
    }
    return tasks;
  }

  private taskPath(taskId: TaskId): string {
    return path.join(this.tasksDir, `${taskId}.json`);
  }
}
