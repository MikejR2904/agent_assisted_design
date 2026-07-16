import { z } from 'zod';

// -------------------------------------------------------------------------------------------------
// Constants and enums for agent configuration - CHANGE AS NEEDED

// Define the schema for tool permissions
// 'auto-execute' means the agent can use the tool without user approval
// 'ask-user' means the agent must ask for user approval before using the tool
// 'blocked' means the agent is not allowed to use the tool at all
export const ToolPermissionSchema = z.enum(['auto-execute', 'ask-user', 'blocked']);
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;

// Define the schema for supported base models - TO BE ADDED AS WE TEST MORE MODELS
export const BaseModelSchema = z.enum([
  // Anthropic
  'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307',
  'claude-3-opus-20240229',
  'claude-opus-4.8',
  'claude-sonnet-4.5',
  // OpenAI
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'chatgpt',
  'chatgpt-5.5',
  // Google DeepMind
  'gemini-3.1-pro',
  'gemini-3.5-flash',
  'gemini-3.1-ultra',
  // Microsoft
  'copilot',
  // DeepSeek
  'deepseek-coder',
  'deepseek-chat',
  // xAI
  'grok-1', // Grok model family
  'grok-beta',
  // Meta / Groq
  'llama3-70b-8192',
  'mixtral-8x7b-32768',
  'ollama/llama3',
  'ollama/codellama',
  // Mistral
  'mistral-7b',
  'mixtral-8x22b',
  // Other OSS
  'falcon-180b',
  'phi-3-mini',
  'phi-3-medium',
  // ...
]);

// BaseModelSchema above is kept as a legacy/reference list of known model IDs, but is no longer
// used to validate agent configs — models are now sourced from the provider registry
// (config/providers.json + built-in defaults), so any non-empty string is a valid model ID.
export type BaseModel = string;

// Define the schema for supported agent tools - TO BE ADDED AS WE TEST MORE TOOLS
// Agent tools are defined in TOOL_DEFINITIONS.md and must be kept in sync with that file
export const AgentToolSchema = z.enum([
  'read_file', 'list_files',
  'write_rtl',
  'run_validation',
  'run_verilator',
  'run_openroad',
  'run_opensta',
  'run_python',
  'run_riscv_as',
  'query_rag',
  'recompile',
  'execute_command',
  'git_commit', 'git_diff', 'git_log',
  // ...
]);
export type AgentTool = z.infer<typeof AgentToolSchema>;
 
// Define the schema for agent status; this is to track the current state of the agent in the UI
export const AgentStatusSchema = z.enum(['active', 'idle', 'thinking', 'awaiting-approval', 'error']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;


// -------------------------------------------------------------------------------------------------
// Main schema for agent configuration

// ZOD schema for the overall agent configuration
export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  roleDescription: z.string().min(1).max(500),
  skillFile: z.string().optional(), // path to SKILL.md
  baseModel: z.string().min(1),
  apiKey: z.string().optional(), // if overriding global key in .env, this will be encrypted and decrypted
  permissionLevel: ToolPermissionSchema,
  assignedTools: z.array(AgentToolSchema),
  maxRetries: z.number().int().min(1).max(10).default(3), // how many times the agent will try to complete a task before giving up
  status: AgentStatusSchema.default('idle'),
  scope: z.object({ // Limit how the agent can see the project repository, to disallow cheating/information leaking
    workspaceRoot: z.string(), // e.g., "condition_agent_assisted"
    allowedPaths: z.array(z.string()).optional(), // e.g., ["src/", "tests/"]
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Schema for creating a new agent - we omit fields that are auto-generated or managed by the system
export const CreateAgentSchema = AgentConfigSchema.omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;

// --------------------------------------------------------------------------------------
// Agent Summary Schema - to track what the agent has learned throughout the session
export const AgentSummarySchema = z.object({
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  summaryText: z.string(),
  tokensUsed: z.number().int().min(0).default(0),
  timestamp: z.string().datetime(),
});

export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const AgentSummaryCreateSchema = AgentSummarySchema.omit({ timestamp: true });
export type AgentSummaryCreate = z.infer<typeof AgentSummaryCreateSchema>;