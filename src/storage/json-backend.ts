import * as fs from 'node:fs';
import * as path from 'node:path';
import { MorticusError } from '../domain/errors.js';

// Atomic JSON read/write using temp-file-rename pattern.
// Prevents corruption on crash.

export async function readJson<T>(filePath: string): Promise<T> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new MorticusError(
      `Failed to read ${filePath}: ${(err as Error).message}`,
      'STORE_READ_ERROR',
      { filePath },
    );
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    throw new MorticusError(
      `Failed to write ${filePath}: ${(err as Error).message}`,
      'STORE_WRITE_ERROR',
      { filePath },
    );
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

export async function listJsonFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dirPath);
    return entries.filter(e => e.endsWith('.json')).map(e => path.join(dirPath, e));
  } catch {
    return [];
  }
}

export async function listSubdirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}
