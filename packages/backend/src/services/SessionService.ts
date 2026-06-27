import { ExperimentalCondition } from '@agent_design/shared';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface Session {
  id: string;
  condition: ExperimentalCondition;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentIds: string[];
  projectId?: string;
  messages: Message[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool-result';
  content: string;
  agentId?: string;
  timestamp: string;
}

export class SessionService {
  private sessionsFile: string;
  private messagesDir: string;

  constructor(telemetryRoot: string) {
    this.sessionsFile = path.join(telemetryRoot, 'sessions.json');
    this.messagesDir = path.join(telemetryRoot, 'messages');
  }

  async readSessions(): Promise<Session[]> {
    try {
      const data = await fs.readFile(this.sessionsFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async writeSessions(sessions: Session[]): Promise<void> {
    await fs.mkdir(path.dirname(this.sessionsFile), { recursive: true });
    await fs.writeFile(this.sessionsFile, JSON.stringify(sessions, null, 2));
  }

  async getSession(id: string): Promise<Session | null> {
    const sessions = await this.readSessions();
    return sessions.find(s => s.id === id) || null;
  }

  async createSession(
    id: string,
    condition: ExperimentalCondition,
    agentIds: string[],
    title?: string,
    projectId?: string
  ): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      id,
      condition,
      title: title || `New chat (${condition})`,
      createdAt: now,
      updatedAt: now,
      agentIds,
      projectId,
      messages: [],
    };
    const sessions = await this.readSessions();
    // Avoid duplicates (if the session already exists, update it)
    const idx = sessions.findIndex(s => s.id === id);
    if (idx >= 0) {
      sessions[idx] = session;
    } else {
      sessions.unshift(session);
    }
    await this.writeSessions(sessions);
    await fs.mkdir(path.join(this.messagesDir, id), { recursive: true });
    return session;
  }

  async updateSessionTitle(id: string, title: string): Promise<void> {
    const sessions = await this.readSessions();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx === -1) return;
    sessions[idx].title = title;
    sessions[idx].updatedAt = new Date().toISOString();
    await this.writeSessions(sessions);
  }

  async addMessage(sessionId: string, message: Omit<Message, 'id'>): Promise<Message> {
    const msg: Message = { ...message, id: uuidv4() };
    // Append to session's messages array
    const sessions = await this.readSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) {
      throw new Error(`Session ${sessionId} not found`);
    }
    sessions[idx].messages.push(msg);
    sessions[idx].updatedAt = new Date().toISOString();
    // Also persist to a daily JSONL file for telemetry (optional)
    const filePath = path.join(this.messagesDir, sessionId, `${msg.timestamp.split('T')[0]}.jsonl`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(msg) + '\n');
    await this.writeSessions(sessions);
    return msg;
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const session = await this.getSession(sessionId);
    return session ? session.messages : [];
  }

  async deleteSession(id: string): Promise<void> {
    const sessions = await this.readSessions();
    const filtered = sessions.filter(s => s.id !== id);
    await this.writeSessions(filtered);
    await fs.rm(path.join(this.messagesDir, id), { recursive: true, force: true });
  }

  async linkToProject(sessionId: string, projectId: string): Promise<void> {
    const sessions = await this.readSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return;
    sessions[idx].projectId = projectId;
    await this.writeSessions(sessions);
  }
}