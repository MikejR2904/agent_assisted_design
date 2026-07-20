// `monaco.languages.registerCodeActionProvider`/`registerInlineCompletionsProvider` are
// GLOBAL per-language-id registrations, not per-editor-instance — but this app keeps every
// open tab's MonacoEditor permanently mounted (see page.tsx's multi-tab design), each with
// its own React state (its own AISuggestionModal, its own aiInlineCompletion read). Naively
// registering these providers inside each instance's onMount would register duplicate
// providers per open tab of the same language, causing duplicate quick-fix entries and
// duplicate inline-completion calls.
//
// Fix: register each language's providers exactly once (module-level guard), and route a
// provider invocation back to the correct tab instance via a registry keyed by the model's
// URI — every MonacoEditor instance registers/unregisters its own handlers for its own model
// on mount/unmount; the shared provider just looks up "whoever owns this model" and defers to it.

import { aiApi } from '@/lib/api/client';

interface EditorAIHandlers {
  onFixDiagnostic: (marker: { message: string; startLineNumber: number; endLineNumber: number }) => void;
  isInlineCompletionEnabled: () => boolean;
  isReadOnly: () => boolean;
}

const registry = new Map<string, EditorAIHandlers>();
const registeredLanguages = new Set<string>();
let fixCommandId: string | null = null;

export function registerEditorAI(modelUriKey: string, handlers: EditorAIHandlers): void {
  registry.set(modelUriKey, handlers);
}

export function unregisterEditorAI(modelUriKey: string): void {
  registry.delete(modelUriKey);
}

const COMPLETION_DEBOUNCE_MS = 500;
const COMPLETION_PREFIX_LINES = 40;
const COMPLETION_SUFFIX_LINES = 5;

/** Idempotent — safe to call from every MonacoEditor instance's onMount. Only the first
 * call for a given language actually registers anything. */
export function ensureAIProvidersRegistered(monacoInstance: any, language: string): void {
  if (!fixCommandId) {
    fixCommandId = 'ai-fix-diagnostic';
    monacoInstance.editor.registerCommand(fixCommandId, (_accessor: unknown, modelUriKey: string, marker: any) => {
      registry.get(modelUriKey)?.onFixDiagnostic(marker);
    });
  }

  if (registeredLanguages.has(language)) return;
  registeredLanguages.add(language);

  monacoInstance.languages.registerCodeActionProvider(language, {
    provideCodeActions: (model: any, _range: any, context: any) => {
      const owner = registry.get(model.uri.toString());
      const verilatorMarkers = context.markers.filter((m: any) => m.source === 'verilator');
      if (!owner || verilatorMarkers.length === 0) {
        return { actions: [], dispose: () => {} };
      }
      const actions = verilatorMarkers.map((marker: any) => ({
        title: `Fix with AI: ${marker.message}`,
        kind: 'quickfix',
        diagnostics: [marker],
        isPreferred: true,
        command: {
          id: fixCommandId,
          title: 'Fix with AI',
          arguments: [model.uri.toString(), marker],
        },
      }));
      return { actions, dispose: () => {} };
    },
  });

  monacoInstance.languages.registerInlineCompletionsProvider(language, {
    provideInlineCompletions: async (model: any, position: any, _context: any, token: any) => {
      const owner = registry.get(model.uri.toString());
      if (!owner || owner.isReadOnly() || !owner.isInlineCompletionEnabled()) {
        return { items: [] };
      }
      await new Promise((resolve) => setTimeout(resolve, COMPLETION_DEBOUNCE_MS));
      if (token.isCancellationRequested) return { items: [] };

      const startLine = Math.max(1, position.lineNumber - COMPLETION_PREFIX_LINES);
      const endLine = Math.min(model.getLineCount(), position.lineNumber + COMPLETION_SUFFIX_LINES);
      const prefix = model.getValueInRange({
        startLineNumber: startLine, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      });
      const suffix = model.getValueInRange({
        startLineNumber: position.lineNumber, startColumn: position.column,
        endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine),
      });
      if (!prefix.trim()) return { items: [] };

      try {
        const { completion } = await aiApi.complete(prefix, suffix, language);
        if (token.isCancellationRequested || !completion.trim()) return { items: [] };
        return {
          items: [{
            insertText: completion,
            range: {
              startLineNumber: position.lineNumber, startColumn: position.column,
              endLineNumber: position.lineNumber, endColumn: position.column,
            },
          }],
        };
      } catch {
        return { items: [] };
      }
    },
    freeInlineCompletions: () => {},
  });
}
