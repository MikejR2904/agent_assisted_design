'use client';

import { useEffect, useCallback, useState } from 'react';
import { filesApi } from '@/lib/api/client';
import type { FileEntry } from '@/lib/api/client';
import { useTelemetryStore } from '@/lib/stores/telemetryStore';

interface UseFileWatcherOptions {
  pollIntervalMs?: number;
  enabled?: boolean;
}

export function useFileWatcher(options: UseFileWatcherOptions = {}) {
  const { pollIntervalMs = 4000, enabled = true } = options;
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { condition } = useTelemetryStore();

  const refresh = useCallback(async () => {
    if (!condition) return;
    try {
      const tree = await filesApi.tree(condition);
      setFiles(tree);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [condition]);

  // Initial load
  useEffect(() => {
    if (!condition || !enabled) return;
    setIsLoading(true);
    refresh().finally(() => setIsLoading(false));
  }, [condition, enabled, refresh]);

  // Polling
  useEffect(() => {
    if (!condition || !enabled) return;
    const id = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(id);
  }, [condition, enabled, pollIntervalMs, refresh]);

  return { files, isLoading, error, refresh };
}