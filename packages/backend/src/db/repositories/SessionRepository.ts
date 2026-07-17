import { Db } from '../Database';
import type { Session, Message } from '../../services/SessionService';
import type { ExperimentalCondition } from '@agent_design/shared/types';

interface SessionRow {
  id: string;
  condition: string;
  title: string;
  project_id: string | null;
  agent_ids: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  agent_id: string | null;
  timestamp: string;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role as Message['role'],
    content: row.content,
    agentId: row.agent_id ?? undefined,
    timestamp: row.timestamp,
  };
}

function rowToSession(row: SessionRow, messages: Message[]): Session {
  return {
    id: row.id,
    condition: row.condition as ExperimentalCondition,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    agentIds: JSON.parse(row.agent_ids),
    projectId: row.project_id ?? undefined,
    messages,
  };
}

// Mirrors SessionService's method surface closely so the service refactor is close to a
// search-and-replace of each method body, not a redesign.
export class SessionRepository {
  private get db() {
    return Db.getInstance();
  }

  // No messages populated — matches the only current caller (GET /api/sessions), which strips
  // messages immediately anyway.
  // ownerFilter unset (unauthenticated or admin caller) -> unfiltered, today's behavior. Set ->
  // only the caller's own sessions plus pre-existing unowned ones (user_id IS NULL).
  findAll(ownerFilter?: { userId: string }): Session[] {
    const rows = (ownerFilter
      ? this.db.prepare('SELECT * FROM sessions WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC').all(ownerFilter.userId)
      : this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all()) as SessionRow[];
    return rows.map((r) => rowToSession(r, []));
  }

  findById(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) return null;
    const messageRows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(id) as MessageRow[];
    return rowToSession(row, messageRows.map(rowToMessage));
  }

  exists(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id);
  }

  // userId is only ever set on the initial INSERT (the ON CONFLICT branch never touches
  // user_id) — a session's owner doesn't change just because it's re-synced by a later,
  // possibly-unauthenticated call to the same create endpoint.
  upsert(session: Omit<Session, 'messages'>, userId?: string): void {
    this.db.prepare(`
      INSERT INTO sessions (id, condition, title, project_id, agent_ids, user_id, created_at, updated_at)
      VALUES (@id, @condition, @title, @projectId, @agentIds, @userId, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        condition = excluded.condition,
        title = excluded.title,
        project_id = excluded.project_id,
        agent_ids = excluded.agent_ids,
        updated_at = excluded.updated_at
    `).run({
      id: session.id,
      condition: session.condition,
      title: session.title,
      projectId: session.projectId ?? null,
      agentIds: JSON.stringify(session.agentIds),
      userId: userId ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  }

  updateTitle(id: string, title: string, updatedAt: string): void {
    this.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, updatedAt, id);
  }

  setProjectId(id: string, projectId: string, updatedAt: string): void {
    this.db.prepare('UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?').run(projectId, updatedAt, id);
  }

  addMessage(sessionId: string, message: Message, updatedAt: string): void {
    const insertMessage = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, agent_id, timestamp)
      VALUES (@id, @sessionId, @role, @content, @agentId, @timestamp)
    `);
    const touchSession = this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
    const tx = this.db.transaction(() => {
      insertMessage.run({
        id: message.id,
        sessionId,
        role: message.role,
        content: message.content,
        agentId: message.agentId ?? null,
        timestamp: message.timestamp,
      });
      touchSession.run(updatedAt, sessionId);
    });
    tx();
  }

  deleteById(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id); // messages cascade
  }

  // Sessions belonging to a project, for ProjectRepository's derived sessionIds.
  findIdsByProjectId(projectId: string): string[] {
    return (this.db.prepare('SELECT id FROM sessions WHERE project_id = ?').all(projectId) as { id: string }[])
      .map((r) => r.id);
  }
}
