import { create } from 'zustand';
import type { SessionMetrics, Gate, ExperimentalCondition } from '@agent_design/shared/types';

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
  setSessionId: (id: string) => void;
  setTelemetrySessionId: (id: string) => void;
  setCondition: (c: ExperimentalCondition) => void;
  setCurrentGate: (g: Gate) => void;
  updateMetrics: (m: SessionMetrics) => void;
  updateEDAStatus: (tool: keyof EDAStatus, status: EDAStatus[keyof EDAStatus]) => void;
  updateAgentTokens: (agentId: string, input: number, output: number) => void;
  reset: () => void;
}

export const useTelemetryStore = create<TelemetryStore>()((set) => ({
  sessionId: null,
  condition: "agent-assisted",
  currentGate: 'G1',
  metrics: null,
  edaStatus: { verilator: 'idle', openroad: 'idle', opensta: 'idle' },
  tokensByAgent: {},

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
  reset: () =>
    set({
      sessionId: null,
      condition: "agent-assisted",
      currentGate: 'G1',
      metrics: null,
      edaStatus: { verilator: 'idle', openroad: 'idle', opensta: 'idle' },
      tokensByAgent: {},
    }),
}));