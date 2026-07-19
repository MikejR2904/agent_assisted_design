import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { FileService, FileEntry } from '../tools/FileService';
import { logger } from '../utils/logger';
import AdmZip, { IZipEntry } from 'adm-zip';
import fs from 'fs/promises';
import { ConfigManager } from '../config/ConfigManager';
import { GitService } from '../services/GitService';

const { paths } = ConfigManager.getInstance().get();
const WORKSPACE_ROOT = paths.workspaceRoot ?? path.resolve(process.cwd(), '../../workspaces');
const SKILLS_ROOT = paths.skillsRoot ?? path.resolve(process.cwd(), '../../skills');
const CONFIG_ROOT = paths.configRoot ?? path.resolve(process.cwd(), '../../config');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Helper to recursively build tree. `gitStatusByPath` is an optional lookup (populated only
// when the condition dir already has a .git repo — see the /tree route) used to annotate
// entries with their git status; passing none just leaves every entry's gitStatus undefined.
async function buildTree(
  dir: string,
  relativePath: string = '',
  gitStatusByPath?: Map<string, FileEntry['gitStatus']>,
): Promise<FileEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: FileEntry[] = [];

  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const entryPath = path.join(relativePath, entry.name);
    const fullPath = path.join(dir, entry.name);
    const isDir = entry.isDirectory();

    const stat = await fs.stat(fullPath).catch(() => null);
    const fileEntry: FileEntry = {
      name: entry.name,
      path: entryPath,
      type: isDir ? 'directory' : 'file',
      size: stat?.size,
      modifiedAt: stat?.mtime.toISOString(),
      locked: ['architecture.toml', 'gates.json'].includes(entry.name),
      gitStatus: gitStatusByPath?.get(entryPath.split(path.sep).join('/')),
    };

    if (isDir) {
      fileEntry.children = await buildTree(fullPath, entryPath, gitStatusByPath);
    }
    result.push(fileEntry);
  }
  return result;
}

export function filesRouter(): Router {
  const router = Router();

  // GET /api/files/tree?condition=agent-assisted
  router.get('/tree', async (req, res) => {
    try {
      const condition = (req.query.condition as string) ?? 'agent-assisted';
      const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition}`);
      const fileService = new FileService(conditionDir);
      // Use the fileService's workspace root to get the absolute path
      const rootDir = fileService.getWorkspaceRoot();
      // Check if directory exists; if not, return empty array
      try {
        await fs.access(rootDir);
      } catch {
        return res.json([]);
      }
      // Only annotate git status if a repo already exists — the file tree never
      // triggers `git init` itself, that's lazy and scoped to the Git tab's own actions.
      let gitStatusByPath: Map<string, FileEntry['gitStatus']> | undefined;
      const hasGitRepo = await fs.access(path.join(rootDir, '.git')).then(() => true).catch(() => false);
      if (hasGitRepo) {
        try {
          const entries = await new GitService(rootDir).status();
          gitStatusByPath = new Map(entries.map((e) => [e.path, e.status]));
        } catch (err) {
          logger.debug('Git status lookup skipped for tree', { err: (err as Error).message });
        }
      }
      const tree = await buildTree(rootDir, '', gitStatusByPath);
      res.json(tree);
    } catch (err) {
      logger.error('Tree build error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/files/content?path=...&condition=...
  router.get('/content', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      const condition = (req.query.condition as string) ?? 'agent-assisted';
      const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition}`);
      const fileService = new FileService(conditionDir);
      const content = await fileService.readFile(filePath);
      res.json({ content, path: filePath });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // GET /api/files/skills/:filename
  router.get('/skills/:filename', async (req, res) => {
    try {
      const fileService = new FileService(SKILLS_ROOT);
      const content = await fileService.readFile(req.params.filename);
      res.json({ content, path: req.params.filename });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // PUT /api/files/skills/:filename
  router.put('/skills/:filename', async (req, res) => {
    try {
      const { content } = req.body as { content: string };
      const fileService = new FileService(SKILLS_ROOT);
      await fileService.writeFile(req.params.filename, content);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/files/config/:filename
  router.get('/config/:filename', async (req, res) => {
    try {
      const fileService = new FileService(CONFIG_ROOT);
      const content = await fileService.readFile(req.params.filename);
      res.json({ content, path: req.params.filename, locked: req.params.filename === 'architecture.toml' });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // POST /api/files/upload
  router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const condition = (req.body.condition as string) ?? 'agent-assisted';
      const targetPath = req.body.targetPath as string;
      const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition}`);
      const fileService = new FileService(conditionDir);
      await fileService.writeFile(targetPath, req.file.buffer.toString('utf-8'));
      logger.info('File uploaded', { targetPath, condition, size: req.file.size });
      res.json({ success: true, path: targetPath });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/files/upload-folder
  router.post('/upload-folder', upload.array('files'), async (req, res) => {
    const files = req.files as Express.Multer.File[];
    const condition = (req.body.condition as string) ?? 'agent-assisted';
    const targetPath = (req.body.targetPath as string) ?? '';
    const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition}`);
    const fileService = new FileService(conditionDir);
    
    for (const file of files) {
      // The frontend must provide the relative path in file.originalname, e.g., "src/tensor_pe.v"
      const relativePath = path.join(targetPath, file.originalname);
      await fileService.writeFile(relativePath, file.buffer.toString('utf-8'));
    }
    
    res.json({ success: true, count: files.length });
  });

  // POST /api/files/upload-zip
  router.post('/upload-zip', upload.single('zip'), async (req, res) => {
    const zipFile = req.file;
    if (!zipFile) return res.status(400).json({ error: 'No ZIP file provided' });
    
    const condition = req.body.condition ?? 'agent-assisted';
    const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition}`);
    const targetPath = req.body.targetPath ?? '';
    
    const zip = new AdmZip(zipFile.buffer);
    const entries = zip.getEntries();
    const fileService = new FileService(conditionDir);
    
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      // const relative = path.join(targetPath, entry.entryName);
      // const content = entry.getData().toString('utf-8');
      // await fileService.writeFile(relative, content);
      const fullPath = entry.entryName;
      await fileService.writeFile(fullPath, entry.getData().toString('utf-8'));
    }
    
    res.json({ success: true, count: entries.filter(e => !e.isDirectory).length });
  });

  // POST /api/files/move { condition, sourcePath, destPath }
  router.post('/move', async (req, res) => {
    try {
      const { condition, sourcePath, destPath } = req.body as { condition?: string; sourcePath: string; destPath: string };
      if (!sourcePath || !destPath) return res.status(400).json({ error: 'sourcePath and destPath required' });
      const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition ?? 'agent-assisted'}`);
      const fileService = new FileService(conditionDir);
      await fileService.movePath(sourcePath, destPath);
      logger.info('File moved', { sourcePath, destPath, condition });
      res.json({ success: true, path: destPath });
    } catch (err) {
      logger.error('Move error', { err: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/files/copy { condition, sourcePath, destPath }
  router.post('/copy', async (req, res) => {
    try {
      const { condition, sourcePath, destPath } = req.body as { condition?: string; sourcePath: string; destPath: string };
      if (!sourcePath || !destPath) return res.status(400).json({ error: 'sourcePath and destPath required' });
      const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition ?? 'agent-assisted'}`);
      const fileService = new FileService(conditionDir);
      await fileService.copyPath(sourcePath, destPath);
      logger.info('File copied', { sourcePath, destPath, condition });
      res.json({ success: true, path: destPath });
    } catch (err) {
      logger.error('Copy error', { err: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/files/delete?path=...&condition=...
  router.delete('/delete', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      const condition = (req.query.condition as string) ?? 'agent-assisted';
      if (!filePath) return res.status(400).json({ error: 'path required' });

      const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition}`);
      const fileService = new FileService(conditionDir);
      const fullPath = fileService.resolve(filePath);

      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.unlink(fullPath);
      }

      logger.info('File deleted', { path: filePath, condition });
      res.json({ success: true, path: filePath });
    } catch (err) {
      logger.error('Delete error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}