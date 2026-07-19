'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, File } from 'lucide-react';

interface FileSearchModalProps {
  condition: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
}

function flattenFiles(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      paths.push(entry.path);
    } else if (entry.children) {
      paths.push(...flattenFiles(entry.children));
    }
  }
  return paths;
}

/** Subsequence fuzzy match: query chars must appear in order (case-insensitive). Score
 * rewards contiguous runs and early matches, matching the usual "fuzzy open file" feel
 * without pulling in a matching library. */
function fuzzyScore(candidate: string, query: string): number | null {
  const c = candidate.toLowerCase();
  const q = query.toLowerCase();
  let ci = 0;
  let score = 0;
  let lastMatchIndex = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = c.indexOf(q[qi], ci);
    if (idx === -1) return null;
    score += idx === lastMatchIndex + 1 ? 3 : 1; // reward contiguous matches
    score -= idx * 0.01; // slight preference for earlier matches
    lastMatchIndex = idx;
    ci = idx + 1;
  }
  return score;
}

export function FileSearchModal({ condition, onSelect, onClose }: FileSearchModalProps) {
  const [query, setQuery] = useState('');
  const [allPaths, setAllPaths] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (!condition) return;
    fetch(`/api/files/tree?condition=${encodeURIComponent(condition)}`)
      .then((res) => res.json())
      .then((data: FileEntry[]) => setAllPaths(flattenFiles(data)))
      .catch(() => setAllPaths([]));
  }, [condition]);

  const results = query.trim()
    ? allPaths
        .map((p) => ({ path: p, score: fuzzyScore(p, query.trim()) }))
        .filter((r): r is { path: string; score: number } => r.score !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
        .map((r) => r.path)
    : allPaths.slice(0, 30);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
      if (selected) {
        onSelect(selected);
        onClose();
      }
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
            placeholder="Search files by name…"
            className="flex-1 bg-transparent text-sm font-mono text-white placeholder:text-gray-600 focus:outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="text-xs text-gray-600 font-mono px-3 py-3">No matching files</p>
          ) : (
            results.map((path, i) => (
              <button
                key={path}
                onClick={() => { onSelect(path); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs font-mono transition-colors ${
                  i === selectedIndex ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:bg-surface-overlay'
                }`}
              >
                <File size={12} className="flex-shrink-0 text-gray-600" />
                <span className="truncate">{path}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
