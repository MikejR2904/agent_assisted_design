import React from 'react';

export const inputCls =
  'w-full bg-surface border border-surface-overlay text-gray-200 text-xs font-mono px-3 py-2 rounded focus:outline-none focus:border-accent/60 placeholder:text-gray-600 transition-colors';

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-mono text-gray-400">
        {label}
        {required && <span className="text-error ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-600 font-mono">{hint}</p>}
    </div>
  );
}
