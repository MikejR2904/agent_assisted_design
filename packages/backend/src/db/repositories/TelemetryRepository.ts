import { Db } from '../Database';
import type { TelemetryEvent, SessionMetrics, PPAMetrics } from '@agent_design/shared/types';

interface EventRow {
  id: number;
  session_id: string;
  agent_id: string | null;
  type: string;
  task_id: string | null;
  timestamp: string;
  payload: string;
}

function rowToEvent(row: EventRow): TelemetryEvent {
  return JSON.parse(row.payload) as TelemetryEvent;
}

export interface ExperimentMetrics {
  sessionId: string;
  humanCorrectionRate: number | null; // (modified + denied) / total human_action events
  firstPassAcceptanceRate: number | null; // completed tasks with exactly 1 attempt / total completed tasks
  ppaDrift: Array<{
    from: PPAMetrics;
    to: PPAMetrics;
    fromTimestamp: string;
    toTimestamp: string;
    deltaArea: number;
    deltaPower: number;
    deltaFrequency: number;
    deltaWns: number;
  }>;
}

export class TelemetryRepository {
  private get db() {
    return Db.getInstance();
  }

  insert(event: TelemetryEvent): void {
    const anyEvent = event as any;
    this.db.prepare(`
      INSERT INTO telemetry_events (session_id, agent_id, type, task_id, timestamp, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      anyEvent.sessionId,
      anyEvent.agentId ?? null,
      event.type,
      anyEvent.taskId ?? null,
      event.timestamp,
      JSON.stringify(event),
    );
  }

  private eventsForSession(sessionId: string): TelemetryEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM telemetry_events WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId) as EventRow[];
    return rows.map(rowToEvent);
  }

  // Public alias — used by telemetry.routes.ts's log-download endpoint, which used to stream a
  // JSONL file straight off disk. It now reconstructs the same JSONL shape from these rows.
  getEventsForSession(sessionId: string): TelemetryEvent[] {
    return this.eventsForSession(sessionId);
  }

  // One "log file" per session that has any events, named the same way the old JSONL files were
  // (`${condition}_${sessionId}.jsonl`) so the existing download-by-filename endpoint and the
  // (currently unused) list-of-logs endpoint keep an identical contract with the frontend.
  listSessionLogFiles(): string[] {
    const rows = this.db
      .prepare(`
        SELECT DISTINCT session_id,
          (SELECT json_extract(payload, '$.condition') FROM telemetry_events e2
           WHERE e2.session_id = e1.session_id AND e2.type = 'session_start' LIMIT 1) AS condition
        FROM telemetry_events e1
      `)
      .all() as { session_id: string; condition: string | null }[];
    return rows
      .filter((r) => r.condition)
      .map((r) => `${r.condition}_${r.session_id}.jsonl`);
  }

  // Recomputes the same aggregate shape the old in-memory Map<sessionId, SessionMetrics> tracked
  // incrementally — now derived fresh from durable storage on every call, so a server restart
  // never loses it.
  getSessionMetrics(sessionId: string): SessionMetrics | null {
    const events = this.eventsForSession(sessionId);
    const startEvent = events.find((e) => e.type === 'session_start');
    if (!startEvent) return null;

    const metrics: SessionMetrics = {
      sessionId,
      condition: (startEvent as any).condition,
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

    for (const event of events) {
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
        case 'session_end':
          metrics.durationMs = event.durationMs;
          break;
      }
    }

    return metrics;
  }

  // HCR/FPAR/PPA-drift are computed in TS from the raw event rows rather than a single compound
  // SQL expression — these are exactly the kind of formula a thesis's exact definitions might
  // need tweaking, and a `reduce` is far easier to adjust correctly than nested SQL CASE/window
  // expressions. Session event counts are small (tens-hundreds), so this is not a perf concern.
  getExperimentMetrics(sessionId: string): ExperimentMetrics {
    const events = this.eventsForSession(sessionId);

    const humanActions = events.filter((e) => e.type === 'human_action') as Extract<TelemetryEvent, { type: 'human_action' }>[];
    const humanCorrectionRate = humanActions.length
      ? humanActions.filter((e) => e.action === 'modified' || e.action === 'denied').length / humanActions.length
      : null;

    // A task "completes" on a response_received event carrying an `attempts` count (Orchestrator
    // logs this once per finished task, distinct from the per-turn response_received without it)
    // or a max_attempts_exceeded event (also a completion, always > 1 attempt).
    const completions = events.filter(
      (e) => (e.type === 'response_received' && e.attempts !== undefined) || e.type === 'max_attempts_exceeded',
    ) as Array<Extract<TelemetryEvent, { type: 'response_received' | 'max_attempts_exceeded' }>>;
    const firstPassAcceptanceRate = completions.length
      ? completions.filter((e) => e.attempts === 1).length / completions.length
      : null;

    const ppaEvents = events.filter((e) => e.type === 'ppa_metrics') as Extract<TelemetryEvent, { type: 'ppa_metrics' }>[];
    const ppaDrift: ExperimentMetrics['ppaDrift'] = [];
    for (let i = 1; i < ppaEvents.length; i++) {
      const prev = ppaEvents[i - 1];
      const curr = ppaEvents[i];
      ppaDrift.push({
        from: prev.metrics,
        to: curr.metrics,
        fromTimestamp: prev.timestamp,
        toTimestamp: curr.timestamp,
        deltaArea: curr.metrics.area - prev.metrics.area,
        deltaPower: curr.metrics.power - prev.metrics.power,
        deltaFrequency: curr.metrics.frequency - prev.metrics.frequency,
        deltaWns: curr.metrics.wns - prev.metrics.wns,
      });
    }

    return { sessionId, humanCorrectionRate, firstPassAcceptanceRate, ppaDrift };
  }
}
