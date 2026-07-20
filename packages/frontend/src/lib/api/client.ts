import type { AgentConfig, Project, ProjectCreate, AgentSummary, Attachment, ProviderStatus, ProviderConfig, CostTier, PPAMetrics } from '@agent_design/shared/types';

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

  move: (condition: string, sourcePath: string, destPath: string): Promise<{ success: boolean; path: string }> =>
    request('/files/move', {
      method: 'POST',
      body: JSON.stringify({ condition, sourcePath, destPath }),
    }),

  copy: (condition: string, sourcePath: string, destPath: string): Promise<{ success: boolean; path: string }> =>
    request('/files/copy', {
      method: 'POST',
      body: JSON.stringify({ condition, sourcePath, destPath }),
    }),
};

// Verilator lint diagnostics
export interface VerilatorDiagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code?: string;
  message: string;
}

export const lintApi = {
  verilog: (condition: string, path: string): Promise<{ diagnostics: VerilatorDiagnostic[]; toolAvailable: boolean }> =>
    request('/lint/verilog', {
      method: 'POST',
      body: JSON.stringify({ condition, path }),
    }),
};

// Git integration (local-only: status/diff/log/blame/stage/commit — no branching/push/pull)
export interface GitFileStatus {
  path: string;
  status: 'modified' | 'staged' | 'untracked' | 'deleted';
}
export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}
export interface GitBlameLine {
  line: number;
  hash: string;
  author: string;
  date: string;
  summary: string;
}

export const gitApi = {
  status: (condition: string): Promise<{ entries: GitFileStatus[] }> =>
    request(`/git/status?condition=${encodeURIComponent(condition)}`),

  diff: (condition: string, path: string, staged: boolean): Promise<{ diff: string }> =>
    request(`/git/diff?condition=${encodeURIComponent(condition)}&path=${encodeURIComponent(path)}&staged=${staged}`),

  show: (condition: string, path: string, ref = 'HEAD'): Promise<{ content: string }> =>
    request(`/git/show?condition=${encodeURIComponent(condition)}&path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`),

  log: (condition: string, path?: string): Promise<{ entries: GitLogEntry[] }> =>
    request(`/git/log?condition=${encodeURIComponent(condition)}${path ? `&path=${encodeURIComponent(path)}` : ''}`),

  blame: (condition: string, path: string): Promise<{ lines: GitBlameLine[] }> =>
    request(`/git/blame?condition=${encodeURIComponent(condition)}&path=${encodeURIComponent(path)}`),

  stage: (condition: string, paths: string[]): Promise<{ success: boolean }> =>
    request('/git/stage', { method: 'POST', body: JSON.stringify({ condition, paths }) }),

  unstage: (condition: string, paths: string[]): Promise<{ success: boolean }> =>
    request('/git/unstage', { method: 'POST', body: JSON.stringify({ condition, paths }) }),

  commit: (condition: string, message: string): Promise<{ hash: string }> =>
    request('/git/commit', { method: 'POST', body: JSON.stringify({ condition, message }) }),

  generateCommitMessage: (condition: string): Promise<{ message: string }> =>
    request('/git/commit-message', { method: 'POST', body: JSON.stringify({ condition }) }),
};

// AI-assisted inline editing: Explain / Refactor / Fix / ghost-text completion — all
// single-shot, no-tool LLM calls scoped to the given code, not routed through the
// conversational agent/session pipeline.
export const aiApi = {
  explain: (code: string, language?: string): Promise<{ explanation: string }> =>
    request('/ai/explain', { method: 'POST', body: JSON.stringify({ code, language }) }),

  refactor: (code: string, language?: string): Promise<{ refactored: string }> =>
    request('/ai/refactor', { method: 'POST', body: JSON.stringify({ code, language }) }),

  fix: (code: string, language: string | undefined, diagnostic: { message: string; line: number }): Promise<{ fixed: string }> =>
    request('/ai/fix', { method: 'POST', body: JSON.stringify({ code, language, diagnostic }) }),

  complete: (prefix: string, suffix: string | undefined, language?: string): Promise<{ completion: string }> =>
    request('/ai/complete', { method: 'POST', body: JSON.stringify({ prefix, suffix, language }) }),
};

// Telemetry
export interface ExperimentMetrics {
  sessionId: string;
  humanCorrectionRate: number | null;
  firstPassAcceptanceRate: number | null;
  ppaDrift: Array<{
    from: PPAMetrics;
    to: PPAMetrics;
    fromTimestamp: string;
    toTimestamp: string;
    deltaArea: number;
    deltaPower: number;
    deltaFrequency: number;
    deltaWns: number;
  }>;
}

export const telemetryApi = {
  session: (sessionId: string) => request(`/telemetry/session/${sessionId}`),

  logs: (): Promise<string[]> => request('/telemetry/logs'),

  downloadUrl: (filename: string): string => `${BASE}/telemetry/logs/${filename}`,

  experimentMetrics: (sessionId: string): Promise<ExperimentMetrics> =>
    request(`/telemetry/experiment/${sessionId}/metrics`),
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
