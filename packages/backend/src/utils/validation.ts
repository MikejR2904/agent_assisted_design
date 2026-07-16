import { z } from 'zod';
import { BLOCKED_PATTERNS, ALLOWED_COMMANDS } from '@agent_design/shared/types'; // from shared/src/types/tool.types.ts
import path from 'path';
import { AppError } from '../errors/AppError';
import { ErrorCategory } from '../errors/ErrorTypes';

// Ensure a resolved path stays inside the workspace root
export function assertPathInWorkspace(targetPath: string, workspaceRoot: string): void {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(workspaceRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new AppError(
      `Path traversal attempt detected: ${targetPath}`,
      ErrorCategory.VALIDATION,
      false,
      'That path is outside the allowed workspace.',
    );
  }
}

// Validate a shell command against whitelist and blocklist
export function validateCommand(command: string, args: string[]): void {
  const baseCmd = path.basename(command);
  if (!ALLOWED_COMMANDS.includes(baseCmd as (typeof ALLOWED_COMMANDS)[number])) {
    throw new AppError(
      `Command not in whitelist: ${command}`,
      ErrorCategory.VALIDATION,
      false,
      `Command "${command}" is not permitted.`,
    );
  }

  const fullCommand = [command, ...args].join(' ');
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullCommand)) {
      throw new AppError(
        `Blocked pattern detected in command: ${fullCommand}`,
        ErrorCategory.VALIDATION,
        false,
        'That command was blocked for security reasons.',
      );
    }
  }
}
 
export const ChatMessageSchema = z.object({
  content: z.string().min(1).max(32_000),
  sessionId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
});
 
export const WorkspaceInitSchema = z.object({
  condition: z.enum(['manual', 'nhil', 'hitl', 'agent-assisted']),
  sessionId: z.string().uuid(),
});
 
export const FileUploadSchema = z.object({
  targetPath: z.string().regex(/^[a-zA-Z0-9._\-/]+$/),
});