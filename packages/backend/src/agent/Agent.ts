import type { AgentConfig, AgentTool, ToolResult, PPAMetrics } from '@agent_design/shared/types';
import type { ModelRouter, LLMMessage, StreamCallback } from '../models/ModelRouter';
import type { ConfigService } from '../services/ConfigService';
import type { TelemetryService } from '../services/TelemetryService';
import type { ToolDispatch, ToolExecutor } from '../tools/ToolExecutor';
import { ThinkingStreamSplitter } from './ThinkingStreamSplitter';
import { AppError } from '../errors/AppError';
import { ErrorCategory } from '../errors/ErrorTypes';
import { logger } from '../utils/logger';

// Extends StreamCallback with a channel for live reasoning tokens, split out of the model's
// <thinking>...</thinking> block by ThinkingStreamSplitter — see streamResponse.
export interface AgentStreamCallback extends StreamCallback {
  onReasoningToken?: (token: string) => void;
}

// An Agent does:
// - Holds conversation history.
// - Builds system prompt alongside SKILL.md + architecture config.
// - Calls LLM and handles streaming.
// - Executes tools via injected ToolExecutor.
// - Injects errors into history for reflexion.
export class Agent {
  private conversationHistory: LLMMessage[] = [];
  private memoryContext: string = '';
  private latestPPA?: PPAMetrics;

  constructor(
    private readonly config: AgentConfig,
    private readonly modelRouter: ModelRouter,
    private readonly configService: ConfigService,
    private readonly telemetryService: TelemetryService,
    private readonly toolExecutor: ToolExecutor,
  ) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get maxRetries(): number {
    return this.config.maxRetries;
  }

  get permissionLevel(): AgentConfig['permissionLevel'] {
    return this.config.permissionLevel;
  }

  setMemoryContext(memory: string): void {
    this.memoryContext = memory;
  }

  // Fed back after a run_openroad/run_opensta tool call — kept separate from setMemoryContext
  // (project-summary memory) so physical-design results and project memory don't clobber each
  // other on refresh.
  setPPAMetrics(metrics: PPAMetrics): void {
    this.latestPPA = metrics;
  }

  async buildSystemPrompt(gate: string, condition: string): Promise<string> {
    const skillContent = await this.configService.getSkillContent(this.config.id);
    const arch = this.configService.getArchConfig();
    const sections = [
      skillContent,
      '',
      '## Project Memory',
      this.memoryContext || 'No previous context available.',
      '',
      '## Current Context',
      `- Module: ${arch.module.name}`,
      `- Target Frequency: ${arch.module.target_freq_mhz} MHz`,
      `- Data Width: ${arch.module.data_width} bits`,
      `- Accumulator Width: ${arch.module.accum_width} bits`,
      `- Scratchpad: ${arch.memory.scratchpad_kb} KB (ping-pong)`,
      `- Current Gate: ${gate}`,
      `- Experimental Condition: ${condition}`,
    ];

    if (this.latestPPA) {
      const p = this.latestPPA;
      sections.push(
        '',
        '## Latest Physical Design Metrics',
        `- Area: ${p.area} µm²`,
        `- Power: ${p.power} mW`,
        `- Frequency: ${p.frequency} MHz`,
        `- WNS: ${p.wns} ns${p.wns < 0 ? ' (setup violation)' : ''}`,
        `- TNS: ${p.tns} ns`,
        ...(p.cells !== undefined ? [`- Cells: ${p.cells}`] : []),
        ...(p.nets !== undefined ? [`- Nets: ${p.nets}`] : []),
      );
    }

    sections.push(
      '',
      '## Assigned Tools',
      this.config.assignedTools.map((t) => `- ${t}`).join('\n'),
      '',
      '## Constraints',
      `- Max retries: ${this.config.maxRetries}`,
      `- Permission level: ${this.config.permissionLevel}`,
      '- Always output Verilog in fenced code blocks (```verilog ... ```).',
      '- When requesting a tool, use the format: TOOL_REQUEST: <tool_name> <args>',
      '- Before your final answer, think through the problem inside <thinking>...</thinking> tags. Keep the tool-request format and your final answer outside those tags.',
    );
    if (this.config.assignedTools.includes('query_rag')) {
      sections.push('- To search the knowledge base, request: TOOL_REQUEST: query_rag {"query": "...", "topK": 5}');
    }

    return sections.join('\n');
  }

  addUserMessage(content: string): void {
    this.conversationHistory.push({ role: 'user', content });
  }

  addAssistantMessage(content: string): void {
    this.conversationHistory.push({ role: 'assistant', content });
  }

  async streamResponse(
    userMessage: string,
    sessionId: string,
    callbacks: AgentStreamCallback,
    gate: string,
    condition: string,
  ): Promise<void> {
    const systemPrompt = await this.buildSystemPrompt(gate, condition);
    this.addUserMessage(userMessage);

    // Splits the raw stream into answer/reasoning channels for the client's benefit only —
    // response.content below (what gets stored and tool-parsed) is left untouched, tags and all.
    const splitter = new ThinkingStreamSplitter(
      callbacks.onToken,
      callbacks.onReasoningToken ?? (() => {}),
    );

    const startTime = Date.now();
    await this.modelRouter.streamCompletion(
      this.config.baseModel,
      systemPrompt,
      [...this.conversationHistory],
      {
        onToken: (token) => splitter.push(token),
        onComplete: async (response) => {
          splitter.flush();
          const durationMs = Date.now() - startTime;
          this.addAssistantMessage(response.content);

          await this.telemetryService.log({
            type: 'response_received',
            agentId: this.config.id,
            sessionId,
            timestamp: new Date().toISOString(),
            model: response.model,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            totalTokens: response.inputTokens + response.outputTokens,
            durationMs,
          });

          callbacks.onComplete(response);
        },
        onError: callbacks.onError,
      },
    );
  }

  injectError(errorFeedback: string): void {
    this.conversationHistory.push({
      role: 'user',
      content: `[System] Tool execution failed:\n${errorFeedback}\nPlease analyze and retry.`,
    });
    logger.info('Error injected into agent context', { agentId: this.config.id });
  }

  injectSuccess(stdout: string): void {
    this.addUserMessage(`[System] Tool executed successfully:\n${stdout}\nContinue with your task.`);
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  parseLastToolRequest(): { tool: string; args: Record<string, any> } | null {
    const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') return null;
    const content = lastMessage.content;
    // Look for TOOL_REQUEST: <tool_name> <JSON args>
    const match = content.match(/TOOL_REQUEST:\s*(\w+)\s*({.*})/s);
    if (!match) return null;
    try {
      const args = JSON.parse(match[2]);
      return { tool: match[1], args };
    } catch (e) {
      logger.warn('Failed to parse tool request JSON', { content: match[2], error: e });
      return null;
    }
  }

  async executeTool(toolRequest: { tool: string; args: Record<string, any> }): Promise<ToolResult> {
    if (!this.config.assignedTools.includes(toolRequest.tool as AgentTool)) {
      throw new AppError(
        `Tool "${toolRequest.tool}" is not assigned to agent "${this.config.name}" (id: ${this.config.id})`,
        ErrorCategory.VALIDATION,
        false,
        `This agent isn't permitted to use "${toolRequest.tool}".`,
      );
    }
    // Build the dispatch object based on the tool name
    const dispatch: ToolDispatch = this.buildDispatch(toolRequest);
    const { result } = await this.toolExecutor.execute(dispatch, this.config.id, 'task', 1);
    return result;
  }

  // For parsed request - CHANGE AS REQUIRED
  private buildDispatch(req: { tool: string; args: Record<string, any> }): ToolDispatch {
    // Map tool names to dispatch types
    switch (req.tool) {
      case 'read_file':
        return { tool: 'read_file', path: req.args.path };
      case 'write_rtl':
        return { tool: 'write_rtl', path: req.args.path, content: req.args.content };
      case 'list_files':
        return { tool: 'list_files', path: req.args.path };
      case 'run_verilator':
        return { tool: 'run_verilator', args: req.args.args || [] };
      case 'run_validation':
        return { tool: 'run_validation', args: req.args.args || [] };
      case 'run_openroad':
        return { tool: 'run_openroad', args: req.args.args || [] };
      case 'run_opensta':
        return { tool: 'run_opensta', args: req.args.args || [] };
      case 'run_python':
        return { tool: 'run_python', script: req.args.script, args: req.args.args };
      case 'run_riscv_as':
        return { tool: 'run_riscv_as', file: req.args.file, args: req.args.args };
      case 'query_rag':
        return { tool: 'query_rag', query: req.args.query, topK: req.args.topK };
      default:
        throw new Error(`Unsupported tool: ${req.tool}`);
    }
  }
}