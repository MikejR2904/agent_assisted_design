import type { Gate } from '@agent_design/shared/types';
import { logger } from '../utils/logger';

/** Physical-design tools require G3 approval before they can run. */
export const PHYSICAL_TOOLS = new Set([
  'run_openroad',
  'run_opensta',
]);

interface GateApproval {
  approved: boolean;
  timestamp?: string;
  note?: string;
}

export interface GateState {
  currentGate: Gate;
  /** Approval record for each gate. G1–G4 all default to not approved. */
  approvals: Record<Gate, GateApproval>;
}

/**
 * GateService enforces the four-stage review gates (G1–G4) at the session level.
 *
 * Responsibilities:
 *  - Initialise per-session gate state.
 *  - Record human gate approvals (with optional notes).
 *  - Gate-guard physical EDA tools: run_openroad / run_opensta require G3 approval.
 *  - Provide gate state for telemetry and the frontend GateStepper.
 */
export class GateService {
  private states = new Map<string, GateState>();

  private defaultApprovals(): Record<Gate, GateApproval> {
    return {
      G1: { approved: false },
      G2: { approved: false },
      G3: { approved: false },
      G4: { approved: false },
    };
  }

  /** Call from Orchestrator.initSession to register a new session. */
  initialize(sessionId: string): void {
    if (this.states.has(sessionId)) {
      logger.warn('GateService.initialize called on existing session; resetting', { sessionId });
    }
    this.states.set(sessionId, {
      currentGate: 'G1',
      approvals: this.defaultApprovals(),
    });
    logger.info('GateService: session initialised', { sessionId, gate: 'G1' });
  }

  getState(sessionId: string): GateState | null {
    return this.states.get(sessionId) ?? null;
  }

  /** Advance the current gate. Does not imply approval of the new gate. */
  setGate(sessionId: string, gate: Gate): void {
    const state = this.states.get(sessionId);
    if (!state) {
      logger.warn('GateService.setGate: unknown session', { sessionId });
      return;
    }
    state.currentGate = gate;
  }

  /**
   * Record a human approval for a specific gate.
   * @param note Optional rationale recorded in telemetry.
   */
  approveGate(sessionId: string, gate: Gate, note?: string): void {
    const state = this.states.get(sessionId);
    if (!state) {
      logger.warn('GateService.approveGate: unknown session', { sessionId });
      return;
    }
    state.approvals[gate] = {
      approved: true,
      timestamp: new Date().toISOString(),
      note,
    };
    logger.info('GateService: gate approved', { sessionId, gate, note });
  }

  isGateApproved(sessionId: string, gate: Gate): boolean {
    return this.states.get(sessionId)?.approvals[gate]?.approved ?? false;
  }

  /**
   * Check whether a tool may proceed given the current gate approvals.
   *
   * Rule: physical EDA tools (run_openroad, run_opensta) require G3 to be
   * approved before they execute. All other tools are unrestricted.
   */
  canExecuteTool(sessionId: string, tool: string): { allowed: boolean; reason?: string } {
    if (!PHYSICAL_TOOLS.has(tool)) {
      return { allowed: true };
    }
    if (this.isGateApproved(sessionId, 'G3')) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Tool "${tool}" requires G3 (Physical Unit Sign-off) approval. ` +
              'Please approve G3 in the Gate panel before running physical EDA tools.',
    };
  }

  /**
   * Generic "can this session proceed to a particular gate" check.
   * A session can proceed to Gn only if all previous gates (G1…G(n-1)) are approved.
   */
  canProceedToGate(sessionId: string, gate: Gate): boolean {
    const order: Gate[] = ['G1', 'G2', 'G3', 'G4'];
    const targetIdx = order.indexOf(gate);
    if (targetIdx <= 0) return true; // G1 always accessible
    const state = this.states.get(sessionId);
    if (!state) return false;
    // Every gate before the target must be approved
    for (let i = 0; i < targetIdx; i++) {
      if (!state.approvals[order[i]].approved) return false;
    }
    return true;
  }

  /** Clean up when a session ends. */
  reset(sessionId: string): void {
    this.states.delete(sessionId);
  }
}