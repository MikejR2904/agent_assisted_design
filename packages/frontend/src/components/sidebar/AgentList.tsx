'use client';

import { Brain, Zap, Shield, AlertOctagon, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useAgentStore } from '@/lib/stores/agentStore';
import type { AgentConfig } from '@agent_design/shared/types';
import { clsx } from 'clsx';

const STATUS_CONFIG: Record<
  AgentConfig['status'],
  { icon: React.ReactNode; label: string; dotClass: string }
> = {
  active:              { icon: <CheckCircle size={10} />,               label: 'Active',    dotClass: 'bg-success' },
  idle:                { icon: <Clock size={10} />,                      label: 'Idle',      dotClass: 'bg-gray-600' },
  thinking:            { icon: <Brain size={10} className="animate-pulse" />, label: 'Thinking', dotClass: 'bg-accent animate-pulse' },
  'awaiting-approval': { icon: <Shield size={10} />,                    label: 'Waiting',   dotClass: 'bg-warning animate-pulse' },
  error:               { icon: <XCircle size={10} />,                   label: 'Error',     dotClass: 'bg-error' },
};

const PERM_ICON: Record<AgentConfig['permissionLevel'], React.ReactNode> = {
  'auto-execute': <Zap size={10} className="text-success" />,
  'ask-user':     <Shield size={10} className="text-warning" />,
  blocked:        <AlertOctagon size={10} className="text-error" />,
};

interface AgentListProps {
  onManageClick: () => void;
}

export function AgentList({ onManageClick }: AgentListProps) {
  const { agents } = useAgentStore();

  const activeAgents = agents.filter(
    (a) => a.status === 'thinking' || a.status === 'awaiting-approval',
  );

  return (
    <div className="flex flex-col">
      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-overlay">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 font-mono uppercase tracking-wider">
          <Brain size={12} className="text-accent" />
          Agents
          {activeAgents.length > 0 && (
            <span className="ml-1 px-1.5 py-0 rounded-full bg-accent/20 text-accent text-[10px] font-bold">
              {activeAgents.length}
            </span>
          )}
        </div>
        <button
          onClick={onManageClick}
          className="text-[10px] font-mono text-gray-600 hover:text-accent transition-colors"
        >
          Manage →
        </button>
      </div>

      {/* Agent rows */}
      <div className="py-1">
        {agents.length === 0 ? (
          <p className="text-[10px] text-gray-600 font-mono px-3 py-2">No agents configured</p>
        ) : (
          agents.map((agent) => {
            const status = STATUS_CONFIG[agent.status];
            return (
              <div
                key={agent.id}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-overlay transition-colors"
              >
                {/* Status dot */}
                <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', status.dotClass)} />

                {/* Name + role */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 font-mono truncate">{agent.name}</p>
                  <p className="text-[10px] text-gray-600 truncate">{agent.roleDescription}</p>
                </div>

                {/* Permission icon */}
                <div title={agent.permissionLevel} className="flex-shrink-0">
                  {PERM_ICON[agent.permissionLevel]}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}