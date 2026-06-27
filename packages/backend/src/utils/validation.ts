import { z } from 'zod';
import { BLOCKED_PATTERNS, ALLOWED_COMMANDS } from '@agent_design/shared/types'; // from shared/src/types/tool.types.ts
import path from 'path';
 
// Ensure a resolved path stays inside the workspace root
export function assertPathInWorkspace(targetPath: string, workspaceRoot: string): void {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(workspaceRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Path traversal attempt detected: ${targetPath}`);
  }
}
 
// Validate a shell command against whitelist and blocklist
export function validateCommand(command: string, args: string[]): void {
  const baseCmd = path.basename(command);
  if (!ALLOWED_COMMANDS.includes(baseCmd as (typeof ALLOWED_COMMANDS)[number])) {
    throw new Error(`Command not in whitelist: ${command}`);
  }
 
  const fullCommand = [command, ...args].join(' ');
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullCommand)) {
      throw new Error(`Blocked pattern detected in command: ${fullCommand}`);
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