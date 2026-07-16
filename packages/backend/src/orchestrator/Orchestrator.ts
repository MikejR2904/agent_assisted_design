import { v4 as uuidv4 } from 'uuid';
import type { Server as SocketServer } from 'socket.io';
import type { Gate, ExperimentalCondition, AgentConfig } from '@agent_design/shared/types';
import { WS_EVENTS } from '@agent_design/shared/constants';
import { ReflexionLoop } from './ReflexionLoop';
import { ModelRouter } from '../models/ModelRouter';
import type { LLMMessage } from '../models/ModelRouter';
import { Agent } from '../agent/Agent';
import { AgentFactory } from '../agent/AgentFactory';
import { ConfigService } from '../services/ConfigService';
import { TelemetryService } from '../services/TelemetryService';
import { SessionService } from '../services/SessionService';
import { ProjectService } from '../services/ProjectService';
import { GateService } from '../services/GateService';
import { extractPPAFromOpenROAD } from '../utils/ppaExtractor';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs/promises';

const PPA_TOOLS = new Set(['run_openroad', 'run_opensta']);

// Token Thresholds
const TOKEN_SUMMARIZE_THRESHOLD = 120_000; // ~95% of 128k

export interface OrchestratorState {
  sessionId: string;
  condition: ExperimentalCondition;
  currentGate: Gate;
  agents: Map<string, Agent>;
  workspaceDir: string;
  startedAt: Date;
  projectId?: string;
}

export class Orchestrator {
  private sessions = new Map<string, OrchestratorState>();
  private reflexionLoop = new ReflexionLoop();
  private gateService = new GateService();
  private modelRouter: ModelRouter;
  private agentFactory: AgentFactory;
  private cancellationTokens = new Map<string, { cancelled: boolean }>();

  private pendingApprovals = new Map<
    string,
    {
      resolve: (approved: boolean, modified?: { command: string; args: string[] }) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor(
    private readonly io: SocketServer,
    private readonly configService: ConfigService,
    private readonly telemetryService: TelemetryService,
    private readonly sessionService: SessionService,
    private readonly projectService: ProjectService,
    private readonly workspaceRoot: string,
    private readonly baselineDir: string,
  ) {
    this.modelRouter = ModelRouter.getInstance();
    this.agentFactory = new AgentFactory(this.modelRouter, this.configService, this.telemetryService);
  }

  async initSession(condition: ExperimentalCondition, agentConfigs: AgentConfig[], projectId?: string): Promise<string> {
    const sessionId = uuidv4();
    const conditionDir = await this.ensureWorkspace(condition);
    // Create session
    await this.sessionService.createSession(
      sessionId,
      condition,
      agentConfigs.map(a => a.id),
      `New chat (${condition})`,
      projectId,
    );

    // Build agents with scoped workspaces
    const agents = new Map<string, Agent>();
    for (const cfg of agentConfigs) {
      const agent = this.agentFactory.build(cfg, conditionDir);
      agents.set(agent.id, agent);
    }

    const state: OrchestratorState = {
      sessionId,
      condition,
      currentGate: 'G1',
      agents,
      workspaceDir: conditionDir,
      startedAt: new Date(),
      projectId,
    };
    this.sessions.set(sessionId, state);
    this.gateService.initialize(sessionId);

    // Log this session start
    await this.telemetryService.startSession(sessionId, condition, agentConfigs.map((a) => a.id));

    this.io.emit(WS_EVENTS.GATE_CHANGED, { gate: 'G1', sessionId });
    this.io.emit(WS_EVENTS.SESSION_RESET, { sessionId, condition });

    return sessionId;
  }

  private async loadAgentsFromConfig(): Promise<AgentConfig[]> {
    return this.configService.getAgents();
  }

  private async getAgent(agentId: string, workspaceDir: string): Promise<Agent> {
    const allAgents = await this.loadAgentsFromConfig();
    const config = allAgents.find(a => a.id === agentId);
    if (!config) {
      throw new Error(`Agent ${agentId} not found in configuration`);
    }
    return this.agentFactory.build(config, workspaceDir);
  }

  private async ensureWorkspace(condition: string): Promise<string> {
    const conditionDir = path.join(this.workspaceRoot, `condition_${condition}`);
    try {
      await fs.access(conditionDir);
    } catch {
      // Create parent directory
      await fs.mkdir(path.dirname(conditionDir), { recursive: true });
      // If baseline exists, copy it; otherwise create empty directory
      try {
        await fs.access(this.baselineDir);
        await fs.cp(this.baselineDir, conditionDir, { recursive: true });
      } catch {
        await fs.mkdir(conditionDir, { recursive: true });
      }
      logger.info('Workspace created', { condition, dir: conditionDir });
    }
    return conditionDir;
  }

  private async getOrCreateState(
    sessionId: string,
    condition: ExperimentalCondition,
    agentIds: string[],
    workspaceDir: string,
    projectId?: string,
  ): Promise<OrchestratorState> {
    let state = this.sessions.get(sessionId);
    if (state) return state;
    // Build agents
    const agents = new Map<string, Agent>();
    for (const id of agentIds) {
      const agent = await this.getAgent(id, workspaceDir);
      agents.set(agent.id, agent);
    }
    state = {
      sessionId,
      condition,
      currentGate: 'G1',
      agents,
      workspaceDir,
      startedAt: new Date(),
      projectId,
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  async processMessage(content: string, sessionId: string, agentId?: string, projectId?: string): Promise<void> {
    const session = await this.sessionService.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    // If projectId provided, link session to project
    if (projectId && !session.projectId) {
      await this.sessionService.linkToProject(sessionId, projectId);
      await this.projectService.addSessionToProject(projectId, sessionId);
    }
    const effectiveProjectId = session.projectId || projectId;
    // Ensure workspace exists
    const workspaceDir = await this.ensureWorkspace(session.condition);
    // Get orchestrator state
    const state = await this.getOrCreateState(
      sessionId,
      session.condition,
      session.agentIds,
      workspaceDir,
      effectiveProjectId,
    );
    if (!this.gateService.getState(sessionId)) {
      this.gateService.initialize(sessionId);
    }

    // Determine which agent to use
    let agent: Agent;
    if (agentId) {
      agent = await this.getAgent(agentId, workspaceDir);
    } else {
      // Use the first agent from the session's agentIds list
      const firstAgentId = session.agentIds[0];
      if (!firstAgentId) {
        throw new Error('No agents available for this session');
      }
      agent = await this.getAgent(firstAgentId, workspaceDir);
    }
    // Store user message
    await this.sessionService.addMessage(sessionId, {
      role: 'user',
      content,
      agentId: agent.id,
      timestamp: new Date().toISOString(),
    });

    // Build system prompt with project memory
    let memoryContext = '';
    if (effectiveProjectId) {
      const summaries = await this.projectService.getSummariesForProject(effectiveProjectId);
      if (summaries.length > 0) {
        memoryContext = `
          ## Project Memory
          The following are summaries of prior conversations and learned knowledge for this project:
          ${summaries.map(s => `- ${s.summaryText}`).join('\n')}
          `;
      }
    }

    // Start reflexion task
    const taskId = this.reflexionLoop.createTask(agent.id, agent.maxRetries).taskId;
    let isComplete = false;
    let finalResponse = '';
    this.io.emit(WS_EVENTS.AGENT_STATUS, { agentId: agent.id, status: 'thinking', sessionId });

    const token = { cancelled: false };
    this.cancellationTokens.set(sessionId, token);

    while (!isComplete && !this.reflexionLoop.isExhausted(taskId) && !token.cancelled) {
      this.reflexionLoop.recordAttempt(taskId);
      // Get LLM response
      try {
        // We'll use a promise to wait for the stream to complete
        let responseContent = '';
        let responseModel = '';
        agent.setMemoryContext(memoryContext);
        await agent.streamResponse(
          content, // initial user message; subsequent loops will use injected system messages
          sessionId,
          {
            onToken: (token) => {
              this.io.emit(WS_EVENTS.STREAM_TOKEN, { token, agentId: agent.id, sessionId });
            },
            onReasoningToken: (token) => {
              this.io.emit(WS_EVENTS.REASONING_TOKEN, { token, agentId: agent.id, sessionId });
            },
            onComplete: async (response) => {
              responseContent = response.content;
              responseModel = response.model;
              // Store assistant message in SessionService
              await this.sessionService.addMessage(sessionId, {
                role: 'assistant',
                content: responseContent,
                agentId: agent.id,
                timestamp: new Date().toISOString(),
              });
              // Log telemetry
              await this.telemetryService.log({
                type: 'response_received',
                agentId: agent.id,
                sessionId,
                timestamp: new Date().toISOString(),
                model: responseModel,
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
                totalTokens: response.inputTokens + response.outputTokens,
                durationMs: 0,
              });
              this.io.emit(WS_EVENTS.STREAM_DONE, {
                agentId: agent.id,
                sessionId,
                content: responseContent,
              });
              isComplete = true;
            },
            onError: (err) => {
              logger.error('Stream error', { err: err.message, agentId: agent.id });
              this.reflexionLoop.recordError(taskId, err.message);
            },
          },
          state.currentGate,
          state.condition,
        );

        if (isComplete) { // The agent might have produced a final answer without tool request.
          break;
        }

        logger.info("DEBUG: streamResponse completed successfully. Parsing tool request next...");
        // After streamResponse completes, we have the assistant's message in history.
        // Parse tool request from the last assistant message.
        const toolReq = agent.parseLastToolRequest();
        if (!toolReq) { // No tool request -> task complete
          isComplete = true;
          finalResponse = responseContent;
          await this.telemetryService.log({
            type: 'response_received',
            sessionId,
            agentId: agent.id,
            taskId,
            timestamp: new Date().toISOString(),
            attempts: this.reflexionLoop.getTask(taskId).attempts,
          });
          break;
        }

        logger.info("DEBUG: parseLastToolRequest completed successfully.", { toolReq });

        // Request approval via WebSocket
        const approvalId = uuidv4();
        const approvalData = {
          id: approvalId,
          sessionId,
          agentName: agent.name,
          command: toolReq.tool,
          args: toolReq.args,
          context: `Tool request from ${agent.name}`,
          attempt: this.reflexionLoop.getTask(taskId).attempts,
          maxAttempts: agent.maxRetries,
        };
        // Emit approval request to frontend
        this.io.emit(WS_EVENTS.APPROVAL_REQUEST, approvalData);
        // Wait for user decision (Promise that resolves when user responds)
        const { approved, modified } = await this.waitForApproval(approvalId);
        if (!approved) {
          // User denied -> inject a message and loop (without incrementing attempts)
          agent.addUserMessage(
            `[System] User denied tool request (${toolReq.tool}). Please provide an alternative solution.`,
          );
          continue; // restart loop without incrementing attempts
        }
        // User approved (possibly with modifications)
        const finalToolReq = modified
          ? { tool: modified.command, args: modified.args }
          : toolReq;

        // Gate check: physical-design tools (run_openroad/run_opensta) require G3 approval.
        const gateCheck = this.gateService.canExecuteTool(sessionId, finalToolReq.tool);
        if (!gateCheck.allowed) {
          this.reflexionLoop.recordError(taskId, gateCheck.reason!);
          agent.injectError(gateCheck.reason!);
          continue;
        }

        // Execute the tool
        try {
          const result = await agent.executeTool(finalToolReq);
          // Log tool execution
          await this.telemetryService.log({
            type: 'tool_result',
            sessionId,
            agentId: agent.id,
            taskId,
            tool: finalToolReq.tool,
            success: result.success,
            exitCode: result.exitCode,
            timestamp: new Date().toISOString(),
            durationMs: result.durationMs,
          });
          if (result.success) {
            // Tool succeeded: inject success and continue (or exit if task is done)
            agent.injectSuccess(result.stdout);
            // The task may be complete; we let the loop continue to let the agent finalize.
            // However, if the agent's response indicates completion, it will exit on next iteration.
            // We don't set isComplete here; we let the agent decide.

            if (PPA_TOOLS.has(finalToolReq.tool)) {
              const ppa = extractPPAFromOpenROAD(`${result.stdout}\n${result.stderr}`);
              if (ppa) {
                await this.telemetryService.log({
                  type: 'ppa_metrics',
                  sessionId,
                  agentId: agent.id,
                  taskId,
                  tool: finalToolReq.tool,
                  timestamp: new Date().toISOString(),
                  metrics: ppa,
                });
                agent.setPPAMetrics(ppa);
                this.io.emit(WS_EVENTS.PPA_METRICS, { sessionId, agentId: agent.id, tool: finalToolReq.tool, metrics: ppa });
              }
            }
          } else {
            // Tool failed: record error, increment attempts, inject error, and loop
            const errorMsg = result.stderr || `Tool ${finalToolReq.tool} failed with exit code ${result.exitCode}`;
            this.reflexionLoop.recordError(taskId, errorMsg);
            agent.injectError(errorMsg);
            // If max attempts reached, we break out after the loop condition check
          }
        } catch (execError) {
          const errMsg = (execError as Error).message;
          this.reflexionLoop.recordError(taskId, errMsg);
          agent.injectError(errMsg);
        }

        // After tool execution, we loop again to get the agent's next response.
      } catch (loopError) {
        const errMsg = (loopError as Error).message;
        this.reflexionLoop.recordError(taskId, errMsg);
        agent.injectError(errMsg);
        // continue loop; if max attempts exceeded, we'll exit.
      }
      // Check if the task is cancelled
      if (token.cancelled) {
        logger.info('Task cancelled', { sessionId });
        break;
      }
    }

    // Handle max attempts exceeded
    if (this.reflexionLoop.isExhausted(taskId) && !isComplete) {
      const task = this.reflexionLoop.getTask(taskId);
      finalResponse = `❌ MAX_ATTEMPTS_EXCEEDED after ${task.attempts} attempts. Last error: ${task.errorHistory[task.errorHistory.length - 1]}`;
      await this.telemetryService.log({
        type: 'max_attempts_exceeded',
        sessionId,
        agentId: agent.id,
        taskId,
        timestamp: new Date().toISOString(),
        attempts: task.attempts,
        lastError: task.errorHistory[task.errorHistory.length - 1] ?? 'Unknown',
      });

      this.io.emit(WS_EVENTS.ERROR, {
        sessionId,
        message: finalResponse,
      });
    } else {
      // Successful completion
      this.io.emit(WS_EVENTS.TASK_COMPLETE, {
        sessionId,
        agentId: agent.id,
        result: finalResponse,
        attempts: this.reflexionLoop.getTask(taskId).attempts,
      });
    }

    // Summarize if token usage is high (project memory)
    if (effectiveProjectId && isComplete && !token.cancelled) {
      const messages = await this.sessionService.getMessages(sessionId);
      // Estimate tokens roughly (could use tiktoken)
      const totalTokens = messages.reduce((acc, m) => acc + m.content.length / 4, 0);
      if (totalTokens > TOKEN_SUMMARIZE_THRESHOLD) {
        // Generate summary using a cheap model
        const llmMessages: LLMMessage[] = messages.filter(m => m.role === "user" || m.role === "assistant").map(m => ({role: m.role as "user" | "assistant", content: m.content, }));
        const summary = await this.modelRouter.summarize(llmMessages);
        if (summary) {
          await this.projectService.addSummary({
            projectId: effectiveProjectId,
            agentId: agent.id,
            summaryText: summary,
            tokensUsed: Math.round(totalTokens * 0.1), // estimate
          });
          logger.info('Project summary saved', { projectId: effectiveProjectId });
        }
      }
    }

    // Update telemetry
    const metrics = this.telemetryService.getSessionMetrics(sessionId);
    this.io.emit(WS_EVENTS.TELEMETRY_UPDATE, { sessionId, metrics });

    this.io.emit(WS_EVENTS.AGENT_STATUS, { agentId: agent.id, status: 'idle', sessionId });
    this.reflexionLoop.cleanup(taskId);
  }

  private waitForApproval(approvalId: string): Promise<{ approved: boolean; modified?: { command: string; args: string[] } }> {
    return new Promise((resolve, reject) => {
      // Store the resolver in the pending map
      this.pendingApprovals.set(approvalId, {
        resolve: (approved, modified) => resolve({ approved, modified }),
        reject: (err) => reject(err),
      });

      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(approvalId);
        reject(new Error(`Approval request ${approvalId} timed out after 5 minutes`));
      }, 5 * 60 * 1000); // 5 min

      // Store timeout handle to clear later
      (this.pendingApprovals.get(approvalId) as any).timeout = timeout;
    });
  }

  async resolveApproval(
    requestId: string,
    approved: boolean,
    modified?: { command: string; args: string[] },
  ): Promise<void> {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      logger.warn('Approval request not found', { requestId });
      return;
    }
    // Clear the timeout
    clearTimeout((pending as any).timeout);
    // Resolve the promise
    pending.resolve(approved, modified);
    this.pendingApprovals.delete(requestId);
    logger.info('Approval resolved', { requestId, approved });
  }

  async setGate(gate: Gate, sessionId: string, triggeredBy: 'human' | 'agent' = 'human'): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const fromGate = state.currentGate;
    state.currentGate = gate;
    this.gateService.setGate(sessionId, gate);

    await this.telemetryService.log({
      type: 'gate_transition',
      sessionId,
      timestamp: new Date().toISOString(),
      fromGate,
      toGate: gate,
      triggeredBy,
    });

    this.io.emit(WS_EVENTS.GATE_CHANGED, { gate, fromGate, sessionId });
    logger.info('Gate advanced', { from: fromGate, to: gate, sessionId });
  }

  // Records a human approval for `gate` (distinct from setGate — advancing the *current* gate
  // doesn't imply it was reviewed/approved). Unblocks physical-design tools once G3 is approved.
  async approveGate(sessionId: string, gate: Gate, note?: string): Promise<void> {
    if (!this.gateService.getState(sessionId)) {
      this.gateService.initialize(sessionId);
    }
    this.gateService.approveGate(sessionId, gate, note);

    await this.telemetryService.log({
      type: 'gate_approval',
      sessionId,
      timestamp: new Date().toISOString(),
      gate,
      approved: true,
      note,
    });

    const state = this.gateService.getState(sessionId)!;
    this.io.emit(WS_EVENTS.GATE_APPROVAL_CHANGED, { sessionId, gate, approvals: state.approvals });
    logger.info('Gate approved', { sessionId, gate, note });
  }

  getState(sessionId: string): OrchestratorState | null {
    return this.sessions.get(sessionId) ?? null;
  }

  async cancelTask(sessionId: string): Promise<void> {
    const token = this.cancellationTokens.get(sessionId);
    if (token) {
      token.cancelled = true;
      this.cancellationTokens.delete(sessionId);
    }
  }
}