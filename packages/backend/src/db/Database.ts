import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import { ConfigManager } from '../config/ConfigManager';
import { MIGRATIONS } from './migrations';
import { logger } from '../utils/logger';

// Single shared SQLite connection (same singleton pattern as ModelRouter/TelemetryService).
// WAL mode allows concurrent readers alongside a writer, which matters once auth/session/project
// routes and the Orchestrator's telemetry logging are all hitting the same file.
export class Db {
  private static instance: BetterSqlite3.Database | undefined;

  static getInstance(): BetterSqlite3.Database {
    if (!Db.instance) {
      const { telemetryRoot } = ConfigManager.getInstance().get().paths;
      const dbPath = path.join(telemetryRoot ?? path.resolve(process.cwd(), '../../telemetry'), 'app.db');
      Db.instance = new BetterSqlite3(dbPath);
      Db.instance.pragma('journal_mode = WAL');
      Db.instance.pragma('foreign_keys = ON');
      runMigrations(Db.instance);
      logger.info('Database connected', { dbPath });
    }
    return Db.instance;
  }
}

function runMigrations(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((row) => (row as { name: string }).name),
  );

  const insertMigration = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    const runMigration = db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.name, new Date().toISOString());
    });
    runMigration();
    logger.info('Applied database migration', { name: migration.name });
  }
}
