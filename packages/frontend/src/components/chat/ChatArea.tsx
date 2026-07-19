'use client';

import { useRef, useEffect, useState } from 'react';
import { Send, Loader2, ChevronDown, AlertTriangle, X, KeyRound, Download } from 'lucide-react';
import { useChatStore } from '../../lib/stores/chatStore';
import { useConfigStore } from '@/lib/stores/configStore';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { useProjectStore } from '@/lib/stores/projectStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useAgentStore } from '../../lib/stores/agentStore';
import { MessageBubble } from './MessageBubble';
import { ApprovalCard } from './ApprovalCard';
import { AttachmentBar, AttachmentButton } from './AttachmentBar';
import type { LocalAttachment } from './AttachmentBar';

// API Key Error Banner
function ApiKeyErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const lines = message.split('\n');
  const headline = lines[0];
  const details = lines.slice(1).join('\n').trim();
  return (
    <div className="mx-4 mt-3 rounded-lg border border-error/40 bg-error/8 overflow-hidden">
      {/* Header row */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <AlertTriangle size={14} className="text-error flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-error font-medium">{headline}</p>
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-[10px] text-error/60 hover:text-error font-mono mt-0.5 transition-colors"
            >
              Show fix →
            </button>
          )}
        </div>
        <button onClick={onDismiss} className="text-error/40 hover:text-error/80 transition-colors flex-shrink-0">
          <X size={13} />
        </button>
      </div>

      {/* Expanded fix steps */}
      {expanded && details && (
        <div className="px-3 pb-3 border-t border-error/20 mt-0.5 pt-2.5">
          <pre className="text-[11px] font-mono text-error/80 whitespace-pre-wrap leading-relaxed">
            {details}
          </pre>
          <div className="mt-2.5 flex items-center gap-2">
            <KeyRound size={11} className="text-error/60" />
            <span className="text-[10px] text-error/60 font-mono">
              Free-tier options: Groq Llama 3, Gemini 1.5 Flash, or Ollama (local)
            </span>
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="mt-2 text-[10px] text-error/50 hover:text-error/80 font-mono"
          >
            Collapse ↑
          </button>
        </div>
      )}
    </div>
  );
}

// Connection error bar
function ConnectionBar({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-warning/10 border-b border-warning/20">
      <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
      <span className="text-[10px] text-warning font-mono">{message}</span>
    </div>
  );
}

export function ChatArea() {
  const [input, setInput] = useState('');
  const [ pendingAttachments, setPendingAttachments ] = useState<LocalAttachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Lifted into agentStore (not local state) so the status bar can show the active agent too.
  const { agents, activeAgentId: selectedAgentId, setActiveAgentId: setSelectedAgentId } = useAgentStore();
  const { isProcessing, pendingToolRequest, apiKeyError, connectionError, setApiKeyError } = useChatStore();
  const { sessionId } = useConfigStore();
  const { getActiveSession, addAttachment } = useSessionStore();
  const { getActiveProject } = useProjectStore();
  const { sendMessage, cancelTask, editMessage } = useWebSocket();

  const session = getActiveSession();
  const messages = session?.messages ?? [];

  // Safe mount tracker to block store data until client hydration is finished
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isMounted && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Set default agent when agents load or session changes
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  const handleSend = () => {
    if (!input.trim() || isProcessing || !sessionId || !selectedAgentId) return;
    let attachmentContext = '';
    if (pendingAttachments.length > 0) {
      attachmentContext = pendingAttachments.map(
        (a) => `\n\n---\n**Attached file: ${a.name}**\n\`\`\`\n${a.content}\n\`\`\``)
        .join('');
    }
    sendMessage(input.trim() + attachmentContext, selectedAgentId);
    if (session) {
      pendingAttachments.forEach((att) => addAttachment(session.id, att));
    }
    setPendingAttachments([]);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  const handleCancel = () => {
    if (session) {
      cancelTask();
    }
  };

  const handleExport = () => {
    if (!session || messages.length === 0) return;
    const lines = messages.map((msg) => {
      const agentName = msg.agentId ? agents.find((a) => a.id === msg.agentId)?.name : undefined;
      const heading = msg.role === 'user' ? 'User' : agentName ? agentName : msg.role === 'assistant' ? 'Assistant' : msg.role;
      const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
      return `## ${heading}${timestamp ? ` — ${timestamp}` : ''}\n\n${msg.content}\n`;
    });
    const markdown = `# Chat session — ${session.id}\n\n${lines.join('\n')}`;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${session.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedAgentName = agents.find((a) => a.id === selectedAgentId)?.name;

  const project = getActiveProject();
  const projectHasMemory = project && session?.projectId === project.id;

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Connection error bar */}
      {connectionError && <ConnectionBar message={connectionError} />}
      {/* Project memory banner */}
      {projectHasMemory && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-accent/5 border-b border-accent/10 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="text-[10px] text-accent/70 font-mono">
            Project memory active: <span className="text-accent">{project.name}</span>
          </span>
        </div>
      )}
      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {isMounted && messages.length > 0 && (
          <div className="flex justify-end mb-1">
            <button
              onClick={handleExport}
              title="Export session as Markdown"
              className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-accent font-mono transition-colors"
            >
              <Download size={11} />
              Export
            </button>
          </div>
        )}
        {/* API key error banner */}
        {apiKeyError && (
          <ApiKeyErrorBanner message={apiKeyError} onDismiss={() => setApiKeyError(null)} />
        )}
        
        {/* By putting a clean, single-branch structure for the initial mount/empty pass,
          the server output is fully static and simple. No conditional bubbles are evaluated 
          until the client state is safely active and stable.
        */}
        {!isMounted ? (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <p className="text-sm text-gray-400 font-mono">RTL-to-GDSII Workbench</p>
            <p className="text-xs text-gray-600 mt-1">Initialize a workspace to begin</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <p className="text-sm text-gray-400 font-mono">RTL-to-GDSII Workbench</p>
            <p className="text-xs text-gray-600 mt-1">Initialize a workspace to begin</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onEdit={(messageId, newContent) => editMessage(messageId, newContent, selectedAgentId ?? undefined)}
              />
            ))}

            {/* Pending tool request */}
            {pendingToolRequest && (
              <ApprovalCard request={pendingToolRequest} />
            )}

            {/* Processing indicator */}
            {isProcessing && !pendingToolRequest && (
              <div className="flex items-center gap-2 py-2 text-xs text-gray-500 font-mono">
                <Loader2 size={12} className="animate-spin" />
                {selectedAgentName ? `${selectedAgentName} is thinking...` : 'Agent thinking...'}
              </div>
            )}
          </>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Section at bottom of ChatArea */}
      <div className="px-4 py-3 border-t border-surface-overlay bg-surface-raised">
        {!sessionId && isMounted && (
          <p className="text-xs text-warning font-mono mb-2">
            ⚠ No active session. Initialize a workspace first.
          </p>
        )}

        {/* Move Attachment Bar up here: Now scales cleanly above the text box */}
        <AttachmentBar
          attachments={pendingAttachments}
          onRemove={(id) => setPendingAttachments((prev) => prev.filter((a) => a.id !== id))}
        />

        <div className="flex gap-2 items-end">
          {/* Agent dropdown */}
          <div className="relative flex-shrink-0">
            <select
              value={selectedAgentId || ''}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="appearance-none bg-surface-elevated border border-surface-overlay rounded-lg px-3 py-2.5 text-sm font-mono text-gray-300 focus:outline-none focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/40 pr-8"
              disabled={!sessionId || isProcessing || agents.length === 0}
            >
              {agents.length === 0 ? (
                <option value="">Loading agents...</option>
              ) : (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))
              )}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          </div>

          {/* Mount the new neatly-boxed layout button here */}
          <AttachmentButton
            onAdd={(att) => setPendingAttachments((prev) => [...prev, att])}
            disabled={!sessionId || isProcessing}
          />

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={sessionId ? 'Describe a design task... (⇧↵ for newline)' : 'Initialize workspace to chat'}
            disabled={!sessionId || isProcessing}
            className="flex-1 bg-surface-elevated text-white text-sm font-mono placeholder:text-gray-600 px-3 py-2.5 rounded-lg border border-surface-overlay focus:outline-none focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/40 resize-none disabled:opacity-40 min-h-[42px]"
            rows={1}
            style={{ height: 'auto' }}
          />

          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing || !sessionId || !selectedAgentId}
            className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent hover:bg-accent-hover disabled:bg-surface-overlay disabled:text-gray-600 text-white flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
          >
            {isProcessing
              ? <Loader2 size={16} className="animate-spin" />
              : <Send size={16} />
            }
          </button>
          
          {isProcessing && (
            <button
              onClick={handleCancel}
              title="Stop generation"
              className="flex-shrink-0 h-10 px-3 rounded-lg bg-error hover:bg-error/80 text-white flex items-center gap-1.5 text-xs font-mono transition-colors"
            >
              <X size={14} />
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}