import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Project, ProjectCreate, AgentSummary, Attachment } from '@agent_design/shared';
import { logger } from '../utils/logger';

export class ProjectService {
  private projectsFile: string;
  private summariesFile: string;
  private attachmentsFile: string;
  private workspaceRoot: string;
  private baselineDir: string;

  constructor(telemetryRoot: string, workspaceRoot: string, baselineDir: string) {
    this.projectsFile = path.join(telemetryRoot, 'projects.json');
    this.summariesFile = path.join(telemetryRoot, 'summaries.json');
    this.attachmentsFile = path.join(telemetryRoot, 'attachments.json');
    this.workspaceRoot = workspaceRoot;
    this.baselineDir = baselineDir;
  }

  // Projects
  async listProjects(): Promise<Project[]> {
    try {
      const data = await fs.readFile(this.projectsFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async getProject(id: string): Promise<Project | null> {
    const projects = await this.listProjects();
    return projects.find(p => p.id === id) || null;
  }

  async createProject(data: ProjectCreate): Promise<Project> {
    const projects = await this.listProjects();
    const id = uuidv4();
    const workspaceDir = path.join(this.workspaceRoot, 'projects', id);
    // Create workspace from baseline
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
    projects.push(project);
    await fs.writeFile(this.projectsFile, JSON.stringify(projects, null, 2));
    logger.info('Project created', { projectId: id, name: data.name });
    return project;
  }

  async updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project | null> {
    const projects = await this.listProjects();
    const idx = projects.findIndex(p => p.id === id);
    if (idx === -1) return null;
    projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString() };
    await fs.writeFile(this.projectsFile, JSON.stringify(projects, null, 2));
    return projects[idx];
  }

  async deleteProject(id: string): Promise<boolean> {
    const projects = await this.listProjects();
    const filtered = projects.filter(p => p.id !== id);
    if (filtered.length === projects.length) return false;
    await fs.writeFile(this.projectsFile, JSON.stringify(filtered, null, 2));
    // Clean up workspace directory
    const project = projects.find(p => p.id === id);
    if (project) {
      await fs.rm(project.workspaceDir, { recursive: true, force: true });
    }
    // Clean up summaries and attachments for this project
    await this.deleteSummariesForProject(id);
    await this.deleteAttachmentsForProject(id);
    return true;
  }

  async addSessionToProject(projectId: string, sessionId: string): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) return;
    if (!project.sessionIds.includes(sessionId)) {
      project.sessionIds.push(sessionId);
      await this.updateProject(projectId, { sessionIds: project.sessionIds });
    }
  }

  // Summaries
  private async readSummaries(): Promise<AgentSummary[]> {
    try {
      const data = await fs.readFile(this.summariesFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async writeSummaries(summaries: AgentSummary[]): Promise<void> {
    await fs.mkdir(path.dirname(this.summariesFile), { recursive: true });
    await fs.writeFile(this.summariesFile, JSON.stringify(summaries, null, 2));
  }

  async getSummariesForProject(projectId: string): Promise<AgentSummary[]> {
    const all = await this.readSummaries();
    return all.filter(s => s.projectId === projectId);
  }

  async addSummary(summary: Omit<AgentSummary, 'timestamp'>): Promise<AgentSummary> {
    const summaries = await this.readSummaries();
    const newSummary: AgentSummary = {
      ...summary,
      timestamp: new Date().toISOString(),
    };
    summaries.push(newSummary);
    await this.writeSummaries(summaries);
    return newSummary;
  }

  private async deleteSummariesForProject(projectId: string): Promise<void> {
    const summaries = await this.readSummaries();
    const filtered = summaries.filter(s => s.projectId !== projectId);
    await this.writeSummaries(filtered);
  }

  // Attachments
  private async readAttachments(): Promise<Attachment[]> {
    try {
      const data = await fs.readFile(this.attachmentsFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async writeAttachments(attachments: Attachment[]): Promise<void> {
    await fs.mkdir(path.dirname(this.attachmentsFile), { recursive: true });
    await fs.writeFile(this.attachmentsFile, JSON.stringify(attachments, null, 2));
  }

  async getAttachmentsForProject(projectId: string): Promise<Attachment[]> {
    const all = await this.readAttachments();
    return all.filter(a => a.projectId === projectId);
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
    const attachments = await this.readAttachments();
    attachments.push(attachment);
    await this.writeAttachments(attachments);
    return attachment;
  }

  async deleteAttachment(id: string): Promise<boolean> {
    const attachments = await this.readAttachments();
    const idx = attachments.findIndex(a => a.id === id);
    if (idx === -1) return false;
    const attachment = attachments[idx];
    // Remove file from disk
    if (!attachment.projectId) {
      return false;
    }
    const project = await this.getProject(attachment.projectId);
    if (project && attachment.path) {
      const fullPath = path.join(project.workspaceDir, attachment.path);
      await fs.unlink(fullPath).catch(() => {});
    }
    attachments.splice(idx, 1);
    await this.writeAttachments(attachments);
    return true;
  }

  private async deleteAttachmentsForProject(projectId: string): Promise<void> {
    const attachments = await this.readAttachments();
    const filtered = attachments.filter(a => a.projectId !== projectId);
    await this.writeAttachments(filtered);
  }
}