import { v4 as uuidv4 } from 'uuid';
import type { ToolRequest, ToolResult } from '@agent_design/shared/types';
import { FileService } from './FileService';
import { Sandbox } from './Sandbox';
import { logger } from '../utils/logger';

export type ToolDispatch =
  | { tool: 'read_file'; path: string }
  | { tool: 'write_rtl'; path: string; content: string }
  | { tool: 'list_files'; path?: string }
  | { tool: 'run_verilator'; args: string[] }
  | { tool: 'run_validation'; args: string[] }
  | { tool: 'run_openroad'; args: string[] }
  | { tool: 'run_opensta'; args: string[] }
  | { tool: 'run_python'; script: string; args?: string[] }
  | { tool: 'run_riscv_as'; file: string; args?: string[] };

export class ToolExecutor {
  constructor(
    private readonly fileService: FileService,
    private readonly sandbox: Sandbox,
  ) {}

  async execute(dispatch: ToolDispatch, agentId: string, taskId: string, attempt: number): Promise<{
    request: ToolRequest;
    result: ToolResult;
  }> {
    const requestId = uuidv4();
    let command = '';
    let args: string[] = [];
    let reason = '';

    switch (dispatch.tool) {
      case 'read_file': {
        const content = await this.fileService.readFile(dispatch.path);
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
        await this.fileService.writeFile(dispatch.path, dispatch.content);
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
        const entries = await this.fileService.listDirectory(dispatch.path ?? '.');
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

      case 'run_verilator':
        command = 'verilator';
        args = dispatch.args;
        reason = 'Run Verilator lint/simulation';
        break;

      case 'run_validation':
        command = 'validation';
        args = dispatch.args;
        reason = 'Run Validation';
        break;

      case 'run_openroad':
        command = 'openroad';
        args = dispatch.args;
        reason = 'Run OpenROAD P&R';
        break;

      case 'run_opensta':
        command = 'opensta';
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