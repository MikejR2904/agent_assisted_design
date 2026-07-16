import { v4 as uuidv4 } from 'uuid';
import type { ToolRequest, ToolResult } from '@agent_design/shared/types';
import { FileService } from './FileService';
import { Sandbox } from './Sandbox';
import { RagService } from '../services/RagService';
import { logger } from '../utils/logger';
import { ConfigManager } from '../config/ConfigManager';
import { AppError } from '../errors/AppError';
import { ErrorCategory } from '../errors/ErrorTypes';
import { withRetry } from '../errors/ErrorHandler';

// Node fs error codes that represent a genuinely transient failure worth a short retry (a file
// momentarily locked by another process, too many open handles) — as opposed to e.g. ENOENT
// (file doesn't exist) or an AppError from a deliberate security rejection, neither of which
// retrying would ever fix.
const TRANSIENT_FS_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'EAGAIN']);

function toToolError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const code = (err as NodeJS.ErrnoException)?.code;
  const retryable = !!code && TRANSIENT_FS_CODES.has(code);
  return new AppError(
    err instanceof Error ? err.message : String(err),
    ErrorCategory.TOOL_EXECUTION,
    retryable,
    'A file operation failed. Please try again.',
  );
}

export type ToolDispatch =
  | { tool: 'read_file'; path: string }
  | { tool: 'write_rtl'; path: string; content: string }
  | { tool: 'list_files'; path?: string }
  | { tool: 'run_verilator'; args: string[] }
  | { tool: 'run_validation'; args: string[] }
  | { tool: 'run_openroad'; args: string[] }
  | { tool: 'run_opensta'; args: string[] }
  | { tool: 'run_python'; script: string; args?: string[] }
  | { tool: 'run_riscv_as'; file: string; args?: string[] }
  | { tool: 'query_rag'; query: string; topK?: number };

export class ToolExecutor {
  constructor(
    private readonly fileService: FileService,
    private readonly sandbox: Sandbox,
  ) {}

  private runFileOp<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(() => fn().catch((err) => { throw toToolError(err); }));
  }

  async execute(dispatch: ToolDispatch, agentId: string, taskId: string, attempt: number): Promise<{
    request: ToolRequest;
    result: ToolResult;
  }> {
    const requestId = uuidv4();
    const { eda } = ConfigManager.getInstance().get();
    let command = '';
    let args: string[] = [];
    let reason = '';

    switch (dispatch.tool) {
      case 'read_file': {
        const content = await this.runFileOp(() => this.fileService.readFile(dispatch.path));
        const request: ToolRequest = {
          id: requestId,
          agentId,
          taskId,
          tool: 'read_file',
          command: `cat ${dispatch.path}`,
          args: [dispatch.path],
          reason: 'Read file content',
          attemptNumber: attempt,
          maxAttempts: 3,
          timestamp: new Date().toISOString(),
        };
        return {
          request,
          result: {
            requestId,
            exitCode: 0,
            stdout: content,
            stderr: '',
            durationMs: 0,
            success: true,
            timedOut: false,
          },
        };
      }

      case 'write_rtl': {
        await this.runFileOp(() => this.fileService.writeFile(dispatch.path, dispatch.content));
        const request: ToolRequest = {
          id: requestId,
          agentId,
          taskId,
          tool: 'write_rtl',
          command: `write ${dispatch.path}`,
          args: [dispatch.path],
          reason: 'Write RTL file',
          attemptNumber: attempt,
          maxAttempts: 3,
          timestamp: new Date().toISOString(),
        };
        return {
          request,
          result: {
            requestId,
            exitCode: 0,
            stdout: `Written: ${dispatch.path}`,
            stderr: '',
            durationMs: 0,
            success: true,
            timedOut: false,
          },
        };
      }

      case 'list_files': {
        const entries = await this.runFileOp(() => this.fileService.listDirectory(dispatch.path ?? '.'));
        const request: ToolRequest = {
          id: requestId,
          agentId,
          taskId,
          tool: 'list_files',
          command: `ls ${dispatch.path ?? '.'}`,
          args: [dispatch.path ?? '.'],
          reason: 'List directory',
          attemptNumber: attempt,
          maxAttempts: 3,
          timestamp: new Date().toISOString(),
        };
        return {
          request,
          result: {
            requestId,
            exitCode: 0,
            stdout: JSON.stringify(entries, null, 2),
            stderr: '',
            durationMs: 0,
            success: true,
            timedOut: false,
          },
        };
      }

      case 'query_rag': {
        const results = await RagService.getInstance().query(dispatch.query, dispatch.topK);
        const request: ToolRequest = {
          id: requestId,
          agentId,
          taskId,
          tool: 'query_rag',
          command: `query_rag "${dispatch.query}"`,
          args: [dispatch.query],
          reason: 'Query RAG knowledge base',
          attemptNumber: attempt,
          maxAttempts: 3,
          timestamp: new Date().toISOString(),
        };
        return {
          request,
          result: {
            requestId,
            exitCode: 0,
            stdout: results.length
              ? JSON.stringify(results, null, 2)
              : 'No results (RAG knowledge base is empty or unavailable).',
            stderr: '',
            durationMs: 0,
            success: true,
            timedOut: false,
          },
        };
      }

      case 'run_verilator':
        // Falls back to the bare command name (PATH lookup) when no path is configured —
        // identical to today's behavior unless eda.verilatorPath is set.
        command = eda.verilatorPath || 'verilator';
        args = dispatch.args;
        reason = 'Run Verilator lint/simulation';
        break;

      case 'run_validation':
        command = 'validation';
        args = dispatch.args;
        reason = 'Run Validation';
        break;

      case 'run_openroad':
        command = eda.openroadPath || 'openroad';
        args = dispatch.args;
        reason = 'Run OpenROAD P&R';
        break;

      case 'run_opensta':
        command = eda.openstaPath || 'opensta';
        args = dispatch.args;
        reason = 'Run OpenSTA timing analysis';
        break;

      case 'run_python':
        command = 'python3';
        args = [dispatch.script, ...(dispatch.args ?? [])];
        reason = 'Run Python script';
        break;

      case 'run_riscv_as':
        command = 'riscv64-unknown-elf-as';
        args = [dispatch.file, ...(dispatch.args ?? [])];
        reason = 'Assemble RISC-V file';
        break;
    }

    const request: ToolRequest = {
      id: requestId,
      agentId,
      taskId,
      tool: dispatch.tool,
      command,
      args,
      reason,
      attemptNumber: attempt,
      maxAttempts: 3,
      timestamp: new Date().toISOString(),
    };

    const result = await this.sandbox.execute(requestId, command, args);

    logger.info('Tool executed', {
      tool: dispatch.tool,
      success: result.success,
      exitCode: result.exitCode,
    });

    return { request, result };
  }
}