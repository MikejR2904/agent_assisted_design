import { ExperimentalCondition } from '@agent_design/shared';
import { v4 as uuidv4 } from 'uuid';
import { SessionRepository } from '../db/repositories/SessionRepository';

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

// Backed by SQLite (via SessionRepository) instead of whole-file JSON reads/writes. Public
// method signatures are unchanged from the file-based version, so route callers didn't need to
// change.
export class SessionService {
  private repo = new SessionRepository();

  // telemetryRoot is no longer used directly here (the repository resolves the DB path via
  // ConfigManager) — kept as a constructor param for call-site compatibility.
  constructor(_telemetryRoot: string) {}

  // ownerId set -> only that user's sessions plus pre-existing unowned ones. Unset (no
  // authenticated caller, or an admin) -> unfiltered, matching pre-auth behavior.
  async readSessions(ownerId?: string): Promise<Session[]> {
    return this.repo.findAll(ownerId ? { userId: ownerId } : undefined);
  }

  async getSession(id: string): Promise<Session | null> {
    return this.repo.findById(id);
  }

  async createSession(
    id: string,
    condition: ExperimentalCondition,
    agentIds: string[],
    title?: string,
    projectId?: string,
    ownerId?: string,
  ): Promise<Session> {
    const now = new Date().toISOString();
    const existing = this.repo.findById(id);
    const session: Omit<Session, 'messages'> = {
      id,
      condition,
      title: title || existing?.title || `New chat (${condition})`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      agentIds,
      projectId,
    };
    this.repo.upsert(session, ownerId);
    return { ...session, messages: existing?.messages ?? [] };
  }

  async updateSessionTitle(id: string, title: string): Promise<void> {
    if (!this.repo.exists(id)) return;
    this.repo.updateTitle(id, title, new Date().toISOString());
  }

  async addMessage(sessionId: string, message: Omit<Message, 'id'>): Promise<Message> {
    if (!this.repo.exists(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }
    const msg: Message = { ...message, id: uuidv4() };
    this.repo.addMessage(sessionId, msg, new Date().toISOString());
    return msg;
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const session = this.repo.findById(sessionId);
    return session ? session.messages : [];
  }

  async deleteSession(id: string): Promise<void> {
    this.repo.deleteById(id);
  }

  async linkToProject(sessionId: string, projectId: string): Promise<void> {
    if (!this.repo.exists(sessionId)) return;
    this.repo.setProjectId(sessionId, projectId, new Date().toISOString());
  }
}
