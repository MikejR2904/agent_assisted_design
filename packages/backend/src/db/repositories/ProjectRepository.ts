import { Db } from '../Database';
import { SessionRepository } from './SessionRepository';
import type { Project, AgentSummary, Attachment, ExperimentalCondition } from '@agent_design/shared/types';

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  condition: string;
  workspace_dir: string;
  agent_ids: string;
  skill_files: string;
  color: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SummaryRow {
  id: number;
  project_id: string;
  agent_id: string;
  summary_text: string;
  tokens_used: number;
  timestamp: string;
}

interface AttachmentRow {
  id: string;
  project_id: string | null;
  name: string;
  path: string | null;
  content_type: string | null;
  size: number;
  uploaded_at: string;
}

function rowToAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    name: row.name,
    path: row.path ?? undefined,
    contentType: row.content_type ?? undefined,
    size: row.size,
    uploadedAt: row.uploaded_at,
  };
}

function rowToSummary(row: SummaryRow): AgentSummary {
  return {
    projectId: row.project_id,
    agentId: row.agent_id,
    summaryText: row.summary_text,
    tokensUsed: row.tokens_used,
    timestamp: row.timestamp,
  };
}

// Mirrors ProjectService's method surface. sessionIds is derived via SessionRepository (the
// project<->session relationship is a real FK now, not a redundantly-maintained JSON array).
export class ProjectRepository {
  private sessionRepo = new SessionRepository();

  private get db() {
    return Db.getInstance();
  }

  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      condition: row.condition as ExperimentalCondition,
      workspaceDir: row.workspace_dir,
      sessionIds: this.sessionRepo.findIdsByProjectId(row.id),
      agentIds: JSON.parse(row.agent_ids),
      skillFiles: JSON.parse(row.skill_files),
      color: row.color ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ownerFilter unset (unauthenticated or admin caller) -> unfiltered, today's behavior. Set ->
  // only the caller's own projects plus pre-existing unowned ones (user_id IS NULL).
  listProjects(ownerFilter?: { userId: string }): Project[] {
    const rows = (ownerFilter
      ? this.db.prepare('SELECT * FROM projects WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC').all(ownerFilter.userId)
      : this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all()) as ProjectRow[];
    return rows.map((r) => this.rowToProject(r));
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  createProject(project: Omit<Project, 'sessionIds'>, userId?: string): void {
    this.db.prepare(`
      INSERT INTO projects (id, name, description, condition, workspace_dir, agent_ids, skill_files, color, user_id, created_at, updated_at)
      VALUES (@id, @name, @description, @condition, @workspaceDir, @agentIds, @skillFiles, @color, @userId, @createdAt, @updatedAt)
    `).run({
      id: project.id,
      name: project.name,
      description: project.description,
      condition: project.condition,
      workspaceDir: project.workspaceDir,
      userId: userId ?? null,
      agentIds: JSON.stringify(project.agentIds),
      skillFiles: JSON.stringify(project.skillFiles),
      color: project.color ?? null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  }

  updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'createdAt' | 'sessionIds'>>, updatedAt: string): void {
    const current = this.getProject(id);
    if (!current) return;
    const merged = { ...current, ...updates };
    this.db.prepare(`
      UPDATE projects SET name = @name, description = @description, condition = @condition,
        workspace_dir = @workspaceDir, agent_ids = @agentIds, skill_files = @skillFiles,
        color = @color, updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      name: merged.name,
      description: merged.description,
      condition: merged.condition,
      workspaceDir: merged.workspaceDir,
      agentIds: JSON.stringify(merged.agentIds),
      skillFiles: JSON.stringify(merged.skillFiles),
      color: merged.color ?? null,
      updatedAt,
    });
  }

  deleteProject(id: string): boolean {
    // agent_summaries and attachments rows for this project are removed automatically via
    // ON DELETE CASCADE — no separate cleanup calls needed (unlike the old file-based version).
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Summaries
  getSummariesForProject(projectId: string): AgentSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_summaries WHERE project_id = ? ORDER BY timestamp ASC')
      .all(projectId) as SummaryRow[];
    return rows.map(rowToSummary);
  }

  addSummary(summary: AgentSummary): void {
    this.db.prepare(`
      INSERT INTO agent_summaries (project_id, agent_id, summary_text, tokens_used, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(summary.projectId, summary.agentId, summary.summaryText, summary.tokensUsed, summary.timestamp);
  }

  // Attachments
  getAttachmentsForProject(projectId: string): Attachment[] {
    const rows = this.db
      .prepare('SELECT * FROM attachments WHERE project_id = ? ORDER BY uploaded_at ASC')
      .all(projectId) as AttachmentRow[];
    return rows.map(rowToAttachment);
  }

  getAttachmentById(id: string): Attachment | null {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
    return row ? rowToAttachment(row) : null;
  }

  addAttachment(attachment: Attachment): void {
    this.db.prepare(`
      INSERT INTO attachments (id, project_id, name, path, content_type, size, uploaded_at)
      VALUES (@id, @projectId, @name, @path, @contentType, @size, @uploadedAt)
    `).run({
      id: attachment.id,
      projectId: attachment.projectId ?? null,
      name: attachment.name,
      path: attachment.path ?? null,
      contentType: attachment.contentType ?? null,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt,
    });
  }

  deleteAttachment(id: string): boolean {
    const result = this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
