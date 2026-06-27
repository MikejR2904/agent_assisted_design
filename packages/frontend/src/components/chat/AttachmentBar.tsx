'use client';

import { useRef, useState, useCallback } from 'react';
import { Paperclip, X, FileText, AlertTriangle, Upload } from 'lucide-react';
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

interface AttachmentBarProps {
  attachments: LocalAttachment[];
  onAdd: (attachment: LocalAttachment) => void;
  onRemove: (id: string) => void;
}

export function AttachmentBar({ attachments, onAdd, onRemove }: AttachmentBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    setError(null);

    // Size check
    if (file.size > MAX_SIZE_BYTES) {
      setError(`${file.name} is too large (max 200 KB)`);
      return;
    }

    // Type check
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!ACCEPTED_TYPES.includes(ext)) {
      setError(`${file.name}: unsupported type. Accepted: ${ACCEPTED_TYPES.join(', ')}`);
      return;
    }

    const content = await file.text();
    const attachment: LocalAttachment  = {
      id: uuidv4(),
      name: file.name,
      contentType: file.type || 'text/plain',
      size: file.size,
      content,
      uploadedAt: new Date().toISOString(),
      scope: 'message',
    };
    onAdd(attachment);
  }, [onAdd]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      await processFile(file);
    }
  }, [processFile]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  if (attachments.length === 0) {
    // Collapsed — show only the attach button
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={clsx(
            'flex items-center gap-1 p-1.5 rounded text-gray-600 hover:text-gray-300 transition-colors',
            isDragging && 'text-accent bg-accent/10',
          )}
          title="Attach files (SKILL.md, TOOL.md, .v, .toml, …)"
        >
          <Paperclip size={14} />
        </button>
        {error && (
          <span className="text-[9px] text-error font-mono truncate max-w-[160px]">{error}</span>
        )}
      </div>
    );
  }

  // Expanded — show chips + add button
  return (
    <div
      className={clsx(
        'flex flex-wrap gap-1.5 p-2 border-t border-surface-overlay bg-surface-raised transition-colors',
        isDragging && 'bg-accent/5 border-accent/30',
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {attachments.map((att) => (
        <AttachmentChip key={att.id} attachment={att} onRemove={() => onRemove(att.id)} />
      ))}

      {/* Add more */}
      <button
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1 px-2 py-1 rounded border border-dashed border-surface-overlay text-gray-600 hover:border-gray-500 hover:text-gray-400 text-[10px] font-mono transition-colors"
      >
        <Upload size={10} /> Add file
      </button>

      {error && (
        <div className="w-full flex items-center gap-1.5 text-[10px] text-error font-mono">
          <AlertTriangle size={10} /> {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: LocalAttachment; onRemove: () => void }) {
  const [showPreview, setShowPreview] = useState(false);
  const sizeKb = (attachment.size / 1024).toFixed(1);

  return (
    <>
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-elevated border border-surface-overlay group">
        {getFileIcon(attachment.name)}
        <button
          onClick={() => setShowPreview(true)}
          className="text-[10px] font-mono text-gray-300 hover:text-white transition-colors"
        >
          {attachment.name}
        </button>
        <span className="text-[9px] text-gray-600 font-mono">{sizeKb}KB</span>
        <button
          onClick={onRemove}
          className="text-gray-600 hover:text-error transition-colors ml-0.5"
        >
          <X size={10} />
        </button>
      </div>

      {/* Preview modal */}
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