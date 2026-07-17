export enum ErrorCategory {
  LLM_PROVIDER = 'LLM_PROVIDER',   // API key, rate limit, model unavailable
  TOOL_EXECUTION = 'TOOL_EXECUTION', // Verilator/OpenROAD failure, file access, sandbox
  VALIDATION = 'VALIDATION',       // Invalid input, security rejection
  CONFIG = 'CONFIG',               // Missing or invalid config
  NETWORK = 'NETWORK',             // Connection issues
  AUTHENTICATION = 'AUTHENTICATION', // Missing/invalid/expired credentials (401)
  AUTHORIZATION = 'AUTHORIZATION',   // Authenticated but not permitted (403)
}
