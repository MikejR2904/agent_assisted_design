import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { projectsApi } from '../api/client';
import { v4 as uuidv4 } from 'uuid';
import type { Project, AgentSummary } from '@agent_design/shared/types';

// Palette for auto-assigning project colours
const PROJECT_COLORS = ['#4f8ef7', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#36413f', '#f97316', '#6366f1',];
function nextColor(existing: Project[]): string {
  return PROJECT_COLORS[existing.length % PROJECT_COLORS.length];
}

// Store interface 
interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  // Summaries: keyed by `${projectId}:${agentId}`
  summaries: Record<string, AgentSummary>;
  isLoading: boolean;

  // Project CRUD
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'condition' | 'color'>>) => void;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;

  // Session <-> project linking
  addSessionToProject: (projectId: string, sessionId: string) => void;
  removeSessionFromProject: (projectId: string, sessionId: string) => void;

  // Agent <-> project linking
  addAgentToProject: (projectId: string, agentId: string) => void;
  removeAgentFromProject: (projectId: string, agentId: string) => void;

  // Skill files attached to a project
  addSkillFile: (projectId: string, path: string) => void;
  removeSkillFile: (projectId: string, path: string) => void;

  // Summaries
  setSummary: (summary: AgentSummary) => void;
  getSummary: (projectId: string, agentId: string) => AgentSummary | null;

  // Helpers
  getActiveProject: () => Project | null;
  getProjectForSession: (sessionId: string) => Project | null;
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      summaries: {},
      isLoading: false,

      // Load projects from backend
      loadProjects: async () => {
        set({ isLoading: true });
        try {
          const projects = await projectsApi.list();
          set({ projects });
        } catch (error) {
          console.error('Failed to load projects from backend', error);
          // Keep existing local projects as fallback
        } finally {
          set({ isLoading: false });
        }
      },

      // CRUD
      createProject: async (name, description = '') => {
        try {
          const project = await projectsApi.create({ name, description, });
          set((state) => ({
            projects: [project, ...state.projects],
            activeProjectId: project.id,
          }));
          return project;
        } catch (error) {
          console.error('Failed to create project on backend', error);
          // Fallback to local creation
          const now = new Date().toISOString();
          const project: Project = {
            id: uuidv4(),
            name,
            description,
            condition: 'agent-assisted',
            workspaceDir: `project_${uuidv4().slice(0, 8)}`,
            sessionIds: [],
            agentIds: [],
            skillFiles: [],
            createdAt: now,
            updatedAt: now,
            color: nextColor(get().projects)
          };
          set((state) => ({
            projects: [project, ...state.projects],
            activeProjectId: project.id,
          }));
          return project;
        }
      },

      updateProject: async (id, updates) => {
        const currentProject = get().projects.find(p => p.id === id);
        if (!currentProject) return;
        try {
          const updatedProject = await projectsApi.update(id, updates);
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === id ? { ...updatedProject } : p
            ),
          }));
        } catch (error) {
          console.error('Failed to update project on backend', error);
          // Optimistic local update
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p,
            ),
          }));
        }
      },

      deleteProject: async (id) => {
        try {
          await projectsApi.delete(id);
        } catch (error) {
          console.error('Failed to delete project on backend', error);
          // Continue with local deletion even if backend fails
        }
        set((state) => {
          const remaining = state.projects.filter((p) => p.id !== id);
          // Clean up remaining summaries
          const summaries = { ...state.summaries };
          Object.keys(summaries).forEach((key) => {
            if (key.startsWith(`${id}:`)) delete summaries[key];
          });
          return {
            projects: remaining,
            activeProjectId: state.activeProjectId === id
              ? (remaining[0]?.id ?? null)
              : state.activeProjectId,
            summaries,
          };
        });
      },

      fetchProjects: async () => {
        try {
          const projects = await projectsApi.list();
          set({ projects });
        } catch (error) {
          console.error('Failed to fetch projects', error);
        }
      },

      setActiveProject: (id) => set({ activeProjectId: id }),

      // Session links
      addSessionToProject: (projectId, sessionId) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId && !p.sessionIds.includes(sessionId)
              ? { ...p, sessionIds: [...p.sessionIds, sessionId], updatedAt: new Date().toISOString() }
              : p,
          ),
        }));
      },

      removeSessionFromProject: (projectId, sessionId) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? { ...p, sessionIds: p.sessionIds.filter((s) => s !== sessionId) }
              : p,
          ),
        }));
      },

      // Agent links 
      addAgentToProject: (projectId, agentId) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId && !p.agentIds.includes(agentId)
              ? { ...p, agentIds: [...p.agentIds, agentId] }
              : p,
          ),
        }));
      },

      removeAgentFromProject: (projectId, agentId) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? { ...p, agentIds: p.agentIds.filter((a) => a !== agentId) }
              : p,
          ),
        }));
      },

      // Skill files
      addSkillFile: (projectId, path) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId && !p.skillFiles.includes(path)
              ? { ...p, skillFiles: [...p.skillFiles, path] }
              : p,
          ),
        }));
      },

      removeSkillFile: (projectId, path) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? { ...p, skillFiles: p.skillFiles.filter((f) => f !== path) }
              : p,
          ),
        }));
      },

      // Summaries
      setSummary: (summary) => {
        const key = `${summary.projectId}:${summary.agentId}`;
        set((state) => ({ summaries: { ...state.summaries, [key]: summary } }));
      },

      getSummary: (projectId, agentId) => {
        const key = `${projectId}:${agentId}`;
        return get().summaries[key] ?? null;
      },

      // Helpers
      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        return projects.find((p) => p.id === activeProjectId) ?? null;
      },

      getProjectForSession: (sessionId) => {
        return get().projects.find((p) => p.sessionIds.includes(sessionId)) ?? null;
      },
    }),
    { name: 'workbench-projects' },
  ),
);