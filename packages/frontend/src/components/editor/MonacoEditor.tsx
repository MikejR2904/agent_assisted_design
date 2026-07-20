'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Save, Loader2, Lock, RefreshCw, History } from 'lucide-react';
import { filesApi, lintApi, gitApi, aiApi, type GitBlameLine } from '@/lib/api/client';
import { useTelemetryStore } from '@/lib/stores/telemetryStore';
import { usePreferencesStore } from '@/lib/stores/preferencesStore';
import { AIExplainModal } from '@/components/AIExplainModal';
import { AISuggestionModal } from '@/components/AISuggestionModal';
import { registerEditorAI, unregisterEditorAI, ensureAIProvidersRegistered } from './aiMonacoProviders';
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
  /** Fires once on mount with the file's line-ending style, for the status bar. */
  onMetaChange?: (meta: { eol: 'LF' | 'CRLF' }) => void;
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
  onMetaChange,
}: MonacoEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const modelUriRef = useRef<string | null>(null);
  const { condition } = useTelemetryStore();
  const { fontSize, tabSize, wordWrap, minimap, autoSave, autoSaveDelayMs, aiInlineCompletion } = usePreferencesStore();
  const aiInlineCompletionRef = useRef(aiInlineCompletion);
  useEffect(() => { aiInlineCompletionRef.current = aiInlineCompletion; }, [aiInlineCompletion]);

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
      void runLint();
    } catch (err) {
      console.error('Save failed', err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [content, filePath, filename, condition, isDirty, readOnly, onSave]);

  // Real-time Verilator diagnostics: lint on save, render as Monaco markers. Silently
  // no-ops for non-RTL files and when Verilator isn't installed (toolAvailable: false) —
  // this is a quiet enhancement, not something that should ever interrupt saving.
  const runLint = useCallback(async () => {
    if (!condition || !/\.(v|sv|vh)$/i.test(filePath)) return;
    const monacoInstance = monacoRef.current;
    const editor = editorRef.current;
    if (!monacoInstance || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    try {
      const { diagnostics, toolAvailable } = await lintApi.verilog(condition, filePath);
      if (!toolAvailable) return;
      const markers = diagnostics.map((d) => ({
        startLineNumber: d.line,
        startColumn: d.column,
        endLineNumber: d.line,
        endColumn: d.column + 1,
        message: d.code ? `[${d.code}] ${d.message}` : d.message,
        severity: d.severity === 'error' ? monacoInstance.MarkerSeverity.Error : monacoInstance.MarkerSeverity.Warning,
        tags: d.code === 'UNUSED' ? [monacoInstance.MarkerTag.Unnecessary] : undefined,
      }));
      monacoInstance.editor.setModelMarkers(model, 'verilator', markers);
    } catch (err) {
      console.debug('Verilator lint skipped:', err);
    }
  }, [condition, filePath]);

  // Auto-save: just a different trigger for the exact same handleSave path (same
  // save-status pill, same lint-on-save) — not a separate code path.
  useEffect(() => {
    if (!autoSave || !isDirty || readOnly) return;
    const timer = setTimeout(() => { void handleSave(); }, autoSaveDelayMs);
    return () => clearTimeout(timer);
  }, [autoSave, autoSaveDelayMs, isDirty, readOnly, handleSave]);

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

  // Blame: fetched once per toggle-on and cached in a ref (not state — it's read from a
  // hover-provider callback, not rendered directly), rendered via a Monaco hover provider
  // rather than full inline gutter decorations to keep this bounded.
  const [blameEnabled, setBlameEnabled] = useState(false);
  const [isLoadingBlame, setIsLoadingBlame] = useState(false);
  const blameDataRef = useRef<GitBlameLine[]>([]);
  const hoverDisposableRef = useRef<{ dispose: () => void } | null>(null);

  const toggleBlame = useCallback(async () => {
    const monacoInstance = monacoRef.current;
    if (blameEnabled) {
      hoverDisposableRef.current?.dispose();
      hoverDisposableRef.current = null;
      setBlameEnabled(false);
      return;
    }
    if (!condition || !monacoInstance) return;
    setIsLoadingBlame(true);
    try {
      const { lines } = await gitApi.blame(condition, filePath);
      blameDataRef.current = lines;
      hoverDisposableRef.current = monacoInstance.languages.registerHoverProvider(language, {
        provideHover: (_model: unknown, position: { lineNumber: number }) => {
          const info = blameDataRef.current.find((l) => l.line === position.lineNumber);
          if (!info) return null;
          return {
            contents: [
              { value: `**${info.hash}** — ${info.author}` },
              { value: `${info.summary}\n\n${new Date(info.date).toLocaleString()}` },
            ],
          };
        },
      });
      setBlameEnabled(true);
    } catch (err) {
      console.error('Blame fetch failed', err);
    } finally {
      setIsLoadingBlame(false);
    }
  }, [blameEnabled, condition, filePath, language]);

  useEffect(() => () => hoverDisposableRef.current?.dispose(), []);
  useEffect(() => () => {
    if (modelUriRef.current) unregisterEditorAI(modelUriRef.current);
  }, []);

  // AI: Explain / Refactor / Fix — single-shot, no-tool LLM calls (see ai.routes.ts), not
  // routed through the conversational agent/session pipeline.
  const [explainState, setExplainState] = useState<{ text: string | null; loading: boolean } | null>(null);
  const [suggestion, setSuggestion] = useState<{
    title: string;
    original: string;
    modified: string | null;
    loading: boolean;
    range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  } | null>(null);

  const handleFixWithAI = useCallback((marker: { message: string; startLineNumber: number; endLineNumber: number }) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const startLine = Math.max(1, marker.startLineNumber - 3);
    const endLine = Math.min(model.getLineCount(), marker.endLineNumber + 3);
    const range = { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine) };
    const code = model.getValueInRange(range);
    setSuggestion({ title: `AI Fix: ${marker.message}`, original: code, modified: null, loading: true, range });
    aiApi.fix(code, language, { message: marker.message, line: marker.startLineNumber })
      .then(({ fixed }) => setSuggestion((prev) => (prev ? { ...prev, modified: fixed, loading: false } : prev)))
      .catch((err) => { console.error('AI fix failed', err); setSuggestion(null); });
  }, [language]);

  const handleAcceptSuggestion = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !suggestion?.modified) return;
    editor.executeEdits('ai-suggestion', [{ range: suggestion.range, text: suggestion.modified }]);
    setSuggestion(null);
  }, [suggestion]);

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
            onClick={toggleBlame}
            disabled={isLoadingBlame}
            title="Toggle git blame (hover a line)"
            className={clsx(
              'transition-colors disabled:opacity-30',
              blameEnabled ? 'text-accent' : 'text-gray-600 hover:text-gray-300',
            )}
          >
            <History size={12} className={clsx(isLoadingBlame && 'animate-spin')} />
          </button>

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
          onMount={(editor, monacoInstance) => {
            editorRef.current = editor;
            monacoRef.current = monacoInstance;
            // Keyboard shortcut: Ctrl+S / Cmd+S
            editor.addCommand(
              monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
              () => { void handleSave(); },
            );
            const model = editor.getModel();
            if (model) {
              onMetaChange?.({ eol: model.getEOL() === '\r\n' ? 'CRLF' : 'LF' });
            }

            // AI: Explain + Refactor — editor.addAction is instance-scoped (unlike the
            // language-level providers below), so no cross-tab registry is needed here;
            // it surfaces automatically in the right-click menu and the command palette (F1).
            editor.addAction({
              id: 'ai-explain-selection',
              label: 'AI: Explain Selection',
              contextMenuGroupId: 'ai',
              contextMenuOrder: 1,
              run: (ed: any) => {
                const sel = ed.getSelection();
                const m = ed.getModel();
                if (!sel || !m || sel.isEmpty()) return;
                const code = m.getValueInRange(sel);
                setExplainState({ text: null, loading: true });
                aiApi.explain(code, language)
                  .then(({ explanation }) => setExplainState({ text: explanation, loading: false }))
                  .catch((err) => setExplainState({ text: `Error: ${(err as Error).message}`, loading: false }));
              },
            });
            editor.addAction({
              id: 'ai-refactor-selection',
              label: 'AI: Refactor Selection',
              contextMenuGroupId: 'ai',
              contextMenuOrder: 2,
              run: (ed: any) => {
                const sel = ed.getSelection();
                const m = ed.getModel();
                if (!sel || !m || sel.isEmpty()) return;
                const code = m.getValueInRange(sel);
                setSuggestion({ title: 'AI Refactor', original: code, modified: null, loading: true, range: sel });
                aiApi.refactor(code, language)
                  .then(({ refactored }) => setSuggestion((prev) => (prev ? { ...prev, modified: refactored, loading: false } : prev)))
                  .catch((err) => { console.error('AI refactor failed', err); setSuggestion(null); });
              },
            });

            // AI: Fix (quick-fix lightbulb) + ghost-text completion — language-level global
            // providers, registered once per language and routed to this instance via a
            // model-URI-keyed registry (see aiMonacoProviders.ts for why).
            if (model) {
              modelUriRef.current = model.uri.toString();
              ensureAIProvidersRegistered(monacoInstance, language);
              registerEditorAI(modelUriRef.current, {
                onFixDiagnostic: handleFixWithAI,
                isInlineCompletionEnabled: () => aiInlineCompletionRef.current,
                isReadOnly: () => readOnly,
              });
            }
          }}
          options={{
            readOnly,
            minimap: { enabled: minimap },
            quickSuggestions: true,
            parameterHints: { enabled: true },
            fontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            lineHeight: Math.round(fontSize * 1.54),
            tabSize,
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            wordWrap,
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

      {explainState && (
        <AIExplainModal
          explanation={explainState.text}
          isLoading={explainState.loading}
          onClose={() => setExplainState(null)}
        />
      )}

      {suggestion && (
        <AISuggestionModal
          title={suggestion.title}
          original={suggestion.original}
          modified={suggestion.modified}
          isLoading={suggestion.loading}
          language={language}
          onAccept={handleAcceptSuggestion}
          onClose={() => setSuggestion(null)}
        />
      )}
    </div>
  );
}