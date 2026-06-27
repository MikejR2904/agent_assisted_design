'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, Lock, ChevronRight, ChevronDown, Upload, FolderUp, FileArchive, Terminal, Trash2 } from 'lucide-react';
import { useTelemetryStore } from '../../lib/stores/telemetryStore';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  locked?: boolean;
  children?: FileEntry[];
}

interface FileExplorerProps {
  onFileSelect: (path: string) => void;
  selectedPath?: string;
  onTerminalToggle?: () => void;
}

export function FileExplorer({ onFileSelect, selectedPath, onTerminalToggle }: FileExplorerProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const { condition } = useTelemetryStore();

  const fetchFiles = useCallback(async () => {
    if (!condition) return;
    try {
      const res = await fetch(`/api/files/tree?condition=${condition}`);
      if (res.ok) {
        const data = await res.json() as FileEntry[];
        console.log('File tree received:', data);
        setFiles(data);
      }
    } catch (err) {
      console.error('Failed to fetch file tree', err);
      toast.error('Failed to load file tree');
    }
  }, [condition]);

  useEffect(() => {
    fetchFiles();
    const interval = setInterval(fetchFiles, 5000);
    return () => clearInterval(interval);
  }, [fetchFiles]);

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Delete handlers
  const handleDelete = async (path: string) => {
    const effectiveCondition = condition || 'agent-assisted';
    if (!confirm(`Delete "${path}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(
        `/api/files/delete?path=${encodeURIComponent(path)}&condition=${encodeURIComponent(effectiveCondition)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      toast.success(`🗑️ Deleted: ${path}`);
      await fetchFiles();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  // Upload handlers
  const uploadFiles = async (files: FileList, preservePaths = false) => {
    if (!condition || files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('condition', condition);

    // For folder upload, we want to preserve relative paths.
    // The webkitdirectory input gives full relative paths in file.webkitRelativePath.
    for (const file of files) {
      const relativePath = preservePaths && (file as any).webkitRelativePath
        ? (file as any).webkitRelativePath
        : file.name;
      formData.append('files', file, relativePath);
    }

    try {
      const res = await fetch('/api/files/upload-folder', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        toast.success(`✅ Uploaded ${files.length} file(s)`);
        await fetchFiles();
      } else {
        const err = await res.text();
        toast.error(`❌ Upload failed: ${err}`);
        console.error('Upload failed', err);
      }
    } catch (err) {
      console.error('Upload error', err);
      toast.error('❌ Network error during upload');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) uploadFiles(files, false);
    e.target.value = '';
  };

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) uploadFiles(files, true);
    e.target.value = '';
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !condition) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('zip', file);
    formData.append('condition', condition);
    try {
      const res = await fetch('/api/files/upload-zip', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        fetchFiles();
      } else {
        console.error('ZIP upload failed', await res.text());
      }
    } catch (err) {
      console.error('ZIP upload error', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Drag and drop (supports multiple files)
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;
    // Check if it's a folder (contains items with webkitGetAsEntry)
    const files: File[] = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        // If it's a file, add it; if directory, we need to traverse.
        if (entry.isFile) {
          const file = await new Promise<File>((resolve) => (item as any).getAsFile((f: File) => resolve(f)));
          if (file) files.push(file);
        }
      } else {
        // Fallback
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    // For simplicity, upload as files (no folder structure preserved)
    const formData = new FormData();
    formData.append('condition', condition || 'agent-assisted');
    files.forEach((f) => formData.append('files', f, f.name));
    try {
      await fetch('/api/files/upload-folder', { method: 'POST', body: formData });
      fetchFiles();
    } catch (err) {
      console.error('Drop upload failed', err);
    }
  };

  // Render terminal
  const toggleTerminal = () => {
    setShowTerminal(!showTerminal);
    if (onTerminalToggle) onTerminalToggle();
  };

  return (
    <div className="flex flex-col h-full bg-surface-raised border-r border-surface-overlay relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-overlay">
        <span className="text-xs font-mono text-gray-400 uppercase tracking-wider">Files</span>
        <div className="flex items-center gap-1">
          {/* Upload File */}
          <label className="cursor-pointer text-gray-600 hover:text-accent transition-colors" title="Upload file">
            <Upload size={12} />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>

          {/* Upload Folder */}
          <label className="cursor-pointer text-gray-600 hover:text-accent transition-colors" title="Upload folder">
            <FolderUp size={12} />
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              {...{ webkitdirectory: '' } as any}
              onChange={handleFolderUpload}
              disabled={uploading}
            />
          </label>

          {/* Upload ZIP */}
          <label className="cursor-pointer text-gray-600 hover:text-accent transition-colors" title="Upload ZIP archive">
            <FileArchive size={12} />
            <input
              ref={zipInputRef}
              type="file"
              className="hidden"
              accept=".zip"
              onChange={handleZipUpload}
              disabled={uploading}
            />
          </label>

          {/* Terminal Toggle */}
          <button
            onClick={toggleTerminal}
            className={clsx(
              'text-gray-600 hover:text-accent transition-colors',
              showTerminal && 'text-accent',
            )}
            title="Toggle terminal"
          >
            <Terminal size={12} />
          </button>
        </div>
      </div>

      {/* File Tree */}
      <div
        className={clsx(
          'flex-1 overflow-y-auto py-1',
          isDragging && 'ring-1 ring-accent/50',
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {condition ? (
          files.length > 0 ? (
            files.map((entry) => (
              <FileNode
                key={entry.path}
                entry={entry}
                depth={0}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={toggleExpand}
                onSelect={onFileSelect}
                onDelete={handleDelete}
              />
            ))
          ) : (
            <p className="text-xs text-gray-600 font-mono px-3 py-2">Empty workspace</p>
          )
        ) : (
          <p className="text-xs text-gray-600 font-mono px-3 py-2">Initialize workspace first</p>
        )}
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-accent/5 border-2 border-dashed border-accent/50 rounded flex items-center justify-center pointer-events-none">
          <p className="text-accent text-sm font-mono">Drop files/folders</p>
        </div>
      )}

      {/* Uploading indicator */}
      {uploading && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-surface-elevated border border-accent/30 rounded px-4 py-1.5 text-xs text-accent font-mono flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Uploading...
        </div>
      )}
    </div>
  );
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  selectedPath?: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
}

function FileNode({ entry, depth, expanded, selectedPath, onToggle, onSelect, onDelete }: FileNodeProps) {
  const isOpen = expanded.has(entry.path);
  const isSelected = entry.path === selectedPath;

  const handleClick = () => {
    if (entry.type === 'directory') {
      onToggle(entry.path);
    } else {
      onSelect(entry.path);
    }
  };

  // Don't allow deletion of locked files
  const canDelete = !entry.locked;

  return (
    <div>
      <div
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        className={clsx(
          'w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-overlay transition-colors group',
          isSelected && 'bg-accent/10 text-accent',
          !isSelected && 'text-gray-400',
        )}
        style={{ paddingLeft: `${(depth + 1) * 12}px` }}
      >
        {entry.type === 'directory' ? (
          <>
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Folder size={13} className={clsx(isOpen ? 'text-accent' : 'text-gray-500')} />
          </>
        ) : (
          <>
            <span className="w-3" />
            {entry.locked
              ? <Lock size={12} className="text-warning" />
              : <File size={12} className={isSelected ? 'text-accent' : 'text-gray-600'} />
            }
          </>
        )}
        <span className="text-xs font-mono truncate">{entry.name}</span>
        {entry.locked && (
          <span className="ml-auto text-xs text-warning opacity-60">🔒</span>
        )}

        {/* Delete button – visible on hover */}
        {canDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry.path);
            }}
            className={clsx(
              'opacity-0 group-hover:opacity-100 transition-opacity',
              'text-gray-500 hover:text-error p-0.5 rounded',
            )}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {entry.type === 'directory' && isOpen && entry.children?.map((child) => (
        <FileNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}