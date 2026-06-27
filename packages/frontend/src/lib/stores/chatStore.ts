import { create } from 'zustand';
import type { ToolRequest } from '@agent_design/shared/types';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool-result';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolRequest?: ToolRequest;
}

interface ChatStore {
  messages: ChatMessage[];
  pendingToolRequest: ToolRequest | null;
  isProcessing: boolean;
  apiKeyError: string | null;
  connectionError: string | null;
  addMessage: (msg: ChatMessage) => void;
  appendToLastMessage: (token: string) => void;
  finalizeLastMessage: () => void;
  setPendingToolRequest: (req: ToolRequest | null) => void;
  setProcessing: (v: boolean) => void;
  clearMessages: () => void;
  setApiKeyError: (msg: string | null) => void;
  setConnectionError: (msg: string | null) => void;
}

export const useChatStore = create<ChatStore>()((set) => ({
  messages: [],
  pendingToolRequest: null,
  isProcessing: false,
  apiKeyError: null,
  connectionError: null,

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  appendToLastMessage: (token) =>
    set((state) => {
      const msgs = [...state.messages];
      if (msgs.length === 0) return state;
      const last = msgs[msgs.length - 1];
      msgs[msgs.length - 1] = { ...last, content: last.content + token, isStreaming: true };
      return { messages: msgs };
    }),

  finalizeLastMessage: () =>
    set((state) => {
      const msgs = [...state.messages];
      if (msgs.length === 0) return state;
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], isStreaming: false };
      return { messages: msgs };
    }),

  setPendingToolRequest: (req) => set({ pendingToolRequest: req }),
  setProcessing: (v) => set({ isProcessing: v }),
  clearMessages: () => set({ messages: [], pendingToolRequest: null }),
  setApiKeyError: (msg) => set({ apiKeyError: msg }),
  setConnectionError: (msg) => set({ connectionError: msg }),
}));