import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Project, ProjectCreate, AgentSummary, Attachment } from '@agent_design/shared';
import { ProjectRepository } from '../db/repositories/ProjectRepository';
import { SessionRepository } from '../db/repositories/SessionRepository';
import { logger } from '../utils/logger';

// Backed by SQLite (via ProjectRepository/SessionRepository) instead of whole-file JSON
// reads/writes. Public method signatures are unchanged, so route callers didn't need to change.
// Project.sessionIds is no longer a manually-synced array — it's derived from a real FK
// (sessions.project_id), so addSessionToProject now just sets that FK.
export class ProjectService {
  private repo = new ProjectRepository();
  private sessionRepo = new SessionRepository();
  private workspaceRoot: string;
  private baselineDir: string;

  // telemetryRoot is no longer used directly here (the repository resolves the DB path via
  // ConfigManager) — kept as a constructor param for call-site compatibility.
  constructor(_telemetryRoot: string, workspaceRoot: string, baselineDir: string) {
    this.workspaceRoot = workspaceRoot;
    this.baselineDir = baselineDir;
  }

  // Projects
  // ownerId set -> only that user's projects plus pre-existing unowned ones. Unset (no
  // authenticated caller, or an admin) -> unfiltered, matching pre-auth behavior.
  async listProjects(ownerId?: string): Promise<Project[]> {
    return this.repo.listProjects(ownerId ? { userId: ownerId } : undefined);
  }

  async getProject(id: string): Promise<Project | null> {
    return this.repo.getProject(id);
  }

  async createProject(data: ProjectCreate, ownerId?: string): Promise<Project> {
    const id = uuidv4();
    const workspaceDir = path.join(this.workspaceRoot, 'projects', id);
    await fs.mkdir(path.dirname(workspaceDir), { recursive: true });
    try {
      await fs.access(this.baselineDir);
      await fs.cp(this.baselineDir, workspaceDir, { recursive: true });
    } catch {
      await fs.mkdir(workspaceDir, { recursive: true });
    }
    const now = new Date().toISOString();
    const project: Project = {
      id,
      name: data.name,
      description: data.description || '',
      condition: data.condition || 'agent-assisted',
      workspaceDir,
      sessionIds: [],
      agentIds: [],
      skillFiles: [],
      createdAt: now,
      updatedAt: now,
    };
    this.repo.createProject(project, ownerId);
    logger.info('Project created', { projectId: id, name: data.name });
    return project;
  }

  async updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project | null> {
    const existing = this.repo.getProject(id);
    if (!existing) return null;
    const { sessionIds: _ignored, ...rest } = updates;
    this.repo.updateProject(id, rest, new Date().toISOString());
    return this.repo.getProject(id);
  }

  async deleteProject(id: string): Promise<boolean> {
    const project = this.repo.getProject(id);
    if (!project) return false;
    // agent_summaries/attachments rows cascade automatically (ON DELETE CASCADE); only the
    // on-disk workspace directory needs explicit cleanup.
    const deleted = this.repo.deleteProject(id);
    if (deleted) {
      await fs.rm(project.workspaceDir, { recursive: true, force: true });
    }
    return deleted;
  }

  async addSessionToProject(projectId: string, sessionId: string): Promise<void> {
    if (!this.repo.getProject(projectId)) return;
    if (!this.sessionRepo.exists(sessionId)) return;
    this.sessionRepo.setProjectId(sessionId, projectId, new Date().toISOString());
  }

  // Summaries
  async getSummariesForProject(projectId: string): Promise<AgentSummary[]> {
    return this.repo.getSummariesForProject(projectId);
  }

  async addSummary(summary: Omit<AgentSummary, 'timestamp'>): Promise<AgentSummary> {
    const newSummary: AgentSummary = {
      ...summary,
      timestamp: new Date().toISOString(),
    };
    this.repo.addSummary(newSummary);
    return newSummary;
  }

  // Attachments
  async getAttachmentsForProject(projectId: string): Promise<Attachment[]> {
    return this.repo.getAttachmentsForProject(projectId);
  }

  async addAttachment(projectId: string, file: Express.Multer.File, targetPath?: string): Promise<Attachment> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Project not found');

    const id = uuidv4();
    const now = new Date().toISOString();
    const relativePath = targetPath || file.originalname;
    const fullPath = path.join(project.workspaceDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.buffer);

    const attachment: Attachment = {
      id,
      projectId,
      name: file.originalname,
      path: relativePath,
      contentType: file.mimetype,
      size: file.size,
      uploadedAt: now,
    };
    this.repo.addAttachment(attachment);
    return attachment;
  }

  async deleteAttachment(id: string): Promise<boolean> {
    const attachment = this.repo.getAttachmentById(id);
    if (!attachment || !attachment.projectId) return false;
    const project = await this.getProject(attachment.projectId);
    if (project && attachment.path) {
      const fullPath = path.join(project.workspaceDir, attachment.path);
      await fs.unlink(fullPath).catch(() => {});
    }
    return this.repo.deleteAttachment(id);
  }
}
