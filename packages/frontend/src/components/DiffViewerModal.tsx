'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { gitApi, filesApi } from '@/lib/api/client';

const DiffEditor = dynamic(
  () => import('@monaco-editor/react').then((m) => m.DiffEditor),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-gray-600" /></div> },
);

interface DiffViewerModalProps {
  condition: string;
  path: string;
  onClose: () => void;
}

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    v: 'verilog', sv: 'systemverilog', vh: 'verilog', toml: 'toml', json: 'json',
    md: 'markdown', tcl: 'tcl', py: 'python', sh: 'shell', ts: 'typescript', js: 'javascript',
  };
  return map[ext] ?? 'plaintext';
}

export function DiffViewerModal({ condition, path, onClose }: DiffViewerModalProps) {
  const [original, setOriginal] = useState<string | null>(null);
  const [modified, setModified] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      gitApi.show(condition, path, 'HEAD').then((r) => r.content).catch(() => ''),
      filesApi.read(path, condition).then((r) => r.content).catch(() => ''),
    ]).then(([head, working]) => {
      if (!cancelled) {
        setOriginal(head);
        setModified(working);
      }
    });
    return () => { cancelled = true; };
  }, [condition, path]);

  const isLoading = original === null || modified === null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[85vw] h-[80vh] flex flex-col bg-surface-raised border border-surface-overlay rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-overlay flex-shrink-0">
          <span className="text-xs font-mono text-gray-300">{path} — HEAD vs working tree</span>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors text-xs font-mono">
            Close ✕
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-gray-600" /></div>
          ) : (
            <DiffEditor
              height="100%"
              language={getLanguage(path)}
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
