import { z } from 'zod';

// -------------------------------------------------------------------------------------------------
// Constants and enums for telemetry - CHANGE AS NEEDED

// Define the schema for experimental conditions for research study - read thesis/docs for more details
export const ExperimentalConditionSchema = z.enum([
  'manual', // No agent assistance, human does everything
  'nhil', // Agent perform all tasks, human only observes; humans aren't allowed to debug or paste in any errors (No Human In the Loop)
  'hitl', // Agent perform tasks but humans can intervene, run simulations, paste in errors/bugs, modify commands (Human In The Loop)
  'agent-assisted', // This study
]);
export type ExperimentalCondition = z.infer<typeof ExperimentalConditionSchema>;

// Define the schema for gate transitions in the agent workflow - read thesis/docs for more details on what each gate means
// On each gate, the agent is trying to accomplish a specific sub-goal in the overall task, and certain tools are allowed or disallowed based on the gate
// The agent starts at G1 and tries to complete the task. If it fails, it goes back to G1. If it succeeds at G1, it moves to G2, then G3, then G4. Once it completes G4, the entire task is done.
// However, if the design fails on physical design due to violation, we can revert to other previous gates 
export const GateSchema = z.enum(['G1', 'G2', 'G3', 'G4']);
export type Gate = z.infer<typeof GateSchema>;
export const GateDefinitionSchema = z.object({
  id: GateSchema,
  label: z.string(),
  description: z.string(),
});
export type GateDefinition = z.infer<typeof GateDefinitionSchema>;

// Define the schema for telemetry event types - these are the different types of events we will log for research and analysis
export const TelemetryEventTypeSchema = z.enum([
  'prompt_sent',
  'response_received',
  'tool_request',
  'tool_result',
  'human_action',
  'gate_transition',
  'session_start',
  'session_end',
  'error',
  'max_attempts_exceeded',
]);
export type TelemetryEventType = z.infer<typeof TelemetryEventTypeSchema>;

// Define the schema for human actions when the agent asks for user approval on: 1) the design itself or 2) a specific tool execution (e.g. running a simulation, running a lint check, etc.)
export const HumanActionSchema = z.enum(['approved', 'denied', 'modified']);
export type HumanAction = z.infer<typeof HumanActionSchema>;

// ---------------------------------------------------------------------------------
// Main schema for telemetry events - this is the structure of the data we will log for each event. We use a discriminated union to have different fields for different event types, but all events will have at least an agentId (if applicable), sessionId, timestamp, and type.

// Match the following with TelemetryEventTypeSchema and add any additional fields as needed for each event type
export const TelemetryEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('prompt_sent'),
    agentId: z.string(),
    sessionId: z.string(),
    taskId: z.string(),
    timestamp: z.string(),
    model: z.string(),
    promptPreview: z.string().max(500),
    inputTokens: z.number().optional(),
  }),
  z.object({
    type: z.literal('response_received'),
    agentId: z.string(),
    sessionId: z.string(),
    timestamp: z.string(),
    taskId: z.string().optional(),
    model: z.string().optional(),
    attempts: z.number().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('tool_request'),
    agentId: z.string(),
    sessionId: z.string(),
    timestamp: z.string(),
    taskId: z.string().optional(),
    tool: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    reason: z.string(),
    attemptNumber: z.number(),
  }),
  z.object({
    type: z.literal('tool_result'),
    agentId: z.string(),
    sessionId: z.string(),
    timestamp: z.string(),
    taskId: z.string(),
    tool: z.string(),
    exitCode: z.number(),
    stdoutSummary: z.string().max(1000).optional(),
    durationMs: z.number(),
    success: z.boolean(),
  }),
  z.object({
    type: z.literal('human_action'),
    sessionId: z.string(),
    timestamp: z.string(),
    action: HumanActionSchema,
    tool: z.string().optional(),
    taskId: z.string(),
    originalCommand: z.string().optional(),
    modifiedCommand: z.string().optional(),
  }),
  z.object({
    type: z.literal('gate_transition'),
    sessionId: z.string(),
    timestamp: z.string(),
    fromGate: GateSchema.nullable(),
    taskId: z.string().optional(),
    toGate: GateSchema,
    triggeredBy: z.enum(['human', 'agent']),
  }),
  z.object({
    type: z.literal('session_start'),
    sessionId: z.string(),
    timestamp: z.string(),
    condition: ExperimentalConditionSchema,
    agentIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal('session_end'),
    sessionId: z.string(),
    timestamp: z.string(),
    totalTokens: z.number(),
    totalAttempts: z.number(),
    gatesCompleted: z.array(GateSchema),
    durationMs: z.number(),
  }),
  z.object({
    type: z.literal('error'),
    agentId: z.string().optional(),
    sessionId: z.string(),
    timestamp: z.string(),
    message: z.string(),
    stderrsummary: z.string().optional(), // if error is from tool execution/design, we can log the stderr summary to reduce number of tokens for AI to process.
    stack: z.string().optional(),
    exitCode: z.number().optional(),
  }),
  z.object({
    type: z.literal('max_attempts_exceeded'),
    agentId: z.string(),
    sessionId: z.string(),
    timestamp: z.string(),
    taskId: z.string(),
    attempts: z.number(),
    lastError: z.string(),
  }),
]);
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// Define the schema for aggregated session metrics -> used for research analysis for comparison
export interface SessionMetrics {
  sessionId: string;
  condition: ExperimentalCondition;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalAttempts: number;
  humanApprovals: number;
  humanDenials: number;
  humanModifications: number;
  toolExecutions: number;
  toolFailures: number;
  gatesCompleted: Gate[];
  durationMs: number;
}