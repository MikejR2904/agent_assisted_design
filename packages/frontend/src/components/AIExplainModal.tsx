'use client';

import { Loader2, Sparkles } from 'lucide-react';

interface AIExplainModalProps {
  explanation: string | null;
  isLoading: boolean;
  onClose: () => void;
}

export function AIExplainModal({ explanation, isLoading, onClose }: AIExplainModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-surface-elevated border border-surface-overlay rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-overlay">
          <span className="flex items-center gap-1.5 text-xs font-mono text-gray-300">
            <Sparkles size={12} className="text-accent" />
            AI Explanation
          </span>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors text-xs font-mono">
            Close ✕
          </button>
        </div>
        <div className="px-4 py-4 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 font-mono py-4 justify-center">
              <Loader2 size={14} className="animate-spin" />
              Thinking…
            </div>
          ) : (
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{explanation}</p>
          )}
        </div>
      </div>
    </div>
  );
}
