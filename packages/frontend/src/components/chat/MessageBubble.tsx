'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, User, Info, Terminal, Lightbulb, ChevronDown } from 'lucide-react';
import type { ChatMessage } from '../../lib/stores/chatStore';
import { useAgentStore } from '../../lib/stores/agentStore';
import { clsx } from 'clsx';

interface MessageBubbleProps {
  message: ChatMessage;
}

function ChainOfThought({ message }: { message: ChatMessage }) {
  // null = follow the automatic rule (expanded while still in the reasoning phase, i.e.
  // streaming with no answer content yet); true/false = the user explicitly toggled it.
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const autoExpanded = !!message.isStreaming && !message.content;
  const expanded = manualExpanded ?? autoExpanded;

  return (
    <div className="mb-2 rounded border border-surface-overlay bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setManualExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-surface-elevated transition-colors"
      >
        <Lightbulb size={11} className="text-gray-500 flex-shrink-0" />
        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider flex-1">
          Chain of Thought{autoExpanded && !message.content && ' — thinking…'}
        </span>
        <ChevronDown size={12} className={clsx('text-gray-600 transition-transform flex-shrink-0', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <pre className="text-[11px] text-gray-500 font-mono whitespace-pre-wrap px-2.5 pb-2 max-h-64 overflow-y-auto">
          {message.reasoning}
        </pre>
      )}
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { agents } = useAgentStore();
  const agent = message.agentId ? agents.find((a) => a.id === message.agentId) : null;

  if (message.role === 'system') {
    return (
      <div className="flex items-start gap-2 py-2">
        <Info size={13} className="text-warning mt-0.5 flex-shrink-0" />
        <p className="text-xs text-warning font-mono">{message.content}</p>
      </div>
    );
  }

  if (message.role === 'tool-result') {
    return (
      <div className="my-2 rounded bg-surface-elevated border border-surface-overlay px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <Terminal size={12} className="text-gray-500" />
          <span className="text-xs text-gray-500 font-mono">Tool Output</span>
        </div>
        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap overflow-x-auto">
          {message.content}
        </pre>
      </div>
    );
  }

  const isUser = message.role === 'user';

  return (
    <div className={clsx('flex gap-3 py-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={clsx(
        'w-7 h-7 rounded flex items-center justify-center flex-shrink-0 mt-0.5',
        isUser ? 'bg-surface-overlay' : 'bg-accent/20',
      )}>
        {isUser
          ? <User size={14} className="text-gray-400" />
          : <Brain size={14} className="text-accent" />
        }
      </div>

      {/* Content */}
      <div className={clsx('flex-1 max-w-[85%]', isUser && 'flex flex-col items-end')}>
        {!isUser && agent && (
          <p className="text-xs text-gray-500 font-mono mb-1">
            {agent.name} · {agent.roleDescription}
          </p>
        )}
        {!isUser && message.reasoning && <ChainOfThought message={message} />}
        <div className={clsx(
          'rounded-lg px-3 py-2.5 text-sm',
          isUser
            ? 'bg-accent/20 text-white'
            : 'bg-surface-elevated text-gray-200',
        )}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className ?? '');
                    const lang = match?.[1] ?? '';
                    const isBlock = className?.includes('language-');
                    return isBlock ? (
                      <pre className="bg-surface rounded p-3 overflow-x-auto my-2">
                        <code className={clsx('text-xs font-mono', langColor(lang))} {...props}>
                          {children}
                        </code>
                      </pre>
                    ) : (
                      <code className="bg-surface px-1 py-0.5 rounded text-xs font-mono text-green-400" {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>

              {/* Streaming pulse visual sits safely underneath the typography engine */}
              {message.isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-accent ml-0.5 animate-pulse align-middle" />
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-600 mt-1 font-mono">
          {message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : ''}
        </p>
      </div>
    </div>
  );
}

function langColor(lang: string): string {
  const map: Record<string, string> = {
    verilog: 'text-purple-300',
    sv: 'text-purple-300',
    tcl: 'text-blue-300',
    python: 'text-yellow-300',
    bash: 'text-green-300',
    json: 'text-orange-300',
  };
  return map[lang] ?? 'text-gray-300';
}