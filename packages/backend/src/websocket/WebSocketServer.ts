import { Server as HttpServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { WS_EVENTS } from '@agent_design/shared';
import type { Gate } from '@agent_design/shared/types';
import { Orchestrator } from '../orchestrator/Orchestrator';
import { logger } from '../utils/logger';

export function createWebSocketServer(httpServer: HttpServer, orchestrator: Orchestrator): SocketIO {
  const io = new SocketIO(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id });

    socket.on(WS_EVENTS.JOIN_SESSION, ({ sessionId }) => {
      const state = orchestrator.getState(sessionId);
      if (state) {
        socket.emit(WS_EVENTS.GATE_CHANGED, { gate: state.currentGate, sessionId });
      } else {
        socket.emit(WS_EVENTS.ERROR, { message: `No active session: ${sessionId}`, sessionId });
      }
    });

    socket.on(WS_EVENTS.SEND_MESSAGE, async ({ content, sessionId, agentId }) => {
      try {
        await orchestrator.processMessage(content, sessionId, agentId);
      } catch (err) {
        logger.error('Chat processing error', { err: (err as Error).message });
        socket.emit(WS_EVENTS.ERROR, { message: (err as Error).message, sessionId });
      }
    });

    socket.on(WS_EVENTS.APPROVE_TOOL, async ({ requestId, sessionId }) => {
      await orchestrator.resolveApproval(requestId, true);
    });

    socket.on(WS_EVENTS.DENY_TOOL, async ({ requestId, sessionId }) => {
      await orchestrator.resolveApproval(requestId, false);
    });

    socket.on(WS_EVENTS.MODIFY_TOOL, async ({ requestId, sessionId, command, args }) => {
      await orchestrator.resolveApproval(requestId, true, { command, args });
    });

    socket.on(WS_EVENTS.SET_GATE, async ({ gate, sessionId }: { gate: Gate; sessionId: string }) => {
      await orchestrator.setGate(gate, sessionId, 'human');
    });

    socket.on(WS_EVENTS.INIT_WORKSPACE, async ({ condition, sessionId, agents }) => {
      try {
        const newSessionId = await orchestrator.initSession(condition, agents);
        socket.emit(WS_EVENTS.SESSION_RESET, { sessionId: newSessionId, condition });
      } catch (err) {
        logger.error('Workspace init error', { err: (err as Error).message });
        socket.emit(WS_EVENTS.ERROR, { message: (err as Error).message });
      }
    });

    socket.on(WS_EVENTS.TASK_CANCEL, async ({ sessionId }) => {
      try {
        await orchestrator.cancelTask(sessionId);
        logger.info('Task cancellation requested', { sessionId });
      } catch (err) {
        logger.error('Task cancellation error', { err: (err as Error).message });
        socket.emit(WS_EVENTS.ERROR, { message: (err as Error).message, sessionId });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('Client disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
}