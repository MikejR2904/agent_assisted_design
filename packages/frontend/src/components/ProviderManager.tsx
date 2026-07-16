'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Edit2, Trash2, X, Save, ChevronDown, Plug,
  CheckCircle, XCircle, PauseCircle, ShieldCheck,
} from 'lucide-react';
import { providersApi, type ProviderFormData, type ProvidersState } from '@/lib/api/client';
import { Field, inputCls } from '@/components/forms/FormField';
import type { ProviderType, CostTier } from '@agent_design/shared/types';
import { clsx } from 'clsx';

// Types

interface ProviderFormState {
  id: string;
  name: string;
  type: ProviderType;
  baseURL: string;
  apiKeyEnv: string;
  apiKey: string;
  costTier: CostTier;
  priority: number;
  modelsText: string;
  headersText: string;
  enabled: boolean;
}

const DEFAULT_FORM: ProviderFormState = {
  id: '',
  name: '',
  type: 'openai-compatible',
  baseURL: '',
  apiKeyEnv: '',
  apiKey: '',
  costTier: 'medium',
  priority: 5,
  modelsText: '',
  headersText: '',
  enabled: true,
};

// Only these are creatable/editable from the UI — 'custom' is reserved for the built-in
// M365 Copilot integration, which needs a bespoke client and isn't config-instantiable.
const SELECTABLE_TYPES: ProviderType[] = ['openai-compatible', 'anthropic', 'gemini', 'groq', 'ollama'];

// Helpers

const COST_TIER_META: Record<CostTier, { label: string; classes: string }> = {
  free: { label: 'Free', classes: 'bg-success/15 text-success border-success/30' },
  low: { label: 'Low', classes: 'bg-accent/15 text-accent border-accent/30' },
  medium: { label: 'Medium', classes: 'bg-warning/15 text-warning border-warning/30' },
  high: { label: 'High', classes: 'bg-error/15 text-error border-error/30' },
  premium: { label: 'Premium', classes: 'bg-error/15 text-error border-error/30' },
  mixed: { label: 'Mixed', classes: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
};

function parseModels(text: string): string[] | undefined {
  const models = text.split(',').map((s) => s.trim()).filter(Boolean);
  return models.length ? models : undefined;
}

function formatModels(models?: string[]): string {
  return (models ?? []).join(', ');
}

// Component

export function ProviderManager() {
  const [state, setState] = useState<ProvidersState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormState>(DEFAULT_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = () => {
    setIsLoading(true);
    providersApi.list()
      .then((res) => { setState(res); setLoadError(null); })
      .catch((err) => setLoadError((err as Error).message))
      .finally(() => setIsLoading(false));
  };

  useEffect(refresh, []);

  // Merge built-in defaults with any custom overrides (override wins) for row rendering + edit
  // prefill; `effective` (from the live registry) supplies availability + model count.
  const configById = useMemo(() => {
    const map = new Map<string, ProviderFormData>();
    for (const c of state?.defaults ?? []) map.set(c.id, c);
    for (const c of state?.custom ?? []) map.set(c.id, c);
    return map;
  }, [state]);

  // Disabled providers are filtered out of the live registry entirely, so they never appear in
  // `state.effective` — build rows from the full config set (defaults ∪ custom) instead, and
  // join in live status (available/modelCount) for whichever ones are actually registered.
  const rows = useMemo(() => {
    const effectiveById = new Map((state?.effective ?? []).map((e) => [e.id, e]));
    return Array.from(configById.values()).map((config) => {
      const live = effectiveById.get(config.id);
      return {
        id: config.id,
        name: config.name ?? config.id,
        type: config.type,
        costTier: config.costTier,
        enabled: config.enabled,
        available: live?.available ?? false,
        modelCount: live?.modelCount ?? config.models?.length ?? 0,
      };
    });
  }, [configById, state]);
  const defaultIds = new Set(state?.defaultIds ?? []);
  const customIds = new Set((state?.custom ?? []).map((c) => c.id));

  // Form helpers

  const openCreate = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setSaveError(null);
    setIsModalOpen(true);
  };

  const openEdit = (id: string) => {
    const config = configById.get(id);
    if (!config) return;
    setForm({
      id: config.id,
      name: config.name ?? '',
      type: config.type,
      baseURL: config.baseURL ?? '',
      apiKeyEnv: config.apiKeyEnv ?? '',
      apiKey: '',
      costTier: config.costTier,
      priority: config.priority,
      modelsText: formatModels(config.models),
      headersText: config.defaultHeaders ? JSON.stringify(config.defaultHeaders, null, 2) : '',
      enabled: config.enabled,
    });
    setEditingId(id);
    setSaveError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setSaveError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError(null);

    let defaultHeaders: Record<string, string> | undefined;
    if (form.headersText.trim()) {
      try {
        defaultHeaders = JSON.parse(form.headersText);
      } catch {
        setSaveError('Default headers must be valid JSON (e.g. {"X-Title": "MyApp"}).');
        setIsSaving(false);
        return;
      }
    }

    const payload: Partial<ProviderFormData> = {
      id: form.id,
      name: form.name || undefined,
      type: form.type,
      baseURL: form.baseURL || undefined,
      apiKeyEnv: form.apiKeyEnv || undefined,
      apiKey: form.apiKey || undefined,
      costTier: form.costTier,
      priority: form.priority,
      models: parseModels(form.modelsText),
      defaultHeaders,
      enabled: form.enabled,
    };

    try {
      if (editingId) {
        const res = await providersApi.update(editingId, payload);
        setState(res);
      } else {
        const res = await providersApi.create(payload);
        setState(res);
      }
      closeModal();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    try {
      const res = await providersApi.update(id, { enabled: !enabled });
      setState(res);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await providersApi.remove(id);
      setState(res);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setConfirmDeleteId(null);
    }
  };

  // Render

  return (
    <div className="flex flex-col h-full bg-surface-raised">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-overlay">
        <div className="flex items-center gap-2">
          <Plug size={15} className="text-accent" />
          <span className="text-sm font-mono text-gray-300">Provider Registry</span>
          <span className="text-xs text-gray-600 font-mono">({rows.length})</span>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 rounded text-xs font-medium transition-colors"
        >
          <Plus size={12} />
          Add Provider
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loadError && (
          <p className="text-xs text-error font-mono bg-error/10 border-b border-error/20 px-4 py-2">
            ⚠ {loadError}
          </p>
        )}
        {isLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs text-gray-500 font-mono">
            Loading providers...
          </div>
        ) : (
          <table className="w-full text-xs font-mono border-collapse">
            <thead className="sticky top-0 bg-surface-overlay">
              <tr className="text-gray-500 uppercase tracking-wider text-[10px]">
                <th className="text-left px-4 py-2">Provider</th>
                <th className="text-left px-4 py-2">Type</th>
                <th className="text-left px-4 py-2">Cost Tier</th>
                <th className="text-left px-4 py-2">Models</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isDefault = defaultIds.has(row.id);
                const isCustom = customIds.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-surface-overlay hover:bg-surface-elevated transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <p className="text-gray-200 font-medium flex items-center gap-1.5">
                        {row.name}
                        {isDefault && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded border border-surface-overlay text-gray-500">
                            Built-in
                          </span>
                        )}
                      </p>
                      <p className="text-gray-600 text-[10px]">{row.id}</p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{row.type}</td>
                    <td className="px-4 py-2.5">
                      <span className={clsx('w-fit px-2 py-0.5 rounded border text-[10px]', COST_TIER_META[row.costTier].classes)}>
                        {COST_TIER_META[row.costTier].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{row.modelCount}</td>
                    <td className="px-4 py-2.5">
                      {!row.enabled ? (
                        <span className="flex items-center gap-1 text-gray-600">
                          <XCircle size={11} /> Disabled
                        </span>
                      ) : !row.available ? (
                        <span className="flex items-center gap-1 text-gray-500">
                          <ShieldCheck size={11} /> Needs API Key
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle size={11} /> Available
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleEnabled(row.id, row.enabled)}
                          className={clsx('transition-colors', row.enabled ? 'text-gray-500 hover:text-warning' : 'text-gray-600 hover:text-success')}
                          title={row.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                        >
                          {row.enabled ? <PauseCircle size={13} /> : <Plus size={13} />}
                        </button>
                        <button
                          onClick={() => openEdit(row.id)}
                          className="text-gray-500 hover:text-accent transition-colors"
                          title="Edit provider"
                        >
                          <Edit2 size={13} />
                        </button>
                        {isCustom && (
                          confirmDeleteId === row.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(row.id)}
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
                              onClick={() => setConfirmDeleteId(row.id)}
                              className="text-gray-600 hover:text-error transition-colors"
                              title="Delete provider"
                            >
                              <Trash2 size={13} />
                            </button>
                          )
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
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-overlay sticky top-0 bg-surface-raised">
              <div className="flex items-center gap-2">
                <Plug size={15} className="text-accent" />
                <h3 className="text-sm font-mono text-gray-200">
                  {editingId ? 'Edit Provider' : 'New Provider'}
                </h3>
              </div>
              <button onClick={closeModal} className="text-gray-600 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
              <Field label="ID" required hint={editingId ? undefined : 'Lowercase, no spaces — e.g. "openrouter". Cannot be changed later.'}>
                <input
                  type="text"
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="e.g. openrouter"
                  className={inputCls}
                  disabled={!!editingId}
                  required
                />
              </Field>

              <Field label="Display Name">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. OpenRouter"
                  className={inputCls}
                />
              </Field>

              <Field label="Type" required>
                <div className="relative">
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as ProviderType })}
                    className={clsx(inputCls, 'appearance-none pr-8')}
                  >
                    {SELECTABLE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>
              </Field>

              <Field label="Base URL" hint="Required for openai-compatible router providers (OpenRouter, Fireworks, Together, vLLM, ...).">
                <input
                  type="text"
                  value={form.baseURL}
                  onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                  placeholder="https://openrouter.ai/api/v1"
                  className={clsx(inputCls, 'font-mono')}
                />
              </Field>

              <Field label="Environment Variable" hint="Name of the env var holding the API key, e.g. OPENROUTER_API_KEY. Set the actual value in your .env file.">
                <input
                  type="text"
                  value={form.apiKeyEnv}
                  onChange={(e) => setForm({ ...form, apiKeyEnv: e.target.value })}
                  placeholder="OPENROUTER_API_KEY"
                  className={clsx(inputCls, 'font-mono')}
                />
              </Field>

              <Field
                label="API Key"
                hint={editingId
                  ? 'Leave blank to keep the existing key. Stored locally, never shown again.'
                  : 'Optional — pasted here instead of (or in addition to) an env var. Stored locally.'}
              >
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={editingId ? '•••• (unchanged)' : 'sk-...'}
                  className={clsx(inputCls, 'font-mono')}
                  autoComplete="new-password"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Cost Tier">
                  <div className="relative">
                    <select
                      value={form.costTier}
                      onChange={(e) => setForm({ ...form, costTier: e.target.value as CostTier })}
                      className={clsx(inputCls, 'appearance-none pr-8')}
                    >
                      {(Object.keys(COST_TIER_META) as CostTier[]).map((t) => (
                        <option key={t} value={t}>{COST_TIER_META[t].label}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                  </div>
                </Field>

                <Field label="Priority" hint="Higher tries first.">
                  <input
                    type="number"
                    min={0}
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 0 })}
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Models" hint="Comma-separated model IDs this provider serves. Leave blank to auto-discover from its /models endpoint (openai-compatible only).">
                <input
                  type="text"
                  value={form.modelsText}
                  onChange={(e) => setForm({ ...form, modelsText: e.target.value })}
                  placeholder="qwen/qwen3.6-plus:free, meta-llama/llama-3.1-405b-instruct:free"
                  className={clsx(inputCls, 'font-mono')}
                />
              </Field>

              <Field label="Default Headers" hint='Optional JSON object sent with every request, e.g. {"HTTP-Referer": "https://your-app.com"}.'>
                <textarea
                  value={form.headersText}
                  onChange={(e) => setForm({ ...form, headersText: e.target.value })}
                  placeholder={'{\n  "HTTP-Referer": "https://your-app.com"\n}'}
                  rows={3}
                  className={clsx(inputCls, 'font-mono resize-y')}
                />
              </Field>

              <label className="flex items-center gap-2 text-xs font-mono text-gray-400 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="accent-accent"
                />
                Enabled
              </label>

              {saveError && (
                <p className="text-xs text-error font-mono bg-error/10 border border-error/20 rounded px-3 py-2">
                  ⚠ {saveError}
                </p>
              )}

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
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Provider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
