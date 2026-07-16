'use client';

import { useState, useEffect } from 'react';
import {
  RefreshCw, ChevronDown,
  LayoutPanelLeft, MessageSquare, Code2, Users, Plug,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { GateStepper } from '@/components/panels/GateStepper';
import { TelemetryPanel } from '@/components/panels/TelemetryPanel';
const TerminalPanel = dynamic(
  () => import('@/components/panels/TerminalPanel').then((mod) => mod.TerminalPanel),
  { ssr: false }
);
import { AgentSummaryPanel } from '@/components/panels/AgentSummaryPanel';
import { ChatArea } from '@/components/chat/ChatArea';
import { FileExplorer } from '@/components/sidebar/FileExplorer';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { AgentList } from '@/components/sidebar/AgentList';
import { AgentManager } from '@/components/AgentManager';
import { ProviderManager } from '@/components/ProviderManager';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { useAgentStore } from '@/lib/stores/agentStore';
import { useConfigStore } from '@/lib/stores/configStore';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { useTelemetryStore } from '@/lib/stores/telemetryStore';
import { filesApi } from '@/lib/api/client';
import type { ExperimentalCondition } from '@agent_design/shared/types';
import { EXPERIMENTAL_CONDITIONS } from '@agent_design/shared/constants';
import { clsx } from 'clsx';

// Layout tab type
type CenterTab = 'chat' | 'editor';
type SidebarTab = 'files' | 'agents' | 'projects';
type RightTab = 'telemetry' | 'memory';

// Condition selector
const CONDITIONS = Object.values(EXPERIMENTAL_CONDITIONS);

export default function WorkbenchPage() {
  const [centerTab, setCenterTab] = useState<CenterTab>('chat');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [rightTab, setRightTab] = useState<RightTab>('telemetry');
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [showProviderManager, setShowProviderManager] = useState(false);
  const [showConditionMenu, setShowConditionMenu] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; locked: boolean } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);

  const { agents, fetchAgents } = useAgentStore();
  const { setCondition, sessionId } = useConfigStore();
  const { getActiveSession, activeCondition } = useSessionStore();
  const session = getActiveSession();
  const { setCondition: setTelemetryCondition } = useTelemetryStore();

  const [isMounted, setIsMounted] = useState(false);

  // Hydrate agents on mount
  useEffect(() => {
    void fetchAgents();
    setIsMounted(true);
  }, [fetchAgents]);

  // Handlers

  const handleSelectCondition = (c: ExperimentalCondition) => {
    setCondition(c);
    setTelemetryCondition(c);
    setShowConditionMenu(false);
  };

  const handleFileSelect = async (path: string) => {
    if (!activeCondition) return;
    setLoadingFile(true);
    setCenterTab('editor');
    try {
      // Determine if it's a config file (locked) or workspace file
      if (path === 'architecture.toml' || path === 'gates.json') {
        const result = await filesApi.readConfig(path);
        setSelectedFile({ path, content: result.content, locked: result.locked });
      } else {
        const result = await filesApi.read(path, activeCondition);
        setSelectedFile({ path, content: result.content, locked: false });
      }
    } catch (err) {
      console.error('Failed to read file', err);
    } finally {
      setLoadingFile(false);
    }
  };

  const activeConditionMeta = EXPERIMENTAL_CONDITIONS[activeCondition as keyof typeof EXPERIMENTAL_CONDITIONS];

  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2 bg-surface-raised border-b border-surface-overlay flex-shrink-0 h-11">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Code2 size={16} className="text-accent" />
            <span className="text-sm font-mono text-gray-200 font-medium tracking-tight">
              RTL Workbench
            </span>
          </div>
          <span className="text-gray-700">|</span>
          <span className="text-xs text-gray-500 font-mono hidden sm:block">
            Human-Agent Collaboration
          </span>
        </div>

        {/* Active session info */}
        <div className="flex items-center gap-3">
          {isMounted && session ? (
            <div className="flex items-center gap-2 text-[10px] font-mono text-gray-600">
              <span className="text-gray-500 truncate max-w-[200px]">{session.title}</span>
              <span className="text-surface-overlay">·</span>
              <span className="text-accent">{session.condition}</span>
            </div>
          ) : (
            <span className="text-[10px] font-mono text-gray-700">No active session</span>
          )}
        </div>

        {/* Center: condition selector */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowConditionMenu(!showConditionMenu)}
              className="flex items-center gap-2 px-3 py-1.5 bg-surface-elevated border border-surface-overlay rounded text-xs font-mono text-gray-300 hover:border-gray-500 transition-colors"
            >
              <span className="text-gray-500">Condition:</span>
              <span className="text-accent">{activeConditionMeta.label}</span>
              <ChevronDown size={11} className="text-gray-500" />
            </button>

            {showConditionMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowConditionMenu(false)}
                />
                <div className="absolute top-full left-0 mt-1 w-72 bg-surface-raised border border-surface-overlay rounded-lg shadow-xl z-20 overflow-hidden">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelectCondition(c.id as ExperimentalCondition)}
                      className={clsx(
                        'w-full text-left px-4 py-3 hover:bg-surface-elevated transition-colors border-b border-surface-overlay last:border-0',
                        activeCondition === c.id && 'bg-accent/5',
                      )}
                    >
                      <p className={clsx('text-xs font-mono font-medium', activeCondition === c.id ? 'text-accent' : 'text-gray-300')}>
                        {c.label}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{c.description}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Init workspace button */}
          {/* <button
            onClick={handleInitWorkspace}
            disabled={isInitializing}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              isInitialized
                ? 'bg-surface-elevated border border-surface-overlay text-gray-400 hover:border-warning hover:text-warning'
                : 'bg-accent hover:bg-accent-hover text-white',
            )}
            title={isInitialized ? 'Re-initialize (resets workspace)' : 'Initialize workspace'}
          >
            {isInitializing
              ? <RefreshCw size={12} className="animate-spin" />
              : isInitialized
                ? <RefreshCw size={12} />
                : <Play size={12} />
            }
            {isInitializing ? 'Initializing…' : isInitialized ? 'Re-Init' : 'Initialize'}
          </button> */}
        </div>

        {/* Right: manage agents / providers */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProviderManager(!showProviderManager)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors',
              showProviderManager
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'text-gray-500 hover:text-gray-300 border border-surface-overlay',
            )}
          >
            <Plug size={12} />
            Providers
          </button>
          <button
            onClick={() => setShowAgentManager(!showAgentManager)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors',
              showAgentManager
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'text-gray-500 hover:text-gray-300 border border-surface-overlay',
            )}
          >
            <Users size={12} />
            Agents ({agents.length})
          </button>
        </div>
      </header>

      {/* ── Gate stepper ─────────────────────────────────────────────────── */}
      <GateStepper />

      {/* ── Main 3-column layout ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar: 240px */}
        <aside className="w-60 flex-shrink-0 flex flex-col border-r border-surface-overlay overflow-hidden">
          {/* Sidebar tabs */}
          <div className="flex border-b border-surface-overlay flex-shrink-0">
            <SidebarTabBtn
              active={sidebarTab === 'projects'}
              onClick={() => setSidebarTab('projects')}
              icon={<MessageSquare size={11} />}
              label="History"
            />
            <SidebarTabBtn
              active={sidebarTab === 'files'}
              onClick={() => setSidebarTab('files')}
              icon={<LayoutPanelLeft size={12} />}
              label="Files"
            />
            <SidebarTabBtn
              active={sidebarTab === 'agents'}
              onClick={() => setSidebarTab('agents')}
              icon={<Users size={12} />}
              label="Agents"
            />
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-hidden">
            {sidebarTab === 'projects' ? (
              <ProjectSidebar />
            ) :
            sidebarTab === 'files' ? (
              <FileExplorer
                onFileSelect={handleFileSelect}
                selectedPath={selectedFile?.path}
                onTerminalToggle={() => setShowTerminal(!showTerminal)}
              />
            ) : (
              <AgentList onManageClick={() => setShowAgentManager(true)} />
            )}
          </div>
        </aside>

        {/* Center panel: flexible */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Center tabs */}
          <div className="flex items-center border-b border-surface-overlay bg-surface-raised flex-shrink-0">
            <CenterTabBtn
              active={centerTab === 'chat'}
              onClick={() => setCenterTab('chat')}
              icon={<MessageSquare size={12} />}
              label="Chat"
            />
            <CenterTabBtn
              active={centerTab === 'editor'}
              onClick={() => setCenterTab('editor')}
              icon={<Code2 size={12} />}
              label={selectedFile ? selectedFile.path.split('/').pop() ?? 'Editor' : 'Editor'}
              dirty={false}
            />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {centerTab === 'chat' ? (
              <ChatArea />
            ) : loadingFile ? (
              <div className="flex items-center justify-center h-full text-xs text-gray-500 font-mono gap-2">
                <RefreshCw size={14} className="animate-spin" />
                Loading file…
              </div>
            ) : selectedFile ? (
              <MonacoEditor
                filePath={selectedFile.path}
                initialContent={selectedFile.content}
                readOnly={selectedFile.locked}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full opacity-40 gap-2">
                <Code2 size={28} className="text-gray-600" />
                <p className="text-xs text-gray-500 font-mono">Select a file from the sidebar</p>
              </div>
            )}
          </div>
        </main>

        {/* Right sidebar: telemetry — 220px */}
        <aside className="w-56 flex-shrink-0 flex flex-col">
        <div className="flex border-b border-surface-overlay">
          <RightTabBtn active={rightTab === 'telemetry'} onClick={() => setRightTab('telemetry')} label="Telemetry" />
          <RightTabBtn active={rightTab === 'memory'} onClick={() => setRightTab('memory')} label="Memory" />
        </div>
        {rightTab === 'telemetry' ? <TelemetryPanel /> : <AgentSummaryPanel />}
      </aside>
      </div>

      {/* ── Agent Manager overlay ─────────────────────────────────────────── */}
      {showAgentManager && (
        <div className="fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowAgentManager(false)}
          />
          {/* Panel slides in from right */}
          <div className="w-[720px] flex flex-col border-l border-surface-overlay bg-surface-raised shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-overlay">
              <span className="text-sm font-mono text-gray-300">Agent Registry</span>
              <button
                onClick={() => setShowAgentManager(false)}
                className="text-gray-600 hover:text-white transition-colors text-xs font-mono"
              >
                Close ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <AgentManager />
            </div>
          </div>
        </div>
      )}

      {/* ── Provider Manager overlay ──────────────────────────────────────── */}
      {showProviderManager && (
        <div className="fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowProviderManager(false)}
          />
          {/* Panel slides in from right */}
          <div className="w-[720px] flex flex-col border-l border-surface-overlay bg-surface-raised shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-overlay">
              <span className="text-sm font-mono text-gray-300">Provider Registry</span>
              <button
                onClick={() => setShowProviderManager(false)}
                className="text-gray-600 hover:text-white transition-colors text-xs font-mono"
              >
                Close ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ProviderManager />
            </div>
          </div>
        </div>
      )}

      {showTerminal && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="w-3/4 h-3/4 bg-surface rounded-lg shadow-2xl overflow-hidden">
            <TerminalPanel sessionId={sessionId || 'default'} onClose={() => setShowTerminal(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Micro-components ─────────────────────────────────────────────────────────

function SidebarTabBtn({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-mono transition-colors border-b-2',
        active
          ? 'text-accent border-accent'
          : 'text-gray-500 border-transparent hover:text-gray-300',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function CenterTabBtn({
  active, onClick, icon, label, dirty,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  dirty?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-4 py-2 text-xs font-mono transition-colors border-b-2',
        active
          ? 'text-accent border-accent bg-surface/50'
          : 'text-gray-500 border-transparent hover:text-gray-300',
      )}
    >
      {icon}
      {label}
      {dirty && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
    </button>
  );
}

function RightTabBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 flex items-center justify-center py-2 text-xs font-mono transition-colors border-b-2',
        active
          ? 'text-accent border-accent bg-surface/30'
          : 'text-gray-500 border-transparent hover:text-gray-300',
      )}
    >
      {label}
    </button>
  );
}