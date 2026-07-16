import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { ExperimentalCondition, Gate, Attachment } from '@agent_design/shared/types';
import type { ChatMessage } from './chatStore';

export interface GateApproval {
  approved: boolean;
  timestamp?: string;
  note?: string;
}

export interface ChatSession {
  id: string;
  projectId: string | null;
  title: string; // Auto-derived from first user message
  condition: ExperimentalCondition;
  currentGate: Gate;
  messages: ChatMessage[];
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
  gatesCompleted: Gate[];
  gateApprovals: Record<Gate, GateApproval>;
}

interface SessionStore {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeCondition: ExperimentalCondition;

  // Session management
  createSession: (opts?: { condition?: ExperimentalCondition; projectId?: string}) => ChatSession;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setProjectId: (sessionId: string, projectId: string | null) => void;

  // Active session mutations
  setCondition: (c: ExperimentalCondition) => void;
  setGate: (gate: Gate) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (updater: (msg: ChatMessage) => ChatMessage) => void;
  updateTokens: (delta: number) => void;
  completeGate: (gate: Gate) => void;
  setGateApproval: (gate: Gate, approval: GateApproval) => void;

  // Attachment management
  addAttachment: (sessionId: string, attachment: Attachment) => void;
  removeAttachment: (sessionId: string, attachmentId: string) => void;

  // Derived helpers
  getActiveSession: () => ChatSession | null;
  getSessionsByProject: (projectId: string) => ChatSession[];
  getUnaffiliatedSessions: () => ChatSession[];
}

function generateTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim();
  if (trimmed.length <= 40) return trimmed;
  return trimmed.slice(0, 37) + '…';
}

function newSession(condition: ExperimentalCondition, projectId: string | null = null): ChatSession {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    projectId,
    title: 'New session',
    condition,
    currentGate: 'G1',
    messages: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    totalTokens: 0,
    gatesCompleted: [],
    gateApprovals: {
      G1: { approved: false },
      G2: { approved: false },
      G3: { approved: false },
      G4: { approved: false },
    },
  };
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      activeCondition: 'agent-assisted',

      createSession: ({ condition, projectId }: { condition?: ExperimentalCondition; projectId?: string } = {}) => {
        const c = condition ?? get().activeCondition;
        const session = newSession(c, projectId ?? null);
        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: session.id,
        }));
        return session;
      },

      switchSession: (id) => {
        set({ activeSessionId: id });
      },

      deleteSession: (id) => {
        set((state) => {
          const remaining = state.sessions.filter((s) => s.id !== id);
          const newActive =
            state.activeSessionId === id
              ? (remaining[0]?.id ?? null)
              : state.activeSessionId;
          return { sessions: remaining, activeSessionId: newActive };
        });
      },

      renameSession: (id, title) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title } : s,
          ),
        }));
      },

      setProjectId: (sessionId, projectId) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, projectId } : s,
          ),
        }));
      },

      setCondition: (c) => {
        set({ activeCondition: c });
        // Also update active session's condition
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === state.activeSessionId ? { ...s, condition: c } : s,
          ),
        }));
      },

      setGate: (gate) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === state.activeSessionId
              ? { ...s, currentGate: gate, updatedAt: new Date().toISOString() }
              : s,
          ),
        }));
      },

      addMessage: (msg) => {
        set((state) => {
          const updated = state.sessions.map((s) => {
            if (s.id !== state.activeSessionId) return s;
            // Auto-title from first user message
            const isFirstUser =
              msg.role === 'user' && s.messages.filter((m) => m.role === 'user').length === 0;
            return {
              ...s,
              messages: [...s.messages, msg],
              title: isFirstUser ? generateTitle(msg.content) : s.title,
              updatedAt: new Date().toISOString(),
            };
          });
          return { sessions: updated };
        });
      },

      updateLastMessage: (updater) => {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== state.activeSessionId) return s;
            if (s.messages.length === 0) return s;
            const msgs = [...s.messages];
            msgs[msgs.length - 1] = updater(msgs[msgs.length - 1]);
            return { ...s, messages: msgs, updatedAt: new Date().toISOString() };
          }),
        }));
      },

      updateTokens: (delta) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === state.activeSessionId
              ? { ...s, totalTokens: s.totalTokens + delta }
              : s,
          ),
        }));
      },

      completeGate: (gate) => {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== state.activeSessionId) return s;
            if (s.gatesCompleted.includes(gate)) return s;
            return { ...s, gatesCompleted: [...s.gatesCompleted, gate] };
          }),
        }));
      },

      setGateApproval: (gate, approval) => {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== state.activeSessionId) return s;
            // Sessions persisted before gateApprovals existed may not have the field yet.
            const existing = s.gateApprovals ?? { G1: { approved: false }, G2: { approved: false }, G3: { approved: false }, G4: { approved: false } };
            return { ...s, gateApprovals: { ...existing, [gate]: approval } };
          }),
        }));
      },

      addAttachment: (sessionId, attachment) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, attachments: [...s.attachments, attachment] }
              : s,
          ),
        }));
      },

      removeAttachment: (sessionId, attachmentId) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, attachments: s.attachments.filter((a) => a.id !== attachmentId) }
              : s,
          ),
        }));
      },

      getActiveSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId) ?? null;
      },

      getSessionsByProject: (projectId) => {
        return get().sessions.filter((s) => s.projectId === projectId);
      },

      getUnaffiliatedSessions: () => {
        return get().sessions.filter((s) => s.projectId === null);
      },
    }),
    {
      name: 'workbench-sessions',
      // Don't persist isStreaming flags
      partialize: (state) => ({
        ...state,
        sessions: state.sessions.map((s) => ({
          ...s,
          messages: s.messages.map(({ isStreaming: _s, ...m }) => m),
        })),
      }),
    },
  ),
);