import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'staged' | 'untracked' | 'deleted';
}

export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface GitBlameLine {
  line: number;
  hash: string;
  author: string;
  date: string;
  summary: string;
}

function parsePorcelainBlame(raw: string): GitBlameLine[] {
  const lines = raw.split('\n');
  const result: GitBlameLine[] = [];
  let current: Partial<GitBlameLine> = {};
  for (const line of lines) {
    const headerMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (headerMatch) {
      current = { hash: headerMatch[1].slice(0, 8), line: parseInt(headerMatch[2], 10) };
    } else if (line.startsWith('author ')) {
      current.author = line.slice('author '.length);
    } else if (line.startsWith('author-time ')) {
      const ts = parseInt(line.slice('author-time '.length), 10);
      current.date = new Date(ts * 1000).toISOString();
    } else if (line.startsWith('summary ')) {
      current.summary = line.slice('summary '.length);
    } else if (line.startsWith('\t')) {
      if (current.hash && current.line !== undefined) {
        result.push({
          line: current.line,
          hash: current.hash,
          author: current.author ?? 'Unknown',
          date: current.date ?? '',
          summary: current.summary ?? '',
        });
      }
    }
  }
  return result;
}

// Routes create a fresh GitService per request (see git.routes.ts's gitServiceFor()), so an
// instance-level lock can't prevent two concurrent requests for the same directory (e.g.
// GitPanel's status()+log() firing in parallel) from both seeing "no .git yet" and both
// calling `git init` at once — `git init`'s template-copy step then fails with "File exists"
// on whichever loses the race. Keyed module-level lock so concurrent callers for the same
// repoDir await one shared init instead of racing.
const initLocks = new Map<string, Promise<void>>();

/** Local-only git operations (status/diff/log/blame/stage/commit) scoped to one workspace
 * condition directory. No branching/merge/push/pull — that wasn't asked for. */
export class GitService {
  private git: SimpleGit;

  constructor(private readonly repoDir: string) {
    this.git = simpleGit(repoDir);
  }

  /** Lazily `git init`s the directory (+ an initial commit if it already has files) the
   * first time any git action touches it — workspace dirs are plain folders otherwise.
   *
   * Deliberately checks for a `.git` folder directly in `repoDir` via fs, NOT
   * `simpleGit().checkIsRepo()` — that walks up parent directories looking for any
   * enclosing repo (normal git repo-discovery behavior), and workspace directories live
   * inside this project's own git repo. Using checkIsRepo() here would silently operate
   * on — and let staging/committing touch — the outer project repo instead of an isolated
   * per-workspace one. */
  async ensureRepo(): Promise<void> {
    const existingInit = initLocks.get(this.repoDir);
    if (existingInit) return existingInit;

    const initPromise = this.doEnsureRepo().finally(() => {
      initLocks.delete(this.repoDir);
    });
    initLocks.set(this.repoDir, initPromise);
    return initPromise;
  }

  private async doEnsureRepo(): Promise<void> {
    await fs.mkdir(this.repoDir, { recursive: true });
    const hasOwnGitDir = await fs.access(path.join(this.repoDir, '.git')).then(() => true).catch(() => false);
    if (hasOwnGitDir) return;

    await this.git.init();
    await this.git.addConfig('user.email', 'agent@workbench.local');
    await this.git.addConfig('user.name', 'RTL Workbench');

    const entries = await fs.readdir(this.repoDir);
    if (entries.some((f) => f !== '.git')) {
      await this.git.add('.');
      await this.git.commit('Initial commit');
    }
    logger.info('Git repo initialized', { repoDir: this.repoDir });
  }

  async status(): Promise<GitFileStatus[]> {
    const status = await this.git.status();
    const entries: GitFileStatus[] = [];
    for (const f of status.staged) entries.push({ path: f, status: 'staged' });
    for (const f of status.not_added) entries.push({ path: f, status: 'untracked' });
    for (const f of status.modified) {
      if (!status.staged.includes(f)) entries.push({ path: f, status: 'modified' });
    }
    for (const f of status.deleted) {
      if (!status.staged.includes(f)) entries.push({ path: f, status: 'deleted' });
    }
    return entries;
  }

  async diff(filePath: string, staged: boolean): Promise<string> {
    const args = staged ? ['--staged', '--', filePath] : ['--', filePath];
    return this.git.diff(args);
  }

  async diffStagedSummary(): Promise<string> {
    return this.git.diff(['--staged']);
  }

  /** File content at a given ref (default HEAD). Empty string for untracked files that
   * don't exist at that ref yet, rather than throwing — the diff viewer treats that as
   * "whole file added". */
  async showFile(filePath: string, ref = 'HEAD'): Promise<string> {
    try {
      return await this.git.show([`${ref}:${filePath}`]);
    } catch {
      return '';
    }
  }

  async log(filePath?: string): Promise<GitLogEntry[]> {
    const result = await this.git.log(filePath ? { file: filePath } : undefined);
    return result.all.map((c) => ({
      hash: c.hash.slice(0, 8),
      date: c.date,
      message: c.message,
      author: c.author_name,
    }));
  }

  async blame(filePath: string): Promise<GitBlameLine[]> {
    const raw = await this.git.raw(['blame', '--line-porcelain', filePath]);
    return parsePorcelainBlame(raw);
  }

  async stage(paths: string[]): Promise<void> {
    await this.git.add(paths);
  }

  async unstage(paths: string[]): Promise<void> {
    await this.git.reset(['--', ...paths]);
  }

  async commit(message: string): Promise<{ hash: string }> {
    const result = await this.git.commit(message);
    return { hash: result.commit };
  }
}
