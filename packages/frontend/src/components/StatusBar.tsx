'use client';

import { Wifi, WifiOff, Terminal, PanelLeftClose, PanelRightClose, Zap, Brain } from 'lucide-react';
import { useAgentStore } from '@/lib/stores/agentStore';
import { useTelemetryStore } from '@/lib/stores/telemetryStore';
import { useChatStore } from '@/lib/stores/chatStore';
import { clsx } from 'clsx';

interface StatusBarProps {
  showTerminal: boolean;
  onToggleTerminal: () => void;
  leftCollapsed: boolean;
  onToggleLeft: () => void;
  rightCollapsed: boolean;
  onToggleRight: () => void;
  activeFileEOL: 'LF' | 'CRLF' | null;
}

export function StatusBar({
  showTerminal, onToggleTerminal, leftCollapsed, onToggleLeft, rightCollapsed, onToggleRight, activeFileEOL,
}: StatusBarProps) {
  const { agents, activeAgentId } = useAgentStore();
  const { metrics, currentGate } = useTelemetryStore();
  const { connectionError } = useChatStore();

  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const isConnected = !connectionError;

  return (
    <div className="flex items-center justify-between px-3 h-6 bg-surface-raised border-t border-surface-overlay text-[10px] font-mono text-gray-500 flex-shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className={clsx('flex items-center gap-1', isConnected ? 'text-success' : 'text-error')} title={connectionError ?? 'Connected'}>
          {isConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
        {activeAgent && (
          <span className="flex items-center gap-1 truncate" title="Active agent">
            <Brain size={11} className="text-accent flex-shrink-0" />
            {activeAgent.name}
          </span>
        )}
        <span title="Gate progress">Gate: <span className="text-accent">{currentGate}</span></span>
        <span className="flex items-center gap-1" title="Total tokens used this session">
          <Zap size={11} />
          {(metrics?.totalTokens ?? 0).toLocaleString()} tokens
        </span>
      </div>

      <div className="flex items-center gap-3">
        {activeFileEOL && <span title="Line ending">{activeFileEOL}</span>}
        <button
          onClick={onToggleTerminal}
          title="Toggle terminal"
          className={clsx('hover:text-accent transition-colors', showTerminal && 'text-accent')}
        >
          <Terminal size={11} />
        </button>
        <button
          onClick={onToggleLeft}
          title={leftCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hover:text-accent transition-colors"
        >
          <PanelLeftClose size={11} />
        </button>
        <button
          onClick={onToggleRight}
          title={rightCollapsed ? 'Expand panel' : 'Collapse panel'}
          className="hover:text-accent transition-colors"
        >
          <PanelRightClose size={11} />
        </button>
      </div>
    </div>
  );
}
