'use client';

import dynamic from 'next/dynamic';
import { Loader2, Sparkles, Check, X } from 'lucide-react';

const DiffEditor = dynamic(
  () => import('@monaco-editor/react').then((m) => m.DiffEditor),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-gray-600" /></div> },
);

interface AISuggestionModalProps {
  title: string;
  original: string;
  modified: string | null;
  isLoading: boolean;
  language?: string;
  onAccept: () => void;
  onClose: () => void;
}

export function AISuggestionModal({
  title, original, modified, isLoading, language, onAccept, onClose,
}: AISuggestionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[85vw] h-[75vh] flex flex-col bg-surface-raised border border-surface-overlay rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-overlay flex-shrink-0">
          <span className="flex items-center gap-1.5 text-xs font-mono text-gray-300">
            <Sparkles size={12} className="text-accent" />
            {title}
          </span>
          <div className="flex items-center gap-2">
            {!isLoading && modified !== null && (
              <button
                onClick={onAccept}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono text-accent bg-accent/10 hover:bg-accent/20 transition-colors"
              >
                <Check size={11} />
                Accept
              </button>
            )}
            <button
              onClick={onClose}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono text-gray-500 hover:text-gray-300 transition-colors"
            >
              <X size={11} />
              {isLoading ? 'Cancel' : 'Reject'}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {isLoading || modified === null ? (
            <div className="flex items-center justify-center h-full gap-2 text-xs text-gray-500 font-mono">
              <Loader2 size={16} className="animate-spin" />
              Generating suggestion…
            </div>
          ) : (
            <DiffEditor
              height="100%"
              language={language ?? 'plaintext'}
              original={original}
              modified={modified}
              theme="vs-dark"
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, renderSideBySide: true }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
