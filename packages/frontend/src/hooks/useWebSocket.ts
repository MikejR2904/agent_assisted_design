'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { WS_EVENTS } from '@agent_design/shared/constants';
import type { Gate, SessionMetrics, ToolRequest, PPAMetrics } from '@agent_design/shared/types';
import type { GateApproval } from '../lib/stores/sessionStore';
import { useChatStore } from '../lib/stores/chatStore';
import { useSessionStore, ChatSession } from '../lib/stores/sessionStore';
import { useTelemetryStore } from '../lib/stores/telemetryStore';
import { useAgentStore } from '../lib/stores/agentStore';
import { useProjectStore } from '@/lib/stores/projectStore';
import { v4 as uuidv4 } from 'uuid';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

// API key error patterns we detect and surface with clear guidance
const API_KEY_ERROR_PATTERNS = [
  /api key/i,
  /authentication/i,
  /no models can be used/i,
  /check your api key/i,
  /invalid.*key/i,
  /unauthorized/i,
  /401/,
];

function isApiKeyError(message: string): boolean {
  return API_KEY_ERROR_PATTERNS.some((p) => p.test(message));
}

function buildApiKeyGuidance(raw: string): string {
  return (
    'API key error — one or more configured models are unavailable.\n\n' +
    'To fix:\n' +
    '1. Open Agent Registry (top-right) → Edit the agent.\n' +
    '2. Check the API Key field. Free-tier models (Groq, Gemini Flash, Ollama) don\'t need a key.\n' +
    '3. Or switch the agent\'s Base Model to a free-tier option.\n\n' +
    `Original error: ${raw}`
  );
}

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const { finalizeLastMessage, setPendingToolRequest, setProcessing, setApiKeyError, setConnectionError } = useChatStore();
  const { setCurrentGate, updateMetrics, setSessionId, setPPAMetrics } = useTelemetryStore();
  const { setAgentStatus } = useAgentStore();
  const { activeSessionId, createSession, addMessage, updateLastMessage, getActiveSession, activeCondition, setGateApproval } = useSessionStore();
  const { getActiveProject } = useProjectStore();

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.info('WebSocket connected');
      setConnectionError(null);
      // Restore gate state for the active session
      const session = getActiveSession();
      if (session) {
        socket.emit(WS_EVENTS.SET_GATE, { gate: session.currentGate, sessionId: session.id });
      }
    });

    socket.on('connect_error', () => {
      setConnectionError('Cannot reach backend. Make sure the server is running on port 5000.');
    });

    socket.on('disconnect', () => {
      setConnectionError('Disconnected from backend. Reconnecting…');
    });

    socket.on(WS_EVENTS.STREAM_TOKEN, ({ token }: { token: string }) => {
      updateLastMessage((msg) => ({
        ...msg,
        content: msg.content + token,
        isStreaming: true,
      }));
    });

    socket.on(WS_EVENTS.REASONING_TOKEN, ({ token }: { token: string }) => {
      updateLastMessage((msg) => ({
        ...msg,
        reasoning: (msg.reasoning ?? '') + token,
        isStreaming: true,
      }));
    });

    socket.on(WS_EVENTS.STREAM_DONE, ({ agentId: _agentId, sessionId: _sessionId, content: _content }: {
      agentId: string;
      sessionId: string;
      content: string;
    }) => {
      finalizeLastMessage();
      setProcessing(false);
    });

    socket.on(WS_EVENTS.TOOL_REQUEST, (req: ToolRequest) => {
      setPendingToolRequest(req);
    });

    socket.on(WS_EVENTS.TOOL_RESULT, ({ requestId: _requestId, success: _success, exitCode, stdoutSummary }: {
      requestId: string;
      success: boolean;
      exitCode: number;
      stdoutSummary: string;
    }) => {
      setPendingToolRequest(null);
      addMessage({
        id: uuidv4(),
        role: 'tool-result',
        content: `Exit ${exitCode}: ${stdoutSummary}`,
        timestamp: new Date(),
      });
    });

    socket.on(WS_EVENTS.AGENT_STATUS, ({ agentId, status }: { agentId: string; status: string }) => {
      setAgentStatus(agentId, status as any);
    });

    socket.on(WS_EVENTS.GATE_CHANGED, ({ gate }: { gate: Gate }) => {
      setCurrentGate(gate);
    });

    socket.on(WS_EVENTS.GATE_APPROVAL_CHANGED, ({ gate, approvals }: { gate: Gate; approvals: Record<Gate, GateApproval> }) => {
      setGateApproval(gate, approvals[gate]);
    });

    socket.on(WS_EVENTS.TELEMETRY_UPDATE, ({ metrics }: { metrics: SessionMetrics }) => {
      updateMetrics(metrics);
    });

    socket.on(WS_EVENTS.PPA_METRICS, ({ metrics }: { metrics: PPAMetrics }) => {
      setPPAMetrics(metrics);
    });

    socket.on(WS_EVENTS.SESSION_RESET, ({ sessionId }: { sessionId: string }) => {
      setSessionId(sessionId);
    });

    socket.on(WS_EVENTS.ERROR, ({ message }: { message: string }) => {
      setProcessing(false);
      if (isApiKeyError(message)) {
        setApiKeyError(buildApiKeyGuidance(message));
      } else {
        addMessage({
          id: uuidv4(),
          role: 'system',
          content: `⚠️ ${message}`,
          timestamp: new Date(),
        });
      }
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
      socket.off(WS_EVENTS.STREAM_TOKEN);
      socket.off(WS_EVENTS.REASONING_TOKEN);
      socket.off(WS_EVENTS.STREAM_DONE);
      socket.off(WS_EVENTS.TOOL_REQUEST);
      socket.off(WS_EVENTS.TOOL_RESULT);
      socket.off(WS_EVENTS.GATE_CHANGED);
      socket.off(WS_EVENTS.GATE_APPROVAL_CHANGED);
      socket.off(WS_EVENTS.TELEMETRY_UPDATE);
      socket.off(WS_EVENTS.PPA_METRICS);
      socket.off(WS_EVENTS.ERROR);
    };
  }, [activeSessionId]);

  // Actions
  const ensureSessionOnBackend = useCallback(async (session: ChatSession): Promise<boolean> => {
    try {
      const agentIds = useAgentStore.getState().agents.map(a => a.id);
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: session.id,
          condition: session.condition,
          agentIds,
          title: session.title,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.warn('Session sync failed:', err);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Session sync error:', err);
      return false;
    }
  }, []);

  const sendMessage = useCallback(async (content: string, agentId?: string) => {
    if (!socketRef.current) return;
    let session = getActiveSession();
    if (!session) {
      const project = getActiveProject();
      session = createSession({ condition: activeCondition, projectId: project?.id, });
    }
    // Sync session to backend
    const synced = await ensureSessionOnBackend(session);
    if (!synced) {
      setConnectionError('Failed to sync session with backend. Please check server.');
      return;
    }
    const sessionId = session.id;
    addMessage({
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date(),
    });
    // Pre-add empty assistant message for streaming
    addMessage({
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    });
    setProcessing(true);
    setApiKeyError(null);

    socketRef.current.emit(WS_EVENTS.SEND_MESSAGE, { content, sessionId, agentId });
  }, [activeSessionId, activeCondition, getActiveSession, createSession, ensureSessionOnBackend]);

  const approveTool = useCallback((requestId: string) => {
    const session = getActiveSession();
    socketRef.current?.emit(WS_EVENTS.APPROVE_TOOL, { requestId, sessionId: session?.id });
  }, [activeSessionId]);

  const denyTool = useCallback((requestId: string) => {
    const session = getActiveSession();
    socketRef.current?.emit(WS_EVENTS.DENY_TOOL, { requestId, sessionId: session?.id });
  }, [activeSessionId]);

  const modifyTool = useCallback((requestId: string, command: string, args: string[]) => {
    const session = getActiveSession();
    socketRef.current?.emit(WS_EVENTS.MODIFY_TOOL, { requestId, sessionId: session?.id , command, args });
  }, [activeSessionId]);

  const advanceGate = useCallback((gate: Gate) => {
    const session = getActiveSession();
    if (!session) return;
    socketRef.current?.emit(WS_EVENTS.SET_GATE, { gate, sessionId: session.id });
  }, [activeSessionId]);

  const approveGate = useCallback((gate: Gate, note?: string) => {
    const session = getActiveSession();
    if (!session) return;
    socketRef.current?.emit(WS_EVENTS.APPROVE_GATE, { gate, sessionId: session.id, note });
  }, [activeSessionId]);

  const initWorkspace = useCallback((condition: string, sessionId: string, agents: unknown[]) => {
    socketRef.current?.emit(WS_EVENTS.INIT_WORKSPACE, { condition, sessionId, agents });
  }, []);

  const cancelTask = useCallback(() => {
    const session = getActiveSession();
    if (!session) return;
    socketRef.current?.emit(WS_EVENTS.TASK_CANCEL, { sessionId: session.id });
    setProcessing(false); // immediately reflect stopped state in UI
  }, [activeSessionId]);

  return { sendMessage, approveTool, denyTool, modifyTool, advanceGate, approveGate, initWorkspace, cancelTask };
}