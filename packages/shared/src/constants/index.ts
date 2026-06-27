import type { GateDefinition } from '../types/telemetry.types';
 
export const DEFAULT_MAX_RETRIES = 3;
export const TOOL_TIMEOUT_MS = 300_000;
export const MAX_FILE_SIZE_MB = 10;
export const MAX_MONACO_FILE_SIZE_MB = 1;
 
export const GATE_DEFINITIONS: GateDefinition[] = [
  {
    id: 'G1',
    label: 'Architectural Spec & Interface',
    description: 'Module interface, pin definitions, and architectural constraints validated.',
  },
  {
    id: 'G2',
    label: 'Logic & Functional Verification',
    description: 'RTL passes lint (Verilator). Functional simulation testbench passes.',
  },
  {
    id: 'G3',
    label: 'Physical Unit Sign-off',
    description: 'Synthesis, P&R, and STA complete. PPA targets met. WNS >= 0.',
  },
  {
    id: 'G4',
    label: 'Integration & Mesh Array',
    description: 'Module integrated into 8x8 mesh. Full system simulation passes.',
  },
];

// Suppose the case where the preferred model is unavailable. We are to direct the system to use the next available (free-tier) model in the chain. 
// This is a fallback mechanism to ensure that the system can still function. The order of models in this array represents the priority of fallback options.
export const MODEL_FALLBACK_CHAIN = [
  'claude-3-5-sonnet-20241022', // Anthropic free tier
  'gpt-4o-mini', // OpenAI free tier
  'gemini-3.5-flash', // Gemini free tier
  'mixtral-8x7b-32768', // Groq free tier
  'llama3-70b-8192', // Groq free tier
  'ollama/codellama', // Local fallback
] as const;
 
export const EXPERIMENTAL_CONDITIONS = {
  manual: {
    id: 'manual',
    label: 'Manual Design',
    description: 'Human only. No AI assistance.',
    agentsEnabled: false,
    autoExecute: false,
  },
  nhil: {
    id: 'nhil',
    label: 'NHIL (Zero-Shot AI)',
    description: 'No-Human-In-Loop. AI runs autonomously.',
    agentsEnabled: true,
    autoExecute: true,
  },
  hitl: {
    id: 'hitl',
    label: 'HITL (Chat & Fix)',
    description: 'Human-In-The-Loop. Single agent, human approves all actions.',
    agentsEnabled: true,
    autoExecute: false,
  },
  'agent-assisted': {
    id: 'agent-assisted',
    label: 'Agent-Assisted',
    description: 'Multi-agent orchestration with governance gates.',
    agentsEnabled: true,
    autoExecute: false,
  },
} as const;

// WebSocket events for client-server communication. These events are used to send and receive messages between the client (frontend) and the server (backend) in real-time. 
// Each event has a specific purpose, such as sending a chat message, requesting a tool execution, or receiving telemetry updates.
export const WS_EVENTS = {
  // Client -> Server
  SEND_MESSAGE: 'chat:message',
  APPROVE_TOOL: 'tool:approve',
  DENY_TOOL: 'tool:deny',
  MODIFY_TOOL: 'tool:modify',
  SET_GATE: 'gate:set',
  INIT_WORKSPACE: 'workspace:init',
  JOIN_SESSION: 'session:join',
 
  // Server -> Client
  STREAM_TOKEN: 'stream:token',
  STREAM_DONE: 'stream:done',
  TOOL_REQUEST: 'tool:request',
  TOOL_RESULT: 'tool:result',
  AGENT_STATUS: 'agent:status',
  GATE_CHANGED: 'gate:changed',
  TELEMETRY_UPDATE: 'telemetry:update',
  ERROR: 'error',
  SESSION_RESET: 'session:reset',
  APPROVAL_REQUEST: 'tool:approval_request',
  TASK_COMPLETE: 'task:complete',
  TASK_CANCEL: 'task:cancel', 
} as const;
 
// EDA tool status labels for UI display. These labels are used to provide a user-friendly name for each EDA tool in the frontend interface. The keys correspond to the tool identifiers used in the backend, and the values are the human-readable labels displayed to users.
export const EDA_TOOL_STATUS_LABELS = {
  verilator: 'Verilator (Lint/Sim)',
  openroad: 'OpenROAD (P&R)',
  opensta: 'OpenSTA (Timing)',
  validation: 'Validation',
} as const;