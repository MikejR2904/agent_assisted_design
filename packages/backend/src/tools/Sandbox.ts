import { spawn } from 'child_process';
import path from 'path';
import type { ToolResult } from '@agent_design/shared';
import { validateCommand } from '../utils/validation';
import { logger } from '../utils/logger';
import { ConfigManager } from '../config/ConfigManager';

export class Sandbox {
  private readonly useDocker: boolean;
  private readonly dockerImage: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly workspaceRoot: string,
    options: { useDocker?: boolean; dockerImage?: string } = {},
  ) {
    const { docker, eda } = ConfigManager.getInstance().get();
    this.useDocker = options.useDocker ?? docker.enabled;
    this.dockerImage = options.dockerImage ?? docker.image;
    this.timeoutMs = eda.timeout;
  }

  async execute(
    requestId: string,
    command: string,
    args: string[],
    workingDir: string = '.',
  ): Promise<ToolResult> {
    validateCommand(command, args);

    const absoluteDir = path.resolve(this.workspaceRoot, workingDir);
    const startTime = Date.now();

    let finalCommand = command;
    let finalArgs = args;

    if (this.useDocker) {
      finalCommand = 'docker';
      finalArgs = [
        'run',
        '--rm',
        '-v', `${this.workspaceRoot}:/workspace`,
        '-w', `/workspace/${workingDir}`,
        '--network', 'none',
        '--memory', '2g',
        '--cpus', '2',
        this.dockerImage,
        command,
        ...args,
      ];
    }

    logger.info('Executing command', { requestId, command, args, workingDir });

    return new Promise((resolve) => {
      const proc = spawn(finalCommand, finalArgs, {
        cwd: this.useDocker ? undefined : absoluteDir,
        env: {
          ...process.env,
          // Restrict to only necessary env vars
          HOME: '/tmp',
          PATH: '/usr/local/bin:/usr/bin:/bin',
        },
        timeout: this.timeoutMs,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;

      proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, this.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');
        const exitCode = code ?? -1;

        logger.info('Command completed', { requestId, exitCode, durationMs, timedOut });

        resolve({
          requestId,
          exitCode,
          stdout,
          stderr,
          durationMs,
          success: exitCode === 0 && !timedOut,
          timedOut,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        logger.error('Command error', { requestId, err: err.message });
        resolve({
          requestId,
          exitCode: -1,
          stdout: '',
          stderr: err.message,
          durationMs,
          success: false,
          timedOut: false,
        });
      });
    });
  }
}