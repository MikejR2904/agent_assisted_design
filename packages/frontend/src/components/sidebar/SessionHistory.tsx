'use client';

import { useState } from 'react';
import {
  MessageSquare, Plus, Trash2, Edit2, Check, X, ChevronDown,
} from 'lucide-react';
import { useSessionStore } from '@/lib/stores/sessionStore';
import type { ChatSession } from '@/lib/stores/sessionStore';
import type { ExperimentalCondition } from '@agent_design/shared/types';
import { EXPERIMENTAL_CONDITIONS } from '@agent_design/shared/constants';
import { clsx } from 'clsx';

const CONDITION_BADGES: Record<ExperimentalCondition, { label: string; cls: string }> = {
  manual:           { label: 'MAN',   cls: 'bg-gray-700 text-gray-300' },
  nhil:             { label: 'NHIL',  cls: 'bg-purple-900/60 text-purple-300' },
  hitl:             { label: 'HITL',  cls: 'bg-blue-900/60 text-blue-300' },
  'agent-assisted': { label: 'AGENT', cls: 'bg-accent/20 text-accent' },
};

const GATE_COLORS: Record<string, string> = {
  G1: 'text-gray-500',
  G2: 'text-blue-400',
  G3: 'text-yellow-400',
  G4: 'text-green-400',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

interface SessionRowProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}

function SessionRow({ session, isActive, onSelect, onDelete, onRename }: SessionRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title);
  const [showDelete, setShowDelete] = useState(false);
  const badge = CONDITION_BADGES[session.condition];

  const commitRename = () => {
    if (editValue.trim()) onRename(editValue.trim());
    setIsEditing(false);
  };

  return (
    <div
      className={clsx(
        'group relative flex flex-col gap-0.5 px-3 py-2.5 cursor-pointer border-b border-surface-overlay transition-colors',
        isActive
          ? 'bg-accent/8 border-l-2 border-l-accent'
          : 'hover:bg-surface-elevated border-l-2 border-l-transparent',
      )}
      onClick={!isEditing ? onSelect : undefined}
    >
      {/* Title row */}
      <div className="flex items-start gap-1.5 min-w-0">
        <MessageSquare
          size={11}
          className={clsx('flex-shrink-0 mt-0.5', isActive ? 'text-accent' : 'text-gray-600')}
        />
        {isEditing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setIsEditing(false);
              }}
              className="flex-1 min-w-0 bg-surface border border-accent/40 rounded px-1.5 py-0.5 text-[11px] font-mono text-white focus:outline-none"
            />
            <button onClick={commitRename} className="text-success flex-shrink-0"><Check size={11} /></button>
            <button onClick={() => setIsEditing(false)} className="text-gray-500 flex-shrink-0"><X size={11} /></button>
          </div>
        ) : (
          <span className={clsx(
            'text-[11px] font-mono truncate leading-tight',
            isActive ? 'text-gray-200' : 'text-gray-400',
          )}>
            {session.title}
          </span>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 pl-[19px]">
        <span className={clsx('text-[9px] font-mono px-1 rounded', badge.cls)}>
          {badge.label}
        </span>
        <span className={clsx('text-[9px] font-mono', GATE_COLORS[session.currentGate])}>
          {session.currentGate}
        </span>
        {session.totalTokens > 0 && (
          <span className="text-[9px] text-gray-600 font-mono">
            {session.totalTokens > 999 ? `${Math.round(session.totalTokens / 1000)}k` : session.totalTokens}tok
          </span>
        )}
        <span className="text-[9px] text-gray-700 font-mono ml-auto">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </div>

      {/* Action buttons — appear on hover */}
      {!isEditing && (
        <div
          className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-surface-raised pl-1 rounded"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { setEditValue(session.title); setIsEditing(true); }}
            className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
            title="Rename"
          >
            <Edit2 size={11} />
          </button>
          {showDelete ? (
            <>
              <button onClick={onDelete} className="p-1 text-error text-[9px] font-mono">del?</button>
              <button onClick={() => setShowDelete(false)} className="p-1 text-gray-600"><X size={10} /></button>
            </>
          ) : (
            <button
              onClick={() => setShowDelete(true)}
              className="p-1 text-gray-600 hover:text-error transition-colors"
              title="Delete session"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Condition selector ───────────────────────────────────────────────────────

function ConditionSelector() {
  const { activeCondition, setCondition } = useSessionStore();
  const [open, setOpen] = useState(false);
  const meta = EXPERIMENTAL_CONDITIONS[activeCondition];

  return (
    <div className="relative px-3 py-2 border-b border-surface-overlay">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2 py-1.5 bg-surface rounded border border-surface-overlay text-[11px] font-mono text-gray-400 hover:border-gray-600 transition-colors"
      >
        <span className="truncate text-gray-300">{meta.label}</span>
        <ChevronDown size={11} className="flex-shrink-0 text-gray-600" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-3 right-3 top-full mt-1 bg-surface-raised border border-surface-overlay rounded-lg shadow-xl z-20 overflow-hidden">
            {Object.values(EXPERIMENTAL_CONDITIONS).map((c) => (
              <button
                key={c.id}
                onClick={() => { setCondition(c.id as ExperimentalCondition); setOpen(false); }}
                className={clsx(
                  'w-full text-left px-3 py-2 hover:bg-surface-elevated transition-colors',
                  activeCondition === c.id && 'bg-accent/5',
                )}
              >
                <p className={clsx('text-[11px] font-mono', activeCondition === c.id ? 'text-accent' : 'text-gray-300')}>
                  {c.label}
                </p>
                <p className="text-[9px] text-gray-600 mt-0.5">{c.description}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SessionHistory() {
  const {
    sessions, activeSessionId,
    createSession, switchSession, deleteSession, renameSession, activeCondition,
  } = useSessionStore();

  const handleNew = () => createSession({ condition: activeCondition });

  return (
    <div className="flex flex-col h-full bg-surface-raised">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-overlay flex-shrink-0">
        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Sessions</span>
        <button
          onClick={handleNew}
          className="flex items-center gap-1 px-2 py-1 rounded bg-accent/15 hover:bg-accent/25 text-accent text-[10px] font-mono transition-colors"
          title="New session"
        >
          <Plus size={11} />
          New
        </button>
      </div>

      {/* Condition picker */}
      <ConditionSelector />

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-40">
            <MessageSquare size={20} className="text-gray-600" />
            <p className="text-[10px] text-gray-500 font-mono text-center">
              No sessions yet.<br />Send a message to start.
            </p>
          </div>
        ) : (
          sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              onSelect={() => switchSession(s.id)}
              onDelete={() => deleteSession(s.id)}
              onRename={(title) => renameSession(s.id, title)}
            />
          ))
        )}
      </div>
    </div>
  );
}
