'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Save, Loader2, Lock, RefreshCw } from 'lucide-react';
import { filesApi } from '@/lib/api/client';
import { useTelemetryStore } from '@/lib/stores/telemetryStore';
import { clsx } from 'clsx';

// Dynamically import Monaco to avoid SSR issues
const MonacoEditorComponent = dynamic(
  () => import('@monaco-editor/react').then((m) => m.default),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

function EditorSkeleton() {
  return (
    <div className="flex-1 bg-surface flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-gray-600" />
    </div>
  );
}

interface MonacoEditorProps {
  filePath: string;
  initialContent?: string;
  language?: string;
  readOnly?: boolean;
  onSave?: (content: string) => void;
  /** Fires whenever the unsaved-changes state changes — lets the parent gate navigation/tab-close. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Determine Monaco language from file extension */
function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    v: 'verilog',
    sv: 'systemverilog',
    vh: 'verilog',
    toml: 'toml',
    json: 'json',
    md: 'markdown',
    tcl: 'tcl',
    py: 'python',
    sh: 'shell',
    ts: 'typescript',
    js: 'javascript',
  };
  return map[ext] ?? 'plaintext';
}

export function MonacoEditor({
  filePath,
  initialContent = '',
  readOnly = false,
  onSave,
  onDirtyChange,
}: MonacoEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const editorRef = useRef<unknown>(null);
  const { condition } = useTelemetryStore();

  const language = getLanguage(filePath);
  const filename = filePath.split('/').pop() ?? filePath;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleChange = (value: string | undefined) => {
    if (readOnly) return;
    setContent(value ?? '');
    setIsDirty(true);
    setSaveStatus('idle');
  };

  const handleSave = useCallback(async () => {
    if (!isDirty || readOnly) return;
    setIsSaving(true);
    try {
      // Determine save target
      if (filePath.startsWith('skills/') || filePath.endsWith('_SKILL.md')) {
        await filesApi.writeSkill(filename, content);
      } else if (condition) {
        // Save to active workspace condition via upload endpoint
        await filesApi.upload(
          new File([content], filename, { type: 'text/plain' }),
          condition,
          filePath,
        );
      }
      onSave?.(content);
      setIsDirty(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Save failed', err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [content, filePath, filename, condition, isDirty, readOnly, onSave]);

  const handleReload = useCallback(async () => {
    if (!condition) return;
    setIsLoading(true);
    try {
      const result = await filesApi.read(filePath, condition);
      setContent(result.content);
      setIsDirty(false);
      setSaveStatus('idle');
    } catch (err) {
      console.error('Reload failed', err);
    } finally {
      setIsLoading(false);
    }
  }, [filePath, condition]);

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-raised border-b border-surface-overlay">
        <div className="flex items-center gap-2">
          {readOnly && <Lock size={12} className="text-warning" />}
          <span className="text-xs font-mono text-gray-400">{filePath}</span>
          {isDirty && !readOnly && (
            <span className="w-1.5 h-1.5 rounded-full bg-warning" title="Unsaved changes" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 font-mono uppercase">{language}</span>

          <button
            onClick={handleReload}
            disabled={isLoading}
            className="text-gray-600 hover:text-gray-300 transition-colors disabled:opacity-30"
            title="Reload from disk"
          >
            <RefreshCw size={12} className={clsx(isLoading && 'animate-spin')} />
          </button>

          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40',
                saveStatus === 'saved' && 'text-success',
                saveStatus === 'error' && 'text-error',
                isDirty && saveStatus === 'idle'
                  ? 'bg-accent/20 text-accent hover:bg-accent/30'
                  : 'text-gray-600 cursor-default',
              )}
              title="Save (⌘S)"
            >
              {isSaving
                ? <Loader2 size={11} className="animate-spin" />
                : <Save size={11} />
              }
              {saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <MonacoEditorComponent
          height="100%"
          language={language}
          value={content}
          onChange={handleChange}
          onMount={(editor) => {
            editorRef.current = editor;
            // Keyboard shortcut: Ctrl+S / Cmd+S
            editor.addCommand(
              ((window as any).monaco?.KeyMod?.CtrlCmd ?? 0) |
              ((window as any).monaco?.KeyCode?.KeyS ?? 0),
              () => { void handleSave(); },
            );
          }}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            lineHeight: 20,
            tabSize: 2,
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            wordWrap: 'on',
            padding: { top: 12, bottom: 12 },
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 4,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
            },
          }}
          theme="vs-dark"
        />
      </div>

      {/* Status bar */}
      {readOnly && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-warning/10 border-t border-warning/20">
          <Lock size={10} className="text-warning" />
          <span className="text-[10px] text-warning font-mono">
            Read-only — this file is locked (Golden Config)
          </span>
        </div>
      )}
    </div>
  );
}