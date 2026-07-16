import type { AgentConfig, Project, ProjectCreate, AgentSummary, Attachment, ProviderStatus, ProviderConfig, CostTier } from '@agent_design/shared/types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// Agents
export const agentsApi = {
  list: (): Promise<AgentConfig[]> => request('/agents'),

  create: (data: Omit<AgentConfig, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<AgentConfig> =>
    request('/agents', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Partial<AgentConfig>): Promise<AgentConfig> =>
    request(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  remove: (id: string): Promise<void> =>
    request(`/agents/${id}`, { method: 'DELETE' }),
};

// Models (LLM provider registry)
export interface ModelEntry {
  id: string;
  providerId: string;
  providerName: string;
  costTier: CostTier;
  available: boolean;
}

export const modelsApi = {
  list: (): Promise<{ models: ModelEntry[] }> => request('/models'),

  providers: (): Promise<{ providers: ProviderStatus[] }> => request('/models/providers'),
};

// Providers (LLM router provider registry management)
export interface ProviderFormData extends Omit<ProviderConfig, 'apiKeyEncoded'> {
  apiKey?: string;
}

export interface ProvidersState {
  effective: ProviderStatus[];
  custom: Omit<ProviderConfig, 'apiKeyEncoded'>[];
  defaults: Omit<ProviderConfig, 'apiKeyEncoded'>[];
  defaultIds: string[];
}

export const providersApi = {
  list: (): Promise<ProvidersState> => request('/providers'),

  create: (data: Partial<ProviderFormData>): Promise<ProvidersState> =>
    request('/providers', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Partial<ProviderFormData>): Promise<ProvidersState> =>
    request(`/providers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  remove: (id: string): Promise<ProvidersState> =>
    request(`/providers/${id}`, { method: 'DELETE' }),
};

// Files 
export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  locked?: boolean;
}

export const filesApi = {
  tree: (condition: string): Promise<FileEntry[]> =>
    request(`/files/tree?condition=${encodeURIComponent(condition)}`),

  read: (path: string, condition: string): Promise<{ content: string; path: string }> =>
    request(`/files/content?path=${encodeURIComponent(path)}&condition=${encodeURIComponent(condition)}`),

  readSkill: (filename: string): Promise<{ content: string; path: string }> =>
    request(`/files/skills/${encodeURIComponent(filename)}`),

  writeSkill: (filename: string, content: string): Promise<{ success: boolean }> =>
    request(`/files/skills/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  readConfig: (filename: string): Promise<{ content: string; path: string; locked: boolean }> =>
    request(`/files/config/${encodeURIComponent(filename)}`),

  upload: async (file: File, condition: string, targetPath: string): Promise<{ success: boolean; path: string }> => {
    const form = new FormData();
    form.append('file', file);
    form.append('condition', condition);
    form.append('targetPath', targetPath);
    const res = await fetch(`${BASE}/files/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
    return res.json();
  },
};

// Telemetry
export const telemetryApi = {
  session: (sessionId: string) => request(`/telemetry/session/${sessionId}`),

  logs: (): Promise<string[]> => request('/telemetry/logs'),

  downloadUrl: (filename: string): string => `${BASE}/telemetry/logs/${filename}`,
};

// Project
export const projectsApi = {
  list: (): Promise<Project[]> => request<Project[]>('/projects'),

  create: (data: ProjectCreate): Promise<Project> =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Partial<Project>): Promise<Project> =>
    request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  delete: (id: string): Promise<void> =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  getSummaries: (projectId: string): Promise<AgentSummary[]> =>
    request<AgentSummary[]>(`/projects/${projectId}/summaries`),

  addSummary: (
    projectId: string,
    data: { agentId: string; summaryText: string; tokensUsed?: number }
  ): Promise<AgentSummary> =>
    request<AgentSummary>(`/projects/${projectId}/summaries`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getAttachments: (projectId: string): Promise<Attachment[]> =>
    request<Attachment[]>(`/projects/${projectId}/attachments`),

  uploadAttachment: (projectId: string, file: File, targetPath?: string): Promise<Attachment> => {
    const form = new FormData();
    form.append('file', file);
    if (targetPath) form.append('path', targetPath);
    return fetch(`${BASE}/projects/${projectId}/attachments`, {
      method: 'POST',
      body: form,
    }).then(res => {
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return res.json() as Promise<Attachment>;
    });
  },

  deleteAttachment: (id: string): Promise<void> =>
    request<void>(`/projects/attachments/${id}`, { method: 'DELETE' }),
};
