import { Router } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { FileService } from '../tools/FileService';
import { parseVerilatorOutput } from '../utils/verilatorParser';
import { logger } from '../utils/logger';
import { ConfigManager } from '../config/ConfigManager';

const { paths } = ConfigManager.getInstance().get();
const WORKSPACE_ROOT = paths.workspaceRoot ?? path.resolve(process.cwd(), '../../workspaces');
const LINT_TIMEOUT_MS = 15000;

interface LintResult {
  diagnostics: ReturnType<typeof parseVerilatorOutput>;
  toolAvailable: boolean;
}

function runVerilatorLint(verilatorPath: string, absoluteFile: string): Promise<LintResult> {
  return new Promise((resolve) => {
    const proc = spawn(verilatorPath, ['--lint-only', '-Wall', absoluteFile], {
      cwd: path.dirname(absoluteFile),
      timeout: LINT_TIMEOUT_MS,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('close', () => {
      const log = Buffer.concat([...stdoutChunks, ...stderrChunks]).toString('utf-8');
      resolve({ diagnostics: parseVerilatorOutput(log), toolAvailable: true });
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        logger.debug('verilator not found on PATH — lint skipped', { verilatorPath });
        resolve({ diagnostics: [], toolAvailable: false });
      } else {
        logger.error('Verilator lint error', { err: err.message });
        resolve({ diagnostics: [], toolAvailable: false });
      }
    });
  });
}

export function lintRouter(): Router {
  const router = Router();

  // POST /api/lint/verilog { condition, path }
  router.post('/verilog', async (req, res) => {
    try {
      const { condition, path: filePath } = req.body as { condition?: string; path: string };
      if (!filePath) return res.status(400).json({ error: 'path required' });
      if (!/\.(v|sv|vh)$/i.test(filePath)) {
        return res.json({ diagnostics: [], toolAvailable: true });
      }

      const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition ?? 'agent-assisted'}`);
      const fileService = new FileService(conditionDir);
      const absoluteFile = fileService.resolve(filePath);

      const { eda } = ConfigManager.getInstance().get();
      const verilatorPath = eda.verilatorPath || 'verilator';
      const result = await runVerilatorLint(verilatorPath, absoluteFile);
      res.json(result);
    } catch (err) {
      logger.error('Lint route error', { err: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
