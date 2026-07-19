import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentConfig, AgentStatus } from '@agent_design/shared/types';
import { agentsApi } from '../api/client';

// // Simple obfuscation for API keys stored in localStorage - TO DO
// // NOT cryptographic, just prevents casual clipboard snooping.
// function decodeKey(encoded: string): string {
//   try {
//     return atob(encoded);
//   } catch {
//     return encoded; // already plain (legacy)
//   }
// }

/** Returns the decoded (plain) API key for a given agent. */
export function getDecodedApiKey(agent: AgentConfig): string {
  if (!agent.apiKey) return '';
  try {
    return atob(agent.apiKey);
  } catch {
    // If decoding fails, return as-is (for legacy plaintext keys)
    return agent.apiKey;
  }
}

interface AgentStore {
  agents: AgentConfig[];
  isLoading: boolean;
  /** The agent currently selected for chat — shared between ChatArea and the status bar. */
  activeAgentId: string | null;

  setAgents: (agents: AgentConfig[]) => void;
  addAgent: (data: Omit<AgentConfig, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { apiKey?: string }) => Promise<void>;
  updateAgent: (id: string, updates: Partial<AgentConfig> & { apiKey?: string }) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  setAgentStatus: (id: string, status: AgentStatus) => void;
  setActiveAgentId: (id: string | null) => void;
  fetchAgents: () => Promise<void>;
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, ) => ({
      agents: [],
      isLoading: false,
      activeAgentId: null,
      setAgents: (agents) => set({ agents }),
      setActiveAgentId: (id) => set({ activeAgentId: id }),

      addAgent: async (data) => {
        // Encode API key before persisting
        const payload = { ...data };
        try {
          const created = await agentsApi.create(payload as Parameters<typeof agentsApi.create>[0]);
          set((state) => ({ agents: [...state.agents, created] }));
        } catch {
          // Offline fallback: create locally
          const now = new Date().toISOString();
          const local: AgentConfig = {
            ...(payload as Omit<AgentConfig, 'id' | 'status' | 'createdAt' | 'updatedAt'>),
            id: crypto.randomUUID(),
            status: 'idle',
            createdAt: now,
            updatedAt: now,
          };
          set((state) => ({ agents: [...state.agents, local] }));
        }
      },

      updateAgent: async (id, updates) => {
        const payload = { ...updates, };
        try {
          const updated = await agentsApi.update(id, payload);
          set((state) => ({
            agents: state.agents.map((a) => (a.id === id ? updated : a)),
          }));
        } catch {
          // Offline fallback
          set((state) => ({
            agents: state.agents.map((a) =>
              a.id === id ? { ...a, ...payload, updatedAt: new Date().toISOString() } : a,
            ),
          }));
        }
      },

      deleteAgent: async (id) => {
        try {
          await agentsApi.remove(id);
        } catch { /* allow offline delete */ }
        set((state) => ({ agents: state.agents.filter((a) => a.id !== id) }));
      },

      setAgentStatus: (id, status) =>
        set((state) => ({
          agents: state.agents.map((a) => (a.id === id ? { ...a, status } : a)),
        })),

      fetchAgents: async () => {
        set({ isLoading: true });
        try {
          const agents = await agentsApi.list();
          set({ agents });
        } catch {
          // Keep locally persisted agents on network failure
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    { name: 'agent-store' },
  ),
);