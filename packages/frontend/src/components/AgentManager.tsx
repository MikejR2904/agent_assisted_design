'use client';

import React, { useState } from 'react';
import {
  Plus, Edit2, Trash2, X, Save, ChevronDown, Brain,
  Shield, Zap, AlertOctagon, CheckCircle, Clock, XCircle,
} from 'lucide-react';
import { useAgentStore, getDecodedApiKey } from '@/lib/stores/agentStore';
import type { AgentConfig, AgentTool, BaseModel } from '@agent_design/shared/types';
import { BaseModelSchema } from '@agent_design/shared/types';
import { clsx } from 'clsx';

// Types

type PermissionLevel = AgentConfig['permissionLevel'];

interface AgentFormState {
  name: string;
  roleDescription: string;
  baseModel: BaseModel;
  apiKey: string;
  permissionLevel: PermissionLevel;
  assignedTools: AgentTool[];
  maxRetries: number;
}

const DEFAULT_FORM: AgentFormState = {
  name: '',
  roleDescription: '',
  baseModel: 'claude-3-5-sonnet-20241022',
  apiKey: '',
  permissionLevel: 'ask-user',
  assignedTools: ['read_file', 'write_rtl'],
  maxRetries: 3,
};

const ALL_TOOLS: AgentTool[] = [
  'read_file',
  'write_rtl',
  'run_verilator',
  'run_openroad',
  'run_opensta',
  'run_python',
  'run_riscv_as',
  'query_rag',
  'list_files',
];

const MODEL_OPTIONS: { value: string; label: string }[] = BaseModelSchema.options.map((value) => {
  // Format: remove hyphens, capitalize words
  let label = value.replace(/-/g, ' ');
  label = label.replace(/\b\w/g, l => l.toUpperCase());

  // Human-readable overrides
  const overrides: Record<string, string> = {
    'Claude 3 5 Sonnet 20241022': 'Claude 3.5 Sonnet',
    'Claude 3 Haiku 20240307': 'Claude 3 Haiku',
    'Claude 3 Opus 20240229': 'Claude 3 Opus',
    'Claude Opus 4 8': 'Claude Opus 4.8',
    'Claude Sonnet 4 5': 'Claude Sonnet 4.5',
    'Gpt 4o': 'GPT-4o',
    'Gpt 4o Mini': 'GPT-4o Mini',
    'Gpt 4 Turbo': 'GPT-4 Turbo',
    'Gpt 3 5 Turbo': 'GPT-3.5 Turbo',
    'Gemini 3 1 Pro': 'Gemini 3.1 Pro',
    'Gemini 3 5 Flash': 'Gemini 3.5 Flash',
    'Gemini 3 1 Ultra': 'Gemini 3.1 Ultra',
    'Llama3 70b 8192': 'Llama 3 70B (Groq)',
    'Mixtral 8x7b 32768': 'Mixtral 8x7B (Groq)',
    'Ollama/Llama3': 'Ollama Llama 3 (Local)',
    'Ollama/Codellama': 'Ollama CodeLlama (Local)',
    'Deepseek Coder': 'DeepSeek Coder',
    'Deepseek Chat': 'DeepSeek Chat',
    'Mistral 7b': 'Mistral 7B',
    'Mixtral 8x22b': 'Mixtral 8x22B',
    'Falcon 180b': 'Falcon 180B',
    'Phi 3 Mini': 'Phi-3 Mini',
    'Phi 3 Medium': 'Phi-3 Medium',
    'Chatgpt 5 5': 'ChatGPT 5.5',
  };
  return { value, label: overrides[label] || label };
});

// Helpers

const PERMISSION_META: Record<PermissionLevel, { label: string; icon: React.ReactNode; classes: string }> = {
  'auto-execute': {
    label: 'Auto-Execute',
    icon: <Zap size={11} />,
    classes: 'bg-success/15 text-success border-success/30',
  },
  'ask-user': {
    label: 'Ask User',
    icon: <Shield size={11} />,
    classes: 'bg-warning/15 text-warning border-warning/30',
  },
  blocked: {
    label: 'Blocked',
    icon: <AlertOctagon size={11} />,
    classes: 'bg-error/15 text-error border-error/30',
  },
};

const STATUS_META: Record<AgentConfig['status'], { icon: React.ReactNode; classes: string }> = {
  active:             { icon: <CheckCircle size={11} />,  classes: 'text-success' },
  idle:               { icon: <Clock size={11} />,         classes: 'text-gray-500' },
  thinking:           { icon: <Brain size={11} className="animate-pulse" />, classes: 'text-accent' },
  'awaiting-approval':{ icon: <Shield size={11} />,        classes: 'text-warning' },
  error:              { icon: <XCircle size={11} />,        classes: 'text-error' },
};

function isFreeModel(model: string): boolean {
  return model.includes('groq') || model.includes('ollama') ||
    model.includes('gemini-3.5-flash') || model.includes('mixtral');
}

// Component

export function AgentManager() {
  const { agents, addAgent, updateAgent, deleteAgent, isLoading } = useAgentStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(DEFAULT_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form helpers

  const openCreate = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setSaveError(null);
    setIsModalOpen(true);
  };

  const openEdit = (agent: AgentConfig) => {
    setForm({
      name: agent.name,
      roleDescription: agent.roleDescription,
      baseModel: agent.baseModel,
      apiKey: getDecodedApiKey(agent),
      permissionLevel: agent.permissionLevel,
      assignedTools: agent.assignedTools,
      maxRetries: agent.maxRetries,
    });
    setEditingId(agent.id);
    setSaveError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setSaveError(null);
  };

  const toggleTool = (tool: AgentTool) => {
    setForm((prev) => ({
      ...prev,
      assignedTools: prev.assignedTools.includes(tool)
        ? prev.assignedTools.filter((t) => t !== tool)
        : [...prev.assignedTools, tool],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    try {
      if (editingId) {
        await updateAgent(editingId, form);
      } else {
        await addAgent(form);
      }
      closeModal();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteAgent(id);
    setConfirmDeleteId(null);
  };

  // Render

  return (
    <div className="flex flex-col h-full bg-surface-raised">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-overlay">
        <div className="flex items-center gap-2">
          <Brain size={15} className="text-accent" />
          <span className="text-sm font-mono text-gray-300">Agent Registry</span>
          <span className="text-xs text-gray-600 font-mono">({agents.length})</span>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 rounded text-xs font-medium transition-colors"
        >
          <Plus size={12} />
          Add Agent
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading && agents.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs text-gray-500 font-mono">
            Loading agents...
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-50">
            <Brain size={24} className="text-gray-600" />
            <p className="text-xs text-gray-500 font-mono">No agents configured.</p>
            <p className="text-xs text-gray-600 font-mono">Click "Add Agent" to create one.</p>
          </div>
        ) : (
          <table className="w-full text-xs font-mono border-collapse">
            <thead className="sticky top-0 bg-surface-overlay">
              <tr className="text-gray-500 uppercase tracking-wider text-[10px]">
                <th className="text-left px-4 py-2">Name / Role</th>
                <th className="text-left px-4 py-2">Model</th>
                <th className="text-left px-4 py-2">API Key</th>
                <th className="text-left px-4 py-2">Permission</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Retries</th>
                <th className="text-left px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const perm = PERMISSION_META[agent.permissionLevel];
                const status = STATUS_META[agent.status];
                return (
                  <tr
                    key={agent.id}
                    className="border-b border-surface-overlay hover:bg-surface-elevated transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <p className="text-gray-200 font-medium">{agent.name}</p>
                      <p className="text-gray-500 text-[10px] truncate max-w-[160px]">{agent.roleDescription}</p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-[10px] max-w-[120px] truncate">
                      {MODEL_OPTIONS.find((m) => m.value === agent.baseModel)?.label ?? agent.baseModel}
                    </td>
                    <td className="px-4 py-2.5">
                      {agent.apiKey ? (
                        <span className="text-gray-500">
                          ••••{getDecodedApiKey(agent).slice(-4)}
                        </span>
                      ) : isFreeModel(agent.baseModel) ? (
                        <span className="text-success/70">Free tier</span>
                      ) : (
                        <span className="text-error/70">Not set</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={clsx('flex items-center gap-1 w-fit px-2 py-0.5 rounded border text-[10px]', perm.classes)}>
                        {perm.icon}
                        {perm.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={clsx('flex items-center gap-1', status.classes)}>
                        {status.icon}
                        {agent.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{agent.maxRetries}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(agent)}
                          className="text-gray-500 hover:text-accent transition-colors"
                          title="Edit agent"
                        >
                          <Edit2 size={13} />
                        </button>
                        {confirmDeleteId === agent.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(agent.id)}
                              className="text-error hover:text-error/80 text-[10px] font-medium"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-gray-500 hover:text-white text-[10px]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(agent.id)}
                            className="text-gray-600 hover:text-error transition-colors"
                            title="Delete agent"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-raised border border-surface-overlay rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-overlay sticky top-0 bg-surface-raised">
              <div className="flex items-center gap-2">
                <Brain size={15} className="text-accent" />
                <h3 className="text-sm font-mono text-gray-200">
                  {editingId ? 'Edit Agent' : 'New Agent'}
                </h3>
              </div>
              <button onClick={closeModal} className="text-gray-600 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
              {/* Name */}
              <Field label="Name" required>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Coder"
                  className={inputCls}
                  required
                />
              </Field>

              {/* Role description */}
              <Field label="Role Description" required>
                <input
                  type="text"
                  value={form.roleDescription}
                  onChange={(e) => setForm({ ...form, roleDescription: e.target.value })}
                  placeholder="e.g. RTL Developer — writes Verilog modules"
                  className={inputCls}
                  required
                />
              </Field>

              {/* Base model */}
              <Field label="Base Model">
                <div className="relative">
                  <select
                    value={form.baseModel}
                    onChange={(e) => setForm({ ...form, baseModel: e.target.value as BaseModel })}
                    className={clsx(inputCls, 'appearance-none pr-8')}
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>
              </Field>

              {/* API Key */}
              <Field
                label="API Key"
                hint={
                  isFreeModel(form.baseModel)
                    ? '💡 This model has a free tier — API key is optional.'
                    : '🔒 Key is encoded locally and never sent to our servers.'
                }
              >
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={isFreeModel(form.baseModel) ? 'Optional for free tier' : 'sk-...'}
                  className={clsx(inputCls, 'font-mono')}
                  autoComplete="new-password"
                />
              </Field>

              {/* Permission level */}
              <Field label="Permission Level">
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(PERMISSION_META) as PermissionLevel[]).map((level) => {
                    const meta = PERMISSION_META[level];
                    const isActive = form.permissionLevel === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setForm({ ...form, permissionLevel: level })}
                        className={clsx(
                          'flex items-center justify-center gap-1.5 py-2 px-3 rounded border text-xs font-mono transition-all',
                          isActive
                            ? clsx(meta.classes, 'ring-1 ring-current')
                            : 'border-surface-overlay text-gray-500 hover:border-gray-500',
                        )}
                      >
                        {meta.icon}
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Assigned tools */}
              <Field label="Assigned Tools">
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  {ALL_TOOLS.map((tool) => {
                    const checked = form.assignedTools.includes(tool);
                    return (
                      <label
                        key={tool}
                        className={clsx(
                          'flex items-center gap-2 px-3 py-1.5 rounded border cursor-pointer text-xs font-mono transition-colors',
                          checked
                            ? 'bg-accent/10 border-accent/40 text-accent'
                            : 'border-surface-overlay text-gray-500 hover:border-gray-500 hover:text-gray-300',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTool(tool)}
                          className="hidden"
                        />
                        <span className={clsx('w-3 h-3 rounded flex items-center justify-center border flex-shrink-0',
                          checked ? 'bg-accent border-accent' : 'border-gray-600')}>
                          {checked && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="text-white">
                              <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                            </svg>
                          )}
                        </span>
                        {tool}
                      </label>
                    );
                  })}
                </div>
              </Field>

              {/* Max retries */}
              <Field label="Max Retries" hint="How many times the reflexion loop retries on failure (1–10).">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={form.maxRetries}
                    onChange={(e) => setForm({ ...form, maxRetries: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-accent"
                  />
                  <span className="text-sm font-mono text-accent w-4 text-center">{form.maxRetries}</span>
                </div>
              </Field>

              {/* Save error */}
              {saveError && (
                <p className="text-xs text-error font-mono bg-error/10 border border-error/20 rounded px-3 py-2">
                  ⚠ {saveError}
                </p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-4 border-t border-surface-overlay">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex items-center gap-1.5 px-4 py-2 border border-surface-overlay rounded text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                >
                  <X size={13} />
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
                >
                  <Save size={13} />
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const inputCls =
  'w-full bg-surface border border-surface-overlay text-gray-200 text-xs font-mono px-3 py-2 rounded focus:outline-none focus:border-accent/60 placeholder:text-gray-600 transition-colors';

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-mono text-gray-400">
        {label}
        {required && <span className="text-error ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-600 font-mono">{hint}</p>}
    </div>
  );
}