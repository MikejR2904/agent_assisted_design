'use client';

import { useState } from 'react';
import {
  Brain, RefreshCw, ChevronDown, ChevronRight, Sparkles, CheckCircle,
} from 'lucide-react';
import { useProjectStore } from '@/lib/stores/projectStore';
import { useAgentStore } from '@/lib/stores/agentStore';
import { useSessionStore } from '@/lib/stores/sessionStore';
import type { AgentSummary } from '@agent_design/shared/types';
import { clsx } from 'clsx';

// API Call
async function requestSummary(
  projectId: string,
  agentId: string,
  sessionIds: string[],
  messagesForSessions: Record<string, Array<{ role: string; content: string }>>,
): Promise<AgentSummary> {
  const res = await fetch('/api/agents/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, agentId, sessionIds, messagesForSessions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error);
  }
  return res.json() as Promise<AgentSummary>;
}

// Single agent summary card
function AgentSummaryCard({ agentId, projectId }: { agentId: string; projectId: string }) {
  const { agents } = useAgentStore();
  const { getSummary, setSummary } = useProjectStore();
  const { getSessionsByProject } = useSessionStore();

  const agent = agents.find((a) => a.id === agentId);
  const summary = getSummary(projectId, agentId);
  const sessions = getSessionsByProject(projectId);

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const totalMessages = sessions.reduce((acc, s) => acc + s.messages.length, 0);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      // Build message map: sessionId → messages (user+assistant only)
      const messagesForSessions: Record<string, Array<{ role: string; content: string }>> = {};
      sessions.forEach((s) => {
        messagesForSessions[s.id] = s.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }));
      });

      const result = await requestSummary(
        projectId,
        agentId,
        sessions.map((s) => s.id),
        messagesForSessions,
      );
      setSummary(result);
      setExpanded(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!agent) return null;

  return (
    <div className="border border-surface-overlay rounded-lg overflow-hidden">
      {/* Agent header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 bg-surface-elevated cursor-pointer hover:bg-surface-overlay transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Brain size={13} className={clsx(summary ? 'text-accent' : 'text-gray-600')} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-gray-300 truncate">{agent.name}</p>
          <p className="text-[9px] text-gray-600 truncate">{agent.roleDescription}</p>
        </div>
        {summary ? (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <CheckCircle size={11} className="text-success" />
            <span className="text-[9px] text-gray-600 font-mono">
              {new Date(summary.timestamp).toLocaleDateString()}
            </span>
          </div>
        ) : (
          <span className="text-[9px] text-gray-700 font-mono flex-shrink-0">No summary</span>
        )}
        {expanded ? <ChevronDown size={11} className="text-gray-600" /> : <ChevronRight size={11} className="text-gray-600" />}
      </div>

      {expanded && (
        <div className="px-3 py-3 space-y-3 border-t border-surface-overlay">
          {/* Stats row */}
          <div className="flex items-center gap-3 text-[10px] font-mono text-gray-600">
            <span>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{totalMessages} messages</span>
            {summary && (
              <>
                <span>·</span>
                <span className="text-gray-700">{summary.tokensUsed.toLocaleString()} tok summarised</span>
              </>
            )}
          </div>

          {/* Generate / re-generate button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || sessions.length === 0}
            className={clsx(
              'w-full flex items-center justify-center gap-2 py-2 rounded text-xs font-mono transition-colors',
              isGenerating
                ? 'bg-surface-overlay text-gray-500'
                : 'bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30',
            )}
          >
            {isGenerating
              ? <><RefreshCw size={12} className="animate-spin" /> Generating summary…</>
              : <><Sparkles size={12} /> {summary ? 'Regenerate summary' : 'Generate summary'}</>
            }
          </button>

          {error && (
            <p className="text-[10px] text-error font-mono bg-error/10 rounded px-2.5 py-1.5">⚠ {error}</p>
          )}

          {/* Summary prose */}
          {summary && (
            <div className="space-y-1">
              <p className="text-[10px] font-mono text-gray-500">Summary</p>
              <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed bg-surface rounded p-2.5 overflow-x-auto">
                {summary.summaryText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Root panel
export function AgentSummaryPanel() {
  const { getActiveProject } = useProjectStore();
  const { agents } = useAgentStore();

  const project = getActiveProject();
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 px-4 opacity-40">
        <Brain size={20} className="text-gray-600" />
        <p className="text-[10px] text-gray-500 font-mono text-center">
          Select a project to view agent summaries
        </p>
      </div>
    );
  }

  // Show agents scoped to this project, fallback to all agents
  const projectAgents = project.agentIds.length > 0
    ? agents.filter((a) => project.agentIds.includes(a.id))
    : agents;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2.5 border-b border-surface-overlay flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Brain size={12} className="text-accent" />
          <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Agent Memory</span>
        </div>
        <p className="text-[9px] text-gray-600 font-mono mt-1">
          Project: <span className="text-gray-400">{project.name}</span>
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {projectAgents.length === 0 ? (
          <p className="text-[10px] text-gray-700 font-mono text-center py-4">
            No agents linked to this project.<br/>Add agents via Project Settings.
          </p>
        ) : (
          projectAgents.map((agent) => (
            <AgentSummaryCard key={agent.id} agentId={agent.id} projectId={project.id} />
          ))
        )}
      </div>
    </div>
  );
}