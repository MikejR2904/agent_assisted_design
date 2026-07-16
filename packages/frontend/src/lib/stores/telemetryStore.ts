import { create } from 'zustand';
import type { SessionMetrics, Gate, ExperimentalCondition, PPAMetrics } from '@agent_design/shared/types';

const PPA_HISTORY_LIMIT = 20;

interface EDAStatus {
  verilator: 'ok' | 'running' | 'error' | 'idle';
  openroad: 'ok' | 'running' | 'error' | 'idle';
  opensta: 'ok' | 'running' | 'error' | 'idle';
}

interface TelemetryStore {
  sessionId: string | null;
  condition: ExperimentalCondition | null;
  currentGate: Gate;
  metrics: SessionMetrics | null;
  edaStatus: EDAStatus;
  tokensByAgent: Record<string, { input: number; output: number }>;
  latestPPA: PPAMetrics | null;
  ppaHistory: PPAMetrics[];
  setSessionId: (id: string) => void;
  setTelemetrySessionId: (id: string) => void;
  setCondition: (c: ExperimentalCondition) => void;
  setCurrentGate: (g: Gate) => void;
  updateMetrics: (m: SessionMetrics) => void;
  updateEDAStatus: (tool: keyof EDAStatus, status: EDAStatus[keyof EDAStatus]) => void;
  updateAgentTokens: (agentId: string, input: number, output: number) => void;
  setPPAMetrics: (m: PPAMetrics) => void;
  reset: () => void;
}

export const useTelemetryStore = create<TelemetryStore>()((set) => ({
  sessionId: null,
  condition: "agent-assisted",
  currentGate: 'G1',
  metrics: null,
  edaStatus: { verilator: 'idle', openroad: 'idle', opensta: 'idle' },
  tokensByAgent: {},
  latestPPA: null,
  ppaHistory: [],

  setSessionId: (id) => set({ sessionId: id }),
  setCondition: (c) => set({ condition: c }),
  setCurrentGate: (g) => set({ currentGate: g }),
  setTelemetrySessionId: (id: string) => set({ sessionId: id }),
  updateMetrics: (m) => set({ metrics: m }),
  updateEDAStatus: (tool, status) =>
    set((state) => ({ edaStatus: { ...state.edaStatus, [tool]: status } })),
  updateAgentTokens: (agentId, input, output) =>
    set((state) => ({
      tokensByAgent: {
        ...state.tokensByAgent,
        [agentId]: {
          input: (state.tokensByAgent[agentId]?.input ?? 0) + input,
          output: (state.tokensByAgent[agentId]?.output ?? 0) + output,
        },
      },
    })),
  setPPAMetrics: (m) =>
    set((state) => ({
      latestPPA: m,
      ppaHistory: [m, ...state.ppaHistory].slice(0, PPA_HISTORY_LIMIT),
    })),
  reset: () =>
    set({
      sessionId: null,
      condition: "agent-assisted",
      currentGate: 'G1',
      metrics: null,
      edaStatus: { verilator: 'idle', openroad: 'idle', opensta: 'idle' },
      tokensByAgent: {},
      latestPPA: null,
      ppaHistory: [],
    }),
}));