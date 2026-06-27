'use client';

import { useState } from 'react';
import {
  FolderOpen, Folder, Plus, MessageSquare, ChevronRight, ChevronDown,
  Trash2, Edit2, Check, X, Settings, Inbox,
} from 'lucide-react';
import { useProjectStore } from '@/lib/stores/projectStore';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { useAgentStore } from '@/lib/stores/agentStore';
import type { Project, ExperimentalCondition } from '@agent_design/shared/types';
import { EXPERIMENTAL_CONDITIONS } from '@agent_design/shared/constants';
import { clsx } from 'clsx';

// Helpers
function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(d / 3_600_000);
  if (h < 24) return `${h}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

const CONDITION_SHORT: Record<ExperimentalCondition, string> = {
  manual: 'MAN', nhil: 'NHIL', hitl: 'HITL', 'agent-assisted': 'AGT',
};
const CONDITION_CLS: Record<ExperimentalCondition, string> = {
  manual: 'bg-gray-700 text-gray-400',
  nhil: 'bg-purple-900/50 text-purple-300',
  hitl: 'bg-blue-900/50 text-blue-300',
  'agent-assisted': 'bg-accent/20 text-accent',
};

// New Project modal
function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const { createProject } = useProjectStore();

  const handleCreate = () => {
    if (!name.trim()) return;
    createProject(name, desc);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-raised border border-surface-overlay rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-overlay">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-accent" />
            <span className="text-sm font-mono text-gray-200">New Project</span>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white"><X size={14} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[10px] font-mono text-gray-500 mb-1.5 uppercase tracking-wider">Name *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Tensor PE Design"
              className="w-full bg-surface border border-surface-overlay text-gray-200 text-xs font-mono px-3 py-2 rounded focus:outline-none focus:border-accent/60 placeholder:text-gray-700"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-gray-500 mb-1.5 uppercase tracking-wider">Description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional: goals, constraints, design notes…"
              rows={2}
              className="w-full bg-surface border border-surface-overlay text-gray-200 text-xs font-mono px-3 py-2 rounded focus:outline-none focus:border-accent/60 placeholder:text-gray-700 resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-overlay">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-gray-500 hover:text-white border border-surface-overlay rounded transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-40 transition-colors"
          >
            <Plus size={12} /> Create
          </button>
        </div>
      </div>
    </div>
  );
}

// Project settings panel
function ProjectSettings({ project, onClose }: { project: Project; onClose: () => void }) {
  const { updateProject, addAgentToProject, removeAgentFromProject } = useProjectStore();
  const { agents } = useAgentStore();
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description);
  const [condition, setCondition] = useState<ExperimentalCondition>(project.condition);

  const save = () => {
    updateProject(project.id, { name, description: desc, condition });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-raised border border-surface-overlay rounded-xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-overlay sticky top-0 bg-surface-raised">
          <div className="flex items-center gap-2">
            <Settings size={13} className="text-accent" />
            <span className="text-sm font-mono text-gray-200">Project Settings</span>
          </div>
          <button onClick={onClose}><X size={14} className="text-gray-600 hover:text-white" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Color dot */}
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: project.color }} />
            <span className="text-[10px] text-gray-600 font-mono">Project color (auto-assigned)</span>
          </div>

          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>

          <Field label="Description">
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className={clsx(inputCls, 'resize-none')} />
          </Field>

          <Field label="Default Condition">
            <select value={condition} onChange={(e) => setCondition(e.target.value as ExperimentalCondition)} className={clsx(inputCls, 'appearance-none')}>
              {Object.values(EXPERIMENTAL_CONDITIONS).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Scoped Agents">
            <div className="space-y-1.5">
              {agents.length === 0
                ? <p className="text-[10px] text-gray-600 font-mono">No agents configured</p>
                : agents.map((agent) => {
                    const isLinked = project.agentIds.includes(agent.id);
                    return (
                      <label key={agent.id} className="flex items-center gap-2 cursor-pointer group">
                        <div
                          className={clsx(
                            'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                            isLinked ? 'bg-accent border-accent' : 'border-gray-600 group-hover:border-gray-400',
                          )}
                          onClick={() =>
                            isLinked
                              ? removeAgentFromProject(project.id, agent.id)
                              : addAgentToProject(project.id, agent.id)
                          }
                        >
                          {isLinked && <Check size={10} className="text-white" />}
                        </div>
                        <span className="text-[11px] font-mono text-gray-400">{agent.name}</span>
                        <span className="text-[9px] text-gray-600 truncate">{agent.roleDescription}</span>
                      </label>
                    );
                  })}
            </div>
          </Field>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-overlay">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-gray-500 border border-surface-overlay rounded hover:text-white">Cancel</button>
          <button onClick={save} className="px-3 py-1.5 text-xs font-mono bg-accent hover:bg-accent-hover text-white rounded">Save</button>
        </div>
      </div>
    </div>
  );
}

// Session row
function SessionRow({
  session, isActive, onSelect, onDelete, onRename,
}: {
  session: { id: string; title: string; condition: ExperimentalCondition; currentGate: string; updatedAt: string; messages: unknown[] };
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(session.title);
  const [confirmDel, setConfirmDel] = useState(false);

  const commit = () => {
    if (val.trim()) onRename(val.trim());
    setEditing(false);
  };

  return (
    <div
      onClick={!editing ? onSelect : undefined}
      className={clsx(
        'group relative flex flex-col gap-0.5 pl-8 pr-3 py-2 cursor-pointer border-b border-surface-overlay/50 transition-colors',
        isActive ? 'bg-accent/8 border-l-2 border-l-accent' : 'hover:bg-surface-elevated border-l-2 border-l-transparent',
      )}
    >
      <div className="flex items-start gap-1.5 min-w-0">
        <MessageSquare size={10} className={clsx('flex-shrink-0 mt-0.5', isActive ? 'text-accent' : 'text-gray-700')} />
        {editing ? (
          <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
              className="flex-1 min-w-0 bg-surface border border-accent/40 rounded px-1.5 py-0.5 text-[10px] font-mono text-white focus:outline-none"
            />
            <button onClick={commit}><Check size={10} className="text-success" /></button>
            <button onClick={() => setEditing(false)}><X size={10} className="text-gray-500" /></button>
          </div>
        ) : (
          <span className={clsx('text-[11px] font-mono truncate', isActive ? 'text-gray-200' : 'text-gray-500')}>{session.title}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 pl-3.5">
        <span className={clsx('text-[9px] font-mono px-1 rounded', CONDITION_CLS[session.condition])}>{CONDITION_SHORT[session.condition]}</span>
        <span className="text-[9px] text-gray-700 font-mono">{session.currentGate}</span>
        <span className="text-[9px] text-gray-700 font-mono">·</span>
        <span className="text-[9px] text-gray-700 font-mono">{(session.messages as unknown[]).length}msg</span>
        <span className="text-[9px] text-gray-700 font-mono ml-auto">{relTime(session.updatedAt)}</span>
      </div>
      {!editing && (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-surface-raised rounded pl-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setVal(session.title); setEditing(true); }} className="p-1 text-gray-600 hover:text-gray-300"><Edit2 size={10} /></button>
          {confirmDel
            ? <><button onClick={onDelete} className="text-[9px] text-error font-mono px-1">del?</button><button onClick={() => setConfirmDel(false)}><X size={9} className="text-gray-600" /></button></>
            : <button onClick={() => setConfirmDel(true)} className="p-1 text-gray-600 hover:text-error"><Trash2 size={10} /></button>
          }
        </div>
      )}
    </div>
  );
}

// Project group 
function ProjectGroup({ project }: { project: Project }) {
  const [expanded, setExpanded] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const { activeSessionId, switchSession, deleteSession, renameSession, getSessionsByProject, createSession } = useSessionStore();
  const { deleteProject, setActiveProject, activeProjectId } = useProjectStore();

  const sessions = getSessionsByProject(project.id);
  const isActiveProject = project.id === activeProjectId;

  const handleNewSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveProject(project.id);
    createSession({ condition: project.condition, projectId: project.id });
  };

  return (
    <div className="border-b border-surface-overlay last:border-0">
      {/* Project header row */}
      <div
        className={clsx(
          'flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-surface-elevated transition-colors group',
          isActiveProject && 'bg-surface-elevated',
        )}
        onClick={() => { setActiveProject(project.id); setExpanded(!expanded); }}
      >
        <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: project.color }} />
        <button className="flex-shrink-0 text-gray-600" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {expanded ? <FolderOpen size={12} className="text-gray-400 flex-shrink-0" /> : <Folder size={12} className="text-gray-500 flex-shrink-0" />}
        <span className="text-[11px] font-mono text-gray-300 truncate flex-1">{project.name}</span>
        <span className="text-[9px] text-gray-600 font-mono">{sessions.length}</span>

        {/* Actions — appear on hover */}
        <div className="hidden group-hover:flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={handleNewSession} className="p-1 text-gray-600 hover:text-accent" title="New session in project">
            <Plus size={11} />
          </button>
          <button onClick={() => setShowSettings(true)} className="p-1 text-gray-600 hover:text-gray-300" title="Project settings">
            <Settings size={11} />
          </button>
          {confirmDel
            ? <><button onClick={() => deleteProject(project.id)} className="text-[9px] text-error font-mono px-1">del?</button><button onClick={() => setConfirmDel(false)}><X size={9} className="text-gray-600" /></button></>
            : <button onClick={() => setConfirmDel(true)} className="p-1 text-gray-600 hover:text-error"><Trash2 size={11} /></button>
          }
        </div>
      </div>

      {/* Session list */}
      {expanded && (
        <div>
          {sessions.length === 0 ? (
            <div
              className="pl-8 pr-3 py-2 text-[10px] text-gray-700 font-mono cursor-pointer hover:text-gray-500"
              onClick={handleNewSession}
            >
              + Start first session
            </div>
          ) : (
            sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={s.id === activeSessionId}
                onSelect={() => switchSession(s.id)}
                onDelete={() => deleteSession(s.id)}
                onRename={(t) => renameSession(s.id, t)}
              />
            ))
          )}
        </div>
      )}

      {showSettings && (
        <ProjectSettings project={project} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// Inbox: unaffiliated sessions
function InboxGroup() {
  const [expanded, setExpanded] = useState(true);
  const { activeSessionId, switchSession, deleteSession, renameSession, getUnaffiliatedSessions } = useSessionStore();
  const sessions = getUnaffiliatedSessions();

  if (sessions.length === 0) return null;

  return (
    <div className="border-b border-surface-overlay">
      <div
        className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-surface-elevated transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={11} className="text-gray-600" /> : <ChevronRight size={11} className="text-gray-600" />}
        <Inbox size={12} className="text-gray-500 flex-shrink-0" />
        <span className="text-[11px] font-mono text-gray-500 flex-1">Inbox</span>
        <span className="text-[9px] text-gray-600 font-mono">{sessions.length}</span>
      </div>
      {expanded && sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          isActive={s.id === activeSessionId}
          onSelect={() => switchSession(s.id)}
          onDelete={() => deleteSession(s.id)}
          onRename={(t) => renameSession(s.id, t)}
        />
      ))}
    </div>
  );
}

// Root component
export function ProjectSidebar() {
  const [showNewProject, setShowNewProject] = useState(false);
  const { projects } = useProjectStore();
  const { createSession, activeCondition } = useSessionStore();

  return (
    <div className="flex flex-col h-full bg-surface-raised overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-overlay flex-shrink-0">
        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Projects</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => createSession({ condition: activeCondition, projectId: undefined })}
            className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
            title="New unaffiliated session"
          >
            <MessageSquare size={12} />
          </button>
          <button
            onClick={() => setShowNewProject(true)}
            className="flex items-center gap-1 px-1.5 py-1 rounded bg-accent/15 hover:bg-accent/25 text-accent text-[10px] font-mono transition-colors"
            title="New project"
          >
            <Plus size={11} /> Project
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 opacity-40">
            <Folder size={22} className="text-gray-600" />
            <p className="text-[10px] text-gray-500 font-mono text-center">
              No projects yet.<br/>Create one to group sessions.
            </p>
          </div>
        )}
        {projects.map((p) => <ProjectGroup key={p.id} project={p} />)}
        <InboxGroup />
      </div>

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  );
}

// Helpers
const inputCls = 'w-full bg-surface border border-surface-overlay text-gray-200 text-xs font-mono px-3 py-2 rounded focus:outline-none focus:border-accent/60 placeholder:text-gray-600';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-mono text-gray-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}