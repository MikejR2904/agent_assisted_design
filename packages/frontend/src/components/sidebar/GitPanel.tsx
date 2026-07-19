'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Minus, Sparkles, GitCommit, RefreshCw, Eye, History } from 'lucide-react';
import { gitApi, type GitFileStatus, type GitLogEntry } from '@/lib/api/client';
import { useTelemetryStore } from '@/lib/stores/telemetryStore';
import { DiffViewerModal } from '@/components/DiffViewerModal';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';

const STATUS_DOT: Record<GitFileStatus['status'], string> = {
  staged: 'bg-success',
  modified: 'bg-warning',
  untracked: 'bg-gray-500',
  deleted: 'bg-error',
};

export function GitPanel() {
  const { condition } = useTelemetryStore();
  const [entries, setEntries] = useState<GitFileStatus[]>([]);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [message, setMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!condition) return;
    try {
      const [statusRes, logRes] = await Promise.all([
        gitApi.status(condition),
        gitApi.log(condition).catch(() => ({ entries: [] })),
      ]);
      setEntries(statusRes.entries);
      setLog(logRes.entries);
    } catch (err) {
      console.error('Git status refresh failed', err);
    } finally {
      setIsLoading(false);
    }
  }, [condition]);

  useEffect(() => {
    setIsLoading(true);
    refresh();
  }, [refresh]);

  const staged = entries.filter((e) => e.status === 'staged');
  const unstaged = entries.filter((e) => e.status !== 'staged');

  const handleStage = async (path: string) => {
    if (!condition) return;
    await gitApi.stage(condition, [path]);
    refresh();
  };

  const handleUnstage = async (path: string) => {
    if (!condition) return;
    await gitApi.unstage(condition, [path]);
    refresh();
  };

  const handleStageAll = async () => {
    if (!condition || unstaged.length === 0) return;
    await gitApi.stage(condition, unstaged.map((e) => e.path));
    refresh();
  };

  const handleGenerateMessage = async () => {
    if (!condition) return;
    setIsGenerating(true);
    try {
      const { message: generated } = await gitApi.generateCommitMessage(condition);
      setMessage(generated);
    } catch (err) {
      toast.error(`Couldn't generate a message: ${(err as Error).message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCommit = async () => {
    if (!condition || !message.trim() || staged.length === 0) return;
    setIsCommitting(true);
    try {
      await gitApi.commit(condition, message.trim());
      setMessage('');
      toast.success('Committed');
      refresh();
    } catch (err) {
      toast.error(`Commit failed: ${(err as Error).message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  if (!condition) {
    return <p className="text-xs text-gray-600 font-mono px-3 py-2">Initialize workspace first</p>;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-overlay">
        <span className="text-xs font-mono text-gray-400 uppercase tracking-wider">Source Control</span>
        <button onClick={refresh} title="Refresh" className="text-gray-600 hover:text-accent transition-colors">
          <RefreshCw size={12} className={clsx(isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Commit box */}
      <div className="px-3 py-2 border-b border-surface-overlay space-y-1.5">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message…"
          rows={2}
          className="w-full bg-surface-elevated text-white text-xs font-mono placeholder:text-gray-600 px-2 py-1.5 rounded border border-surface-overlay focus:outline-none focus:border-accent/50 resize-none"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleGenerateMessage}
            disabled={isGenerating}
            title="Generate with AI"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-accent bg-accent/10 hover:bg-accent/20 transition-colors disabled:opacity-40"
          >
            {isGenerating ? <RefreshCw size={10} className="animate-spin" /> : <Sparkles size={10} />}
            Generate
          </button>
          <button
            onClick={handleCommit}
            disabled={isCommitting || !message.trim() || staged.length === 0}
            title="Commit staged changes"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-white bg-accent hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:bg-surface-overlay ml-auto"
          >
            <GitCommit size={10} />
            Commit ({staged.length})
          </button>
        </div>
      </div>

      {/* Staged */}
      {staged.length > 0 && (
        <div className="px-3 py-2 border-b border-surface-overlay">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Staged ({staged.length})</p>
          {staged.map((e) => (
            <FileRow key={e.path} entry={e} onToggle={() => handleUnstage(e.path)} onView={() => setDiffPath(e.path)} toggleIcon={<Minus size={11} />} toggleTitle="Unstage" />
          ))}
        </div>
      )}

      {/* Changes */}
      <div className="px-3 py-2 border-b border-surface-overlay">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Changes ({unstaged.length})</p>
          {unstaged.length > 0 && (
            <button onClick={handleStageAll} className="text-[10px] text-accent hover:text-accent-hover font-mono">
              Stage all
            </button>
          )}
        </div>
        {isLoading ? (
          <p className="text-[10px] text-gray-600 font-mono">Loading…</p>
        ) : unstaged.length === 0 ? (
          <p className="text-[10px] text-gray-600 font-mono">No changes</p>
        ) : (
          unstaged.map((e) => (
            <FileRow key={e.path} entry={e} onToggle={() => handleStage(e.path)} onView={() => setDiffPath(e.path)} toggleIcon={<Plus size={11} />} toggleTitle="Stage" />
          ))
        )}
      </div>

      {/* History */}
      <div className="px-3 py-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
          <History size={10} /> History
        </p>
        {log.length === 0 ? (
          <p className="text-[10px] text-gray-600 font-mono">No commits yet</p>
        ) : (
          <div className="space-y-1.5">
            {log.slice(0, 20).map((c) => (
              <div key={c.hash} className="text-[10px] font-mono">
                <p className="text-gray-300 truncate">{c.message}</p>
                <p className="text-gray-600">{c.hash} · {c.author} · {new Date(c.date).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {diffPath && condition && (
        <DiffViewerModal condition={condition} path={diffPath} onClose={() => setDiffPath(null)} />
      )}
    </div>
  );
}

function FileRow({
  entry, onToggle, onView, toggleIcon, toggleTitle,
}: {
  entry: GitFileStatus;
  onToggle: () => void;
  onView: () => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
}) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 group">
      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_DOT[entry.status])} title={entry.status} />
      <span className="text-xs font-mono text-gray-400 truncate flex-1">{entry.path}</span>
      <button onClick={onView} title="View diff" className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-accent transition-opacity">
        <Eye size={11} />
      </button>
      <button onClick={onToggle} title={toggleTitle} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-accent transition-opacity">
        {toggleIcon}
      </button>
    </div>
  );
}
