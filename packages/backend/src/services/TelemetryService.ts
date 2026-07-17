import type { TelemetryEvent, SessionMetrics, ExperimentalCondition } from '@agent_design/shared/types';
import { TelemetryRepository, type ExperimentMetrics } from '../db/repositories/TelemetryRepository';
import { logger } from '../utils/logger';

// Backed by SQLite (via TelemetryRepository) instead of an in-memory Map + append-only JSONL
// file per session. Public method signatures are unchanged. The in-memory
// Map<sessionId, SessionMetrics> and open-file-handle Map from the old version are gone —
// getSessionMetrics() now recomputes from durable storage every call, so a server restart no
// longer loses metrics (the "state loss on restart" risk this migration set out to fix).
export class TelemetryService {
  private static instance: TelemetryService;
  private repo = new TelemetryRepository();

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
    this.repo.insert(event);
  }

  getSessionMetrics(sessionId: string): SessionMetrics | null {
    return this.repo.getSessionMetrics(sessionId);
  }

  // New: thesis metrics (HCR, FPAR, PPA drift) computed from the event log.
  getExperimentMetrics(sessionId: string): ExperimentMetrics {
    return this.repo.getExperimentMetrics(sessionId);
  }

  // Used by telemetry.routes.ts's log-download endpoints, which used to read JSONL files
  // directly off disk — now reconstructed from the DB (see TelemetryRepository).
  getEventsForSession(sessionId: string): TelemetryEvent[] {
    return this.repo.getEventsForSession(sessionId);
  }

  listSessionLogFiles(): string[] {
    return this.repo.listSessionLogFiles();
  }

  async closeSession(sessionId: string, durationMs: number): Promise<void> {
    const metrics = this.repo.getSessionMetrics(sessionId);
    if (!metrics) return;

    await this.log({
      type: 'session_end',
      sessionId,
      timestamp: new Date().toISOString(),
      totalTokens: metrics.totalTokens,
      totalAttempts: metrics.totalAttempts,
      gatesCompleted: metrics.gatesCompleted,
      durationMs,
    });

    logger.info('Session closed', { sessionId, durationMs });
  }
}
