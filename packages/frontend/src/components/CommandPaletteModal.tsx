'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Zap } from 'lucide-react';

export interface Command {
  id: string;
  label: string;
  category?: string;
  action: () => void;
}

interface CommandPaletteModalProps {
  commands: Command[];
  onClose: () => void;
}

/** Same subsequence fuzzy matcher as FileSearchModal.tsx — kept identical rather than shared
 * since each is a ~15-line self-contained helper, not worth extracting for two call sites. */
function fuzzyScore(candidate: string, query: string): number | null {
  const c = candidate.toLowerCase();
  const q = query.toLowerCase();
  let ci = 0;
  let score = 0;
  let lastMatchIndex = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = c.indexOf(q[qi], ci);
    if (idx === -1) return null;
    score += idx === lastMatchIndex + 1 ? 3 : 1;
    score -= idx * 0.01;
    lastMatchIndex = idx;
    ci = idx + 1;
  }
  return score;
}

export function CommandPaletteModal({ commands, onClose }: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = query.trim()
    ? commands
        .map((cmd) => ({ cmd, score: fuzzyScore(cmd.label, query.trim()) }))
        .filter((r): r is { cmd: Command; score: number } => r.score !== null)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.cmd)
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const runCommand = (cmd: Command) => {
    cmd.action();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = results[selectedIndex];
      if (selected) runCommand(selected);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-surface-elevated border border-surface-overlay rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-overlay">
          <Search size={14} className="text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command…"
            className="flex-1 bg-transparent text-sm font-mono text-white placeholder:text-gray-600 focus:outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="text-xs text-gray-600 font-mono px-3 py-3">No matching commands</p>
          ) : (
            results.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => runCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs font-mono transition-colors ${
                  i === selectedIndex ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:bg-surface-overlay'
                }`}
              >
                <Zap size={12} className="flex-shrink-0 text-gray-600" />
                <span className="truncate">{cmd.label}</span>
                {cmd.category && <span className="ml-auto text-[10px] text-gray-600 flex-shrink-0">{cmd.category}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
