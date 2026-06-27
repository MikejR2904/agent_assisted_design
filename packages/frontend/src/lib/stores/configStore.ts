import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExperimentalCondition } from '@agent_design/shared/types';

export interface WorkspaceConfig {
  condition: ExperimentalCondition;
  sessionId: string;
  initializedAt: string;
}

interface ConfigStore {
  activeCondition: ExperimentalCondition;
  sessionId: string | null;
  isInitialized: boolean;
  isInitializing: boolean;
  lastResetAt: string | null;
  architectureToml: string | null;
  gatesJson: string | null;

  setCondition: (c: ExperimentalCondition) => void;
  setSessionId: (id: string) => void;
  setInitialized: (v: boolean) => void;
  setInitializing: (v: boolean) => void;
  setLastResetAt: (ts: string) => void;
  setArchitectureToml: (content: string) => void;
  setGatesJson: (content: string) => void;
  reset: () => void;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set) => ({
      activeCondition: 'agent-assisted',
      sessionId: null,
      isInitialized: false,
      isInitializing: false,
      lastResetAt: null,
      architectureToml: null,
      gatesJson: null,

      setCondition: (c) => set({ activeCondition: c }),
      setSessionId: (id) => set({ sessionId: id }),
      setInitialized: (v) => set({ isInitialized: v }),
      setInitializing: (v) => set({ isInitializing: v }),
      setLastResetAt: (ts) => set({ lastResetAt: ts }),
      setArchitectureToml: (content) => set({ architectureToml: content }),
      setGatesJson: (content) => set({ gatesJson: content }),
      reset: () =>
        set({
          sessionId: null,
          isInitialized: false,
          isInitializing: false,
          lastResetAt: null,
        }),
    }),
    { name: 'config-store' },
  ),
);
