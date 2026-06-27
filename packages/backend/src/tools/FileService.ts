import fs from 'fs/promises';
import path from 'path';
import { assertPathInWorkspace } from '../utils/validation';
import { logger } from '../utils/logger';

// Handle file operations within the agent's workspace
export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  locked?: boolean;
  children?: FileEntry[];
}

// List of files that are locked and cannot be written to by the agent; this is to protect critical configuration files from accidental overwrites by the agent. The agent can read these files but not modify them.
const LOCKED_FILES = ['architecture.toml', 'gates.json']; // TO BE EXPANDED

export class FileService {
  private workspaceRoot: string;
  private allowedPaths: string[] | null = null;

  constructor(workspaceRoot: string, allowedPaths?: string[]) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.allowedPaths = allowedPaths || null;
  }

  public resolve(relativePath: string): string {
    const full = path.resolve(this.workspaceRoot, relativePath);
    assertPathInWorkspace(full, this.workspaceRoot);
    // Enforce allowed subdirectories if specified
    if (this.allowedPaths) {
      const inAllowed = this.allowedPaths.some((allowed) => {
        const allowedAbs = path.resolve(this.workspaceRoot, allowed);
        return full.startsWith(allowedAbs + path.sep) || full === allowedAbs;
      });
      if (!inAllowed) {
        throw new Error(`Access denied: ${relativePath} is outside allowed paths: ${this.allowedPaths.join(', ')}`);
      }
    }
    return full;
  }

  async readFile(relativePath: string): Promise<string> {
    const full = this.resolve(relativePath);
    return fs.readFile(full, 'utf-8');
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const full = this.resolve(relativePath);
    if (LOCKED_FILES.some((f) => full.endsWith(f))) {
      throw new Error(`File is locked and cannot be written: ${relativePath}`);
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
    logger.info('File written', { path: relativePath });
  }

  async listDirectory(relativePath: string = '.'): Promise<FileEntry[]> {
    const full = this.resolve(relativePath);
    const entries = await fs.readdir(full, { withFileTypes: true });

    return Promise.all(
      entries.map(async (e) => {
        const entryPath = path.join(relativePath, e.name);
        const stat = await fs.stat(path.join(full, e.name)).catch(() => null);
        return {
          name: e.name,
          path: entryPath,
          type: (e.isDirectory() ? 'directory' : 'file') as 'file' | 'directory',
          size: stat?.size,
          modifiedAt: stat?.mtime.toISOString(),
          locked: LOCKED_FILES.includes(e.name),
        };
      }),
    );
  }

  async ensureDirectory(relativePath: string): Promise<void> {
    const full = this.resolve(relativePath);
    await fs.mkdir(full, { recursive: true });
  }

  async copyDirectory(srcAbsolute: string, destRelative: string): Promise<void> {
    const dest = this.resolve(destRelative);
    await fs.cp(srcAbsolute, dest, { recursive: true });
    logger.info('Directory copied', { src: srcAbsolute, dest: destRelative });
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const full = this.resolve(relativePath);
      await fs.access(full);
      return true;
    } catch {
      return false;
    }
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}