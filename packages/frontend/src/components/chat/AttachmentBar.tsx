'use client';

import { useRef, useState, useCallback } from 'react';
import { Paperclip, X, FileText, AlertTriangle, } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { Attachment } from '@agent_design/shared/types';
import { clsx } from 'clsx';

const ACCEPTED_TYPES = [
  '.md', '.txt', '.v', '.sv', '.vh', '.toml', '.json', '.py', '.tcl', '.sh', '.ts', '.js',
];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB; keep well within context windows

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const isMarkdown = ext === 'md';
  const isVerilog = ext === 'v' || ext === 'sv';
  return (
    <FileText
      size={12}
      className={clsx(
        isMarkdown && 'text-blue-400',
        isVerilog && 'text-purple-400',
        !isMarkdown && !isVerilog && 'text-gray-400',
      )}
    />
  );
}

export interface LocalAttachment extends Attachment {
  content?: string;
  scope?: 'message';
}

// Attachment Trigger Button Component
interface AttachmentButtonProps {
  onAdd: (attachment: LocalAttachment) => void;
  disabled?: boolean;
}

export function AttachmentButton({ onAdd, disabled }: AttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    setError(null);

    if (file.size > MAX_SIZE_BYTES) {
      setError(`${file.name} is too large (max 10 MB)`);
      return;
    }

    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!ACCEPTED_TYPES.includes(ext)) {
      setError(`${file.name}: unsupported type.`);
      return;
    }

    try {
      const content = await file.text();
      const attachment: LocalAttachment = {
        id: uuidv4(),
        name: file.name,
        contentType: file.type || 'text/plain',
        size: file.size,
        content,
        uploadedAt: new Date().toISOString(),
        scope: 'message',
      };
      onAdd(attachment);
    } catch (err) {
      setError(`Failed to read ${file.name}`);
    }
  }, [onAdd]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      await processFile(file);
    }
    if (inputRef.current) inputRef.current.value = ''; 
  }, [processFile]);

  return (
    <div className="relative flex-shrink-0">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="flex-shrink-0 w-10 h-10 rounded-lg bg-surface-elevated border border-surface-overlay text-gray-400 hover:text-white hover:bg-surface-overlay/80 disabled:opacity-40 disabled:text-gray-600 flex items-center justify-center transition-colors"
        title="Attach files (.v, .sv, .md, .toml, ...)"
      >
        <Paperclip size={16} />
      </button>

      {error && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-error text-white text-[11px] p-2 rounded-lg shadow-xl font-mono z-50 flex items-start gap-1.5 border border-error/30">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="leading-snug">{error}</p>
            <button 
              type="button" 
              onClick={() => setError(null)} 
              className="text-[10px] underline block mt-1 text-gray-200 hover:text-white font-semibold"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Queue List / Preview Row Component
interface AttachmentBarProps {
  attachments: LocalAttachment[];
  onRemove: (id: string) => void;
}

export function AttachmentBar({ attachments, onRemove }: AttachmentBarProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2 p-2 rounded-lg bg-surface-elevated/30 border border-surface-overlay/50 max-h-32 overflow-y-auto w-full transition-all">
      {attachments.map((att) => (
        <AttachmentChip key={att.id} attachment={att} onRemove={() => onRemove(att.id)} />
      ))}
    </div>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: LocalAttachment; onRemove: () => void }) {
  const [showPreview, setShowPreview] = useState(false);
  const sizeKb = (attachment.size / 1024).toFixed(1);

  return (
    <>
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-elevated border border-surface-overlay group hover:border-gray-500 transition-colors">
        {getFileIcon(attachment.name)}
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className="text-xs font-mono text-gray-300 hover:text-white transition-colors truncate max-w-[180px]"
        >
          {attachment.name}
        </button>
        <span className="text-[10px] text-gray-600 font-mono">{sizeKb}KB</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-500 hover:text-error transition-colors ml-0.5"
        >
          <X size={12} />
        </button>
      </div>

      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="bg-surface-raised border border-surface-overlay rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-overlay">
              <div className="flex items-center gap-2">
                {getFileIcon(attachment.name)}
                <span className="text-xs font-mono text-gray-300">{attachment.name}</span>
                <span className="text-[10px] text-gray-600 font-mono">{sizeKb} KB</span>
              </div>
              <button onClick={() => setShowPreview(false)} className="text-gray-600 hover:text-white">
                <X size={14} />
              </button>
            </div>
            <pre className="flex-1 overflow-auto px-4 py-3 text-[11px] font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">
              {attachment.content}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}