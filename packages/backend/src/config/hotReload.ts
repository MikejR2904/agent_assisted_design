import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import { ConfigManager, APP_CONFIG_FILE } from './ConfigManager';
import { logger } from '../utils/logger';

// Watches the config/ directory (not the app.json file path directly — a nonexistent file path
// isn't reliably watchable on every platform, notably Windows; ConfigService.watchSkillFiles
// uses the same directory-watch pattern) and reloads ConfigManager's in-memory snapshot whenever
// app.json is added or changed — app.json is optional, so "added after the server already
// started" is the common case, not just "changed". Logs which top-level sections actually
// changed. See ConfigManager.reload() for which fields do/don't take effect live.
export function startConfigHotReload(): FSWatcher {
  const watcher = chokidar.watch(path.dirname(APP_CONFIG_FILE), {
    persistent: false,
    ignoreInitial: true,
    depth: 0,
  });

  const handleChange = (changedPath: string) => {
    if (path.resolve(changedPath) !== APP_CONFIG_FILE) return;

    const before = ConfigManager.getInstance().get();
    const after = ConfigManager.getInstance().reload();

    const changedSections = (Object.keys(after) as (keyof typeof after)[])
      .filter((section) => JSON.stringify(before[section]) !== JSON.stringify(after[section]));

    logger.info('config/app.json changed — reloaded configuration', {
      changedSections,
    });
  };

  watcher.on('add', handleChange);
  watcher.on('change', handleChange);
  watcher.on('error', (err) => {
    logger.warn('Config hot-reload watcher error', { error: (err as Error).message });
  });

  return watcher;
}
