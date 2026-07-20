import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PreferencesStore {
  // Editor
  fontSize: number;
  tabSize: number;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  autoSave: boolean;
  autoSaveDelayMs: number;
  aiInlineCompletion: boolean;

  // Layout
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  defaultShowTerminal: boolean;

  setFontSize: (v: number) => void;
  setTabSize: (v: number) => void;
  setWordWrap: (v: 'on' | 'off') => void;
  setMinimap: (v: boolean) => void;
  setAutoSave: (v: boolean) => void;
  setAutoSaveDelayMs: (v: number) => void;
  setAiInlineCompletion: (v: boolean) => void;
  setLeftWidth: (v: number) => void;
  setRightWidth: (v: number) => void;
  setLeftCollapsed: (v: boolean) => void;
  setRightCollapsed: (v: boolean) => void;
  setDefaultShowTerminal: (v: boolean) => void;
  resetToDefaults: () => void;
}

const DEFAULTS = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: 'on' as const,
  minimap: true,
  autoSave: false,
  autoSaveDelayMs: 1500,
  aiInlineCompletion: true,
  leftWidth: 240,
  rightWidth: 224,
  leftCollapsed: false,
  rightCollapsed: false,
  defaultShowTerminal: false,
};

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setFontSize: (v) => set({ fontSize: v }),
      setTabSize: (v) => set({ tabSize: v }),
      setWordWrap: (v) => set({ wordWrap: v }),
      setMinimap: (v) => set({ minimap: v }),
      setAutoSave: (v) => set({ autoSave: v }),
      setAutoSaveDelayMs: (v) => set({ autoSaveDelayMs: v }),
      setAiInlineCompletion: (v) => set({ aiInlineCompletion: v }),
      setLeftWidth: (v) => set({ leftWidth: v }),
      setRightWidth: (v) => set({ rightWidth: v }),
      setLeftCollapsed: (v) => set({ leftCollapsed: v }),
      setRightCollapsed: (v) => set({ rightCollapsed: v }),
      setDefaultShowTerminal: (v) => set({ defaultShowTerminal: v }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    { name: 'preferences-store' },
  ),
);
