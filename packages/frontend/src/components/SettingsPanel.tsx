'use client';

import { RotateCcw } from 'lucide-react';
import { usePreferencesStore } from '@/lib/stores/preferencesStore';

export function SettingsPanel() {
  const prefs = usePreferencesStore();

  return (
    <div className="flex flex-col h-full overflow-y-auto px-6 py-5 gap-6">
      <Section title="Editor">
        <Field label="Font size">
          <input
            type="number"
            min={9}
            max={24}
            value={prefs.fontSize}
            onChange={(e) => prefs.setFontSize(Number(e.target.value) || 13)}
            className="bg-surface-elevated text-white text-sm font-mono px-2 py-1 rounded border border-surface-overlay focus:outline-none focus:border-accent/50 w-20"
          />
        </Field>
        <Field label="Tab size">
          <input
            type="number"
            min={1}
            max={8}
            value={prefs.tabSize}
            onChange={(e) => prefs.setTabSize(Number(e.target.value) || 2)}
            className="bg-surface-elevated text-white text-sm font-mono px-2 py-1 rounded border border-surface-overlay focus:outline-none focus:border-accent/50 w-20"
          />
        </Field>
        <CheckboxField
          label="Word wrap"
          checked={prefs.wordWrap === 'on'}
          onChange={(v) => prefs.setWordWrap(v ? 'on' : 'off')}
        />
        <CheckboxField label="Minimap" checked={prefs.minimap} onChange={prefs.setMinimap} />
        <CheckboxField label="Auto-save" checked={prefs.autoSave} onChange={prefs.setAutoSave} />
        {prefs.autoSave && (
          <Field label="Auto-save delay (ms)">
            <input
              type="number"
              min={200}
              step={100}
              value={prefs.autoSaveDelayMs}
              onChange={(e) => prefs.setAutoSaveDelayMs(Number(e.target.value) || 1500)}
              className="bg-surface-elevated text-white text-sm font-mono px-2 py-1 rounded border border-surface-overlay focus:outline-none focus:border-accent/50 w-24"
            />
          </Field>
        )}
      </Section>

      <Section title="AI">
        <CheckboxField
          label="Inline ghost-text completion"
          checked={prefs.aiInlineCompletion}
          onChange={prefs.setAiInlineCompletion}
        />
      </Section>

      <Section title="Workspace">
        <CheckboxField
          label="Show terminal on load"
          checked={prefs.defaultShowTerminal}
          onChange={prefs.setDefaultShowTerminal}
        />
      </Section>

      <button
        onClick={prefs.resetToDefaults}
        className="flex items-center gap-1.5 self-start px-3 py-1.5 rounded text-xs font-mono text-gray-400 hover:text-white border border-surface-overlay hover:border-gray-500 transition-colors"
      >
        <RotateCcw size={12} />
        Reset to defaults
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-gray-300 font-mono">{label}</span>
      {children}
    </label>
  );
}

function CheckboxField({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <span className="text-sm text-gray-300 font-mono">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-accent cursor-pointer"
      />
    </label>
  );
}
