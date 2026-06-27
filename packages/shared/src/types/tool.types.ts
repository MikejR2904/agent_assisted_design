import { z } from 'zod';

// -------------------------------------------------------------------------------------------------
// Every schema for tool outputs (request, result, approval) - CHANGE AS NEEDED

// Flow: Agent will request a tool execution by sending a ToolRequest to the server. 
//       The server will then send the ToolRequest to the tool execution service, which will execute the tool and return a ToolResult to the server. 
//       The server will then send the ToolResult back to the agent. If the tool requires human approval, the server will send an ApprovalDecision to the agent.
export const ToolRequestSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  taskId: z.string(),
  tool: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  reason: z.string(),
  estimatedDurationSeconds: z.number().optional(),
  attemptNumber: z.number(),
  maxAttempts: z.number(),
  timestamp: z.string(),
});
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

export const ToolResultSchema = z.object({
  requestId: z.string(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
  success: z.boolean(),
  timedOut: z.boolean(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ApprovalDecisionSchema = z.object({
  requestId: z.string(),
  action: z.enum(['approved', 'denied', 'modified']),
  modifiedCommand: z.string().optional(),
  modifiedArgs: z.array(z.string()).optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ALLOWED_COMMANDS = [
  'verilator',
  'python3',
  'validation',
  'riscv64-unknown-elf-as',
  'openroad',
  'opensta',
] as const;

export const BLOCKED_PATTERNS = [
  /rm\s+-rf/,
  /sudo/,
  /chmod\s+[0-9]/,
  /curl\s+https?:\/\//,
  /wget\s+https?:\/\//,
  />\s*\/etc\//,
  />\s*\/usr\//,
  />\s*\/bin\//,
  /;\s*rm/,
  /&&\s*rm/,
  /\|\|\s*rm/,
];

// export const TOOL_TIMEOUT_MS = 300_000; // 5 minutes