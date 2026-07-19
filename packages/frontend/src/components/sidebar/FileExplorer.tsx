'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, Lock, ChevronRight, ChevronDown, Upload, FolderUp, FileArchive, Terminal, Trash2, ChevronsDownUp, ChevronsUpDown, Scissors, Copy, ClipboardPaste, Pencil } from 'lucide-react';
import { useTelemetryStore } from '../../lib/stores/telemetryStore';
import { filesApi } from '../../lib/api/client';
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

// Same color convention as `langColor()` in chat/MessageBubble.tsx, reused for file-tree icons.
function fileIconColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    v: 'text-purple-300',
    sv: 'text-purple-300',
    vh: 'text-purple-300',
    tcl: 'text-blue-300',
    py: 'text-yellow-300',
    sh: 'text-green-300',
    json: 'text-orange-300',
    md: 'text-blue-300',
    toml: 'text-teal-300',
    ts: 'text-sky-300',
    tsx: 'text-sky-300',
    js: 'text-yellow-200',
  };
  return map[ext] ?? 'text-gray-600';
}

// Entry paths may come back backslash- or forward-slash-separated depending on the backend
// OS (path.join is platform-dependent); split on either so move/rename works regardless.
function pathSegments(p: string): string[] {
  return p.split(/[/\\]/).filter(Boolean);
}
function baseName(p: string): string {
  const segs = pathSegments(p);
  return segs[segs.length - 1] ?? p;
}
function parentDir(p: string): string {
  const segs = pathSegments(p);
  segs.pop();
  return segs.join('/');
}
function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}
function isDescendantOrSelf(path: string, maybeAncestor: string): boolean {
  return path === maybeAncestor || path.startsWith(`${maybeAncestor}/`) || path.startsWith(`${maybeAncestor}\\`);
}

/** Recursively collect every directory path in the tree, for expand-all. */
function collectDirPaths(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'directory') {
      paths.push(entry.path);
      if (entry.children) paths.push(...collectDirPaths(entry.children));
    }
  }
  return paths;
}

function FileTreeSkeleton() {
  const widths = ['70%', '50%', '85%', '60%', '45%'];
  return (
    <div className="px-3 py-2 space-y-2">
      {widths.map((w, i) => (
        <div
          key={i}
          className="h-3 rounded bg-surface-overlay animate-pulse"
          style={{ width: w, marginLeft: i % 2 === 1 ? 16 : 0 }}
        />
      ))}
    </div>
  );
}

export function FileExplorer({ onFileSelect, selectedPath, onTerminalToggle }: FileExplorerProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [clipboard, setClipboard] = useState<{ path: string; mode: 'cut' | 'copy' } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
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
    } finally {
      setIsLoadingTree(false);
    }
  }, [condition]);

  useEffect(() => {
    setIsLoadingTree(true);
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

  const expandAll = () => setExpanded(new Set(collectDirPaths(files)));
  const collapseAll = () => setExpanded(new Set());

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

  // Move / rename / copy-paste handlers
  const handleMove = async (sourcePath: string, destDir: string) => {
    const effectiveCondition = condition || 'agent-assisted';
    if (isDescendantOrSelf(destDir, sourcePath)) {
      toast.error("Can't move a folder into itself");
      return;
    }
    const destPath = joinPath(destDir, baseName(sourcePath));
    try {
      await filesApi.move(effectiveCondition, sourcePath, destPath);
      toast.success(`Moved to ${destDir || '/'}`);
      await fetchFiles();
    } catch (err) {
      toast.error(`Move failed: ${(err as Error).message}`);
    }
  };

  const handleRenameSubmit = async (entry: FileEntry, newName: string) => {
    setRenamingPath(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === entry.name) return;
    const effectiveCondition = condition || 'agent-assisted';
    const destPath = joinPath(parentDir(entry.path), trimmed);
    try {
      await filesApi.move(effectiveCondition, entry.path, destPath);
      toast.success(`Renamed to ${trimmed}`);
      await fetchFiles();
    } catch (err) {
      toast.error(`Rename failed: ${(err as Error).message}`);
    }
  };

  const handlePaste = async (targetDir: string) => {
    if (!clipboard) return;
    const effectiveCondition = condition || 'agent-assisted';
    if (isDescendantOrSelf(targetDir, clipboard.path)) {
      toast.error("Can't paste a folder into itself");
      return;
    }
    const destPath = joinPath(targetDir, baseName(clipboard.path));
    try {
      if (clipboard.mode === 'copy') {
        await filesApi.copy(effectiveCondition, clipboard.path, destPath);
      } else {
        await filesApi.move(effectiveCondition, clipboard.path, destPath);
      }
      setClipboard(null);
      await fetchFiles();
    } catch (err) {
      toast.error(`Paste failed: ${(err as Error).message}`);
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

  const handleNodeContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const handleBackgroundContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry: { name: 'workspace root', path: '', type: 'directory' } });
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

          {/* Expand / Collapse all */}
          <button
            onClick={expandAll}
            className="text-gray-600 hover:text-accent transition-colors"
            title="Expand all"
          >
            <ChevronsUpDown size={12} />
          </button>
          <button
            onClick={collapseAll}
            className="text-gray-600 hover:text-accent transition-colors"
            title="Collapse all"
          >
            <ChevronsDownUp size={12} />
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
        onContextMenu={handleBackgroundContextMenu}
      >
        {condition ? (
          isLoadingTree ? (
            <FileTreeSkeleton />
          ) : files.length > 0 ? (
            files.map((entry) => (
              <FileNode
                key={entry.path}
                entry={entry}
                depth={0}
                expanded={expanded}
                selectedPath={selectedPath}
                renamingPath={renamingPath}
                onToggle={toggleExpand}
                onSelect={onFileSelect}
                onDelete={handleDelete}
                onMove={handleMove}
                onContextMenu={handleNodeContextMenu}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenamingPath(null)}
              />
            ))
          ) : (
            <p className="text-xs text-gray-600 font-mono px-3 py-2">Empty workspace</p>
          )
        ) : (
          <p className="text-xs text-gray-600 font-mono px-3 py-2">Initialize workspace first</p>
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div
            className="fixed z-50 bg-surface-elevated border border-surface-overlay rounded shadow-xl py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.entry.path !== '' && !contextMenu.entry.locked && (
              <MenuItem
                icon={<Pencil size={12} />}
                label="Rename"
                onClick={() => { setRenamingPath(contextMenu.entry.path); setContextMenu(null); }}
              />
            )}
            {contextMenu.entry.path !== '' && !contextMenu.entry.locked && (
              <MenuItem
                icon={<Scissors size={12} />}
                label="Cut"
                onClick={() => { setClipboard({ path: contextMenu.entry.path, mode: 'cut' }); setContextMenu(null); }}
              />
            )}
            {contextMenu.entry.path !== '' && (
              <MenuItem
                icon={<Copy size={12} />}
                label="Copy"
                onClick={() => { setClipboard({ path: contextMenu.entry.path, mode: 'copy' }); setContextMenu(null); }}
              />
            )}
            {(contextMenu.entry.type === 'directory') && (
              <MenuItem
                icon={<ClipboardPaste size={12} />}
                label="Paste"
                disabled={!clipboard}
                onClick={() => { handlePaste(contextMenu.entry.path); setContextMenu(null); }}
              />
            )}
            {contextMenu.entry.path !== '' && !contextMenu.entry.locked && (
              <MenuItem
                icon={<Trash2 size={12} />}
                label="Delete"
                danger
                onClick={() => { handleDelete(contextMenu.entry.path); setContextMenu(null); }}
              />
            )}
          </div>
        </>
      )}

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

function MenuItem({
  icon, label, onClick, disabled, danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs font-mono transition-colors',
        'hover:bg-surface-overlay disabled:opacity-30 disabled:hover:bg-transparent',
        danger ? 'text-error' : 'text-gray-300',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  selectedPath?: string;
  renamingPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onMove: (sourcePath: string, destDir: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onRenameSubmit: (entry: FileEntry, newName: string) => void;
  onRenameCancel: () => void;
}

function FileNode({
  entry, depth, expanded, selectedPath, renamingPath,
  onToggle, onSelect, onDelete, onMove, onContextMenu, onRenameSubmit, onRenameCancel,
}: FileNodeProps) {
  const isOpen = expanded.has(entry.path);
  const isSelected = entry.path === selectedPath;
  const isRenaming = renamingPath === entry.path;
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.name);

  const handleClick = () => {
    if (entry.type === 'directory') {
      onToggle(entry.path);
    } else {
      onSelect(entry.path);
    }
  };

  // Don't allow deletion/move/rename of locked files
  const canModify = !entry.locked;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/x-file-path', entry.path);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (entry.type !== 'directory') return;
    if (!e.dataTransfer.types.includes('text/x-file-path')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (entry.type !== 'directory') return;
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
    const sourcePath = e.dataTransfer.getData('text/x-file-path');
    if (sourcePath && sourcePath !== entry.path) {
      onMove(sourcePath, entry.path);
    }
  };

  return (
    <div>
      {isRenaming ? (
        <div
          className="w-full flex items-center gap-1.5 px-2 py-1"
          style={{ paddingLeft: `${(depth + 1) * 12}px` }}
        >
          <span className="w-3" />
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => onRenameSubmit(entry, renameValue)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit(entry, renameValue);
              if (e.key === 'Escape') onRenameCancel();
            }}
            className="flex-1 bg-surface-elevated border border-accent/50 rounded px-1.5 py-0.5 text-xs font-mono text-white focus:outline-none"
          />
        </div>
      ) : (
        <div
          onClick={handleClick}
          onContextMenu={(e) => onContextMenu(e, entry)}
          role="button"
          tabIndex={0}
          draggable={canModify}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDropTarget(false)}
          onDrop={handleDrop}
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
            isDropTarget && 'ring-1 ring-inset ring-accent/60 bg-accent/5',
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
                : <File size={12} className={isSelected ? 'text-accent' : fileIconColor(entry.name)} />
              }
            </>
          )}
          <span className="text-xs font-mono truncate">{entry.name}</span>
          {entry.locked && (
            <span className="ml-auto text-xs text-warning opacity-60">🔒</span>
          )}

          {/* Delete button – visible on hover */}
          {canModify && (
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
      )}

      {entry.type === 'directory' && isOpen && entry.children?.map((child) => (
        <FileNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          expanded={expanded}
          selectedPath={selectedPath}
          renamingPath={renamingPath}
          onToggle={onToggle}
          onSelect={onSelect}
          onDelete={onDelete}
          onMove={onMove}
          onContextMenu={onContextMenu}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </div>
  );
}