import fs from 'fs/promises';
import path from 'path';
import type { TelemetryEvent, SessionMetrics, ExperimentalCondition } from '@agent_design/shared/types';
import { logger } from '../utils/logger';

export class TelemetryService {
  private static instance: TelemetryService;
  private sessions = new Map<string, SessionMetrics>();
  private fileHandles = new Map<string, fs.FileHandle>();

  private constructor(private readonly telemetryRoot: string) {}

  static getInstance(telemetryRoot: string): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService(telemetryRoot);
    }
    return TelemetryService.instance;
  }

  async startSession(
    sessionId: string,
    condition: ExperimentalCondition,
    agentIds: string[],
  ): Promise<void> {
    const metrics: SessionMetrics = {
      sessionId,
      condition,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalAttempts: 0,
      humanApprovals: 0,
      humanDenials: 0,
      humanModifications: 0,
      toolExecutions: 0,
      toolFailures: 0,
      gatesCompleted: [],
      durationMs: 0,
    };
    this.sessions.set(sessionId, metrics);

    // Open JSONL file
    const logPath = path.join(
      this.telemetryRoot,
      'experiments',
      `${condition}_${sessionId}.jsonl`,
    );
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const handle = await fs.open(logPath, 'a');
    this.fileHandles.set(sessionId, handle);

    await this.log({
      type: 'session_start',
      sessionId,
      timestamp: new Date().toISOString(),
      condition,
      agentIds,
    });

    logger.info('Session started', { sessionId, condition });
  }

  async log(event: TelemetryEvent): Promise<void> {
    const { sessionId } = event as { sessionId: string };
    const handle = this.fileHandles.get(sessionId);
    if (handle) {
      await handle.write(JSON.stringify(event) + '\n');
    }

    // Update in-memory metrics
    const metrics = this.sessions.get(sessionId);
    if (!metrics) return;

    switch (event.type) {
      case 'response_received':
        metrics.totalInputTokens += event.inputTokens ?? 0;
        metrics.totalOutputTokens += event.outputTokens ?? 0;
        metrics.totalTokens += event.totalTokens ?? 0;
        break;
      case 'tool_request':
        metrics.totalAttempts++;
        metrics.toolExecutions++;
        break;
      case 'tool_result':
        if (!event.success) metrics.toolFailures++;
        break;
      case 'human_action':
        if (event.action === 'approved') metrics.humanApprovals++;
        else if (event.action === 'denied') metrics.humanDenials++;
        else if (event.action === 'modified') metrics.humanModifications++;
        break;
      case 'gate_transition':
        if (!metrics.gatesCompleted.includes(event.toGate)) {
          metrics.gatesCompleted.push(event.toGate);
        }
        break;
      case 'ppa_metrics':
        metrics.latestPPA = event.metrics;
        break;
    }
  }

  getSessionMetrics(sessionId: string): SessionMetrics | null {
    return this.sessions.get(sessionId) ?? null;
  }

  async closeSession(sessionId: string, durationMs: number): Promise<void> {
    const metrics = this.sessions.get(sessionId);
    if (!metrics) return;

    metrics.durationMs = durationMs;

    await this.log({
      type: 'session_end',
      sessionId,
      timestamp: new Date().toISOString(),
      totalTokens: metrics.totalTokens,
      totalAttempts: metrics.totalAttempts,
      gatesCompleted: metrics.gatesCompleted,
      durationMs,
    });

    const handle = this.fileHandles.get(sessionId);
    await handle?.close();
    this.fileHandles.delete(sessionId);
    logger.info('Session closed', { sessionId, durationMs });
  }
}