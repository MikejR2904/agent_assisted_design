'use client';

import { useState, useEffect } from 'react';
import {
  RefreshCw, ChevronDown, X, Lock, ChevronsLeft, ChevronsRight,
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
import { FileSearchModal } from '@/components/FileSearchModal';
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

interface OpenFile {
  path: string;
  content: string;
  locked: boolean;
}

// Condition selector
const CONDITIONS = Object.values(EXPERIMENTAL_CONDITIONS);

const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 480;

function pathSegments(p: string): string[] {
  return p.split(/[/\\]/).filter(Boolean);
}

export default function WorkbenchPage() {
  const [centerTab, setCenterTab] = useState<CenterTab>('chat');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [rightTab, setRightTab] = useState<RightTab>('telemetry');
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [showProviderManager, setShowProviderManager] = useState(false);
  const [showConditionMenu, setShowConditionMenu] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [dirtyByPath, setDirtyByPath] = useState<Record<string, boolean>>({});
  const [loadingFile, setLoadingFile] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalSize, setTerminalSize] = useState<{ width: number; height: number } | null>(null);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(224);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const { agents, fetchAgents } = useAgentStore();
  const { setCondition, sessionId } = useConfigStore();
  const { getActiveSession, activeCondition } = useSessionStore();
  const session = getActiveSession();
  const { setCondition: setTelemetryCondition } = useTelemetryStore();

  const [isMounted, setIsMounted] = useState(false);
  const isAnyFileDirty = Object.values(dirtyByPath).some(Boolean);

  // Hydrate agents on mount
  useEffect(() => {
    void fetchAgents();
    setIsMounted(true);
  }, [fetchAgents]);

  // Warn on tab close/refresh with unsaved editor changes.
  useEffect(() => {
    if (!isAnyFileDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isAnyFileDirty]);

  // Ctrl/Cmd+P — fuzzy file search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowFileSearch(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Handlers

  const handleSelectCondition = (c: ExperimentalCondition) => {
    setCondition(c);
    setTelemetryCondition(c);
    setShowConditionMenu(false);
  };

  const handleFileSelect = async (path: string) => {
    if (!activeCondition) return;
    setCenterTab('editor');
    const alreadyOpen = openFiles.some((f) => f.path === path);
    if (alreadyOpen) {
      setActiveFilePath(path);
      return;
    }
    setLoadingFile(true);
    try {
      // Determine if it's a config file (locked) or workspace file
      let entry: OpenFile;
      if (path === 'architecture.toml' || path === 'gates.json') {
        const result = await filesApi.readConfig(path);
        entry = { path, content: result.content, locked: result.locked };
      } else {
        const result = await filesApi.read(path, activeCondition);
        entry = { path, content: result.content, locked: false };
      }
      setOpenFiles((prev) => [...prev, entry]);
      setActiveFilePath(path);
    } catch (err) {
      console.error('Failed to read file', err);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleCloseTab = (path: string) => {
    if (dirtyByPath[path] && !window.confirm('You have unsaved changes in this file. Discard them and close the tab?')) {
      return;
    }
    const remaining = openFiles.filter((f) => f.path !== path);
    setOpenFiles(remaining);
    setDirtyByPath((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    if (activeFilePath === path) {
      setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  };

  const startPanelResize = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === 'left') {
        setLeftWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startLeft + delta)));
      } else {
        setRightWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startRight - delta)));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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

        {/* Left sidebar */}
        {leftCollapsed ? (
          <button
            onClick={() => setLeftCollapsed(false)}
            title="Expand sidebar"
            className="w-6 flex-shrink-0 flex items-start justify-center pt-3 border-r border-surface-overlay text-gray-600 hover:text-accent transition-colors"
          >
            <ChevronsRight size={14} />
          </button>
        ) : (
          <aside
            className="flex-shrink-0 flex flex-col border-r border-surface-overlay overflow-hidden relative"
            style={{ width: leftWidth }}
          >
            {/* Sidebar tabs */}
            <div className="flex items-center border-b border-surface-overlay flex-shrink-0">
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
              <button
                onClick={() => setLeftCollapsed(true)}
                title="Collapse sidebar"
                className="px-1.5 text-gray-600 hover:text-accent transition-colors flex-shrink-0"
              >
                <ChevronsLeft size={12} />
              </button>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-hidden">
              {sidebarTab === 'projects' ? (
                <ProjectSidebar />
              ) :
              sidebarTab === 'files' ? (
                <FileExplorer
                  onFileSelect={handleFileSelect}
                  selectedPath={activeFilePath ?? undefined}
                  onTerminalToggle={() => setShowTerminal(!showTerminal)}
                />
              ) : (
                <AgentList onManageClick={() => setShowAgentManager(true)} />
              )}
            </div>

            {/* Resize handle */}
            <div
              onMouseDown={startPanelResize('left')}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 transition-colors"
            />
          </aside>
        )}

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
              label="Editor"
              dirty={isAnyFileDirty}
            />
          </div>

          {/* Open-file tab strip */}
          {centerTab === 'editor' && openFiles.length > 0 && (
            <div className="flex items-center border-b border-surface-overlay bg-surface-raised flex-shrink-0 overflow-x-auto">
              {openFiles.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setActiveFilePath(f.path)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono border-r border-surface-overlay transition-colors flex-shrink-0',
                    f.path === activeFilePath ? 'bg-surface text-accent' : 'text-gray-500 hover:text-gray-300',
                  )}
                >
                  {f.locked && <Lock size={10} className="text-warning flex-shrink-0" />}
                  <span className="truncate max-w-[140px]">{pathSegments(f.path).pop()}</span>
                  {dirtyByPath[f.path] && <span className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" />}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleCloseTab(f.path); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleCloseTab(f.path); } }}
                    className="ml-1 text-gray-600 hover:text-white flex-shrink-0"
                    title="Close tab"
                  >
                    <X size={11} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {centerTab === 'chat' ? (
              <ChatArea />
            ) : (
              <div className="flex flex-col h-full overflow-hidden">
                {/* Breadcrumb */}
                {activeFilePath && (
                  <div className="px-3 py-1 text-[10px] font-mono text-gray-600 border-b border-surface-overlay flex-shrink-0 truncate">
                    {pathSegments(activeFilePath).join(' / ')}
                  </div>
                )}
                <div className="flex-1 overflow-hidden relative">
                  {loadingFile && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface text-xs text-gray-500 font-mono gap-2">
                      <RefreshCw size={14} className="animate-spin" />
                      Loading file…
                    </div>
                  )}
                  {openFiles.length === 0 && !loadingFile ? (
                    <div className="flex flex-col items-center justify-center h-full opacity-40 gap-2">
                      <Code2 size={28} className="text-gray-600" />
                      <p className="text-xs text-gray-500 font-mono">Select a file from the sidebar</p>
                    </div>
                  ) : (
                    openFiles.map((f) => (
                      <div key={f.path} className={clsx('h-full', f.path === activeFilePath ? 'block' : 'hidden')}>
                        <MonacoEditor
                          filePath={f.path}
                          initialContent={f.content}
                          readOnly={f.locked}
                          onDirtyChange={(d) => setDirtyByPath((prev) => ({ ...prev, [f.path]: d }))}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right sidebar: telemetry */}
        {rightCollapsed ? (
          <button
            onClick={() => setRightCollapsed(false)}
            title="Expand panel"
            className="w-6 flex-shrink-0 flex items-start justify-center pt-3 border-l border-surface-overlay text-gray-600 hover:text-accent transition-colors"
          >
            <ChevronsLeft size={14} />
          </button>
        ) : (
          <aside className="flex-shrink-0 flex flex-col relative" style={{ width: rightWidth }}>
            <div
              onMouseDown={startPanelResize('right')}
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/40 transition-colors"
            />
            <div className="flex items-center border-b border-surface-overlay">
              <RightTabBtn active={rightTab === 'telemetry'} onClick={() => setRightTab('telemetry')} label="Telemetry" />
              <RightTabBtn active={rightTab === 'memory'} onClick={() => setRightTab('memory')} label="Memory" />
              <button
                onClick={() => setRightCollapsed(true)}
                title="Collapse panel"
                className="px-1.5 text-gray-600 hover:text-accent transition-colors flex-shrink-0"
              >
                <ChevronsRight size={12} />
              </button>
            </div>
            {rightTab === 'telemetry' ? <TelemetryPanel /> : <AgentSummaryPanel />}
          </aside>
        )}
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
          <div
            className="relative bg-surface rounded-lg shadow-2xl overflow-hidden"
            style={{
              width: terminalSize?.width ?? '75vw',
              height: terminalSize?.height ?? '75vh',
            }}
          >
            <TerminalPanel sessionId={sessionId || 'default'} onClose={() => setShowTerminal(false)} />

            {/* Drag handle — bottom-right corner resize */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const container = e.currentTarget.parentElement as HTMLElement;
                const rect = container.getBoundingClientRect();
                const startX = e.clientX;
                const startY = e.clientY;
                const startWidth = rect.width;
                const startHeight = rect.height;

                const onMove = (moveEvent: MouseEvent) => {
                  setTerminalSize({
                    width: Math.max(420, startWidth + (moveEvent.clientX - startX)),
                    height: Math.max(240, startHeight + (moveEvent.clientY - startY)),
                  });
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-gray-500 hover:text-accent transition-colors"
              title="Drag to resize"
            >
              <svg viewBox="0 0 16 16" className="w-full h-full">
                <path d="M14 14L14 9M14 14L9 14M14 14L5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>
      )}

      {showFileSearch && (
        <FileSearchModal
          condition={activeCondition}
          onSelect={handleFileSelect}
          onClose={() => setShowFileSearch(false)}
        />
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
