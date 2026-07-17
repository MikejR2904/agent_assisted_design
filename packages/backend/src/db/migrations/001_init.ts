// Migration SQL lives in a .ts template string (not a standalone .sql file) so it's compiled into
// dist/ automatically by tsc — the backend's tsconfig only includes src/**/*.ts, and a separate
// asset-copy build step wasn't worth adding for one file.
export const migration_001_init = `
-- Core schema for session/project/telemetry/user persistence, replacing the previous
-- whole-file-rewrite JSON storage in SessionService/ProjectService/TelemetryService.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'engineer',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'agent-assisted',
  workspace_dir TEXT NOT NULL,
  agent_ids TEXT NOT NULL DEFAULT '[]',
  skill_files TEXT NOT NULL DEFAULT '[]',
  color TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- sessionIds on Project used to be a redundant, manually-synced JSON array (addSessionToProject).
-- Normalized here: a session belongs to a project via this FK; ProjectRepository derives
-- sessionIds by querying instead of storing it twice.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  condition TEXT NOT NULL,
  title TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  agent_ids TEXT NOT NULL DEFAULT '[]',
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_id TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

CREATE TABLE IF NOT EXISTS agent_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_project_id ON agent_summaries(project_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_project_id ON attachments(project_id);

-- Full event payload kept as JSON (the discriminated union in telemetry.types.ts has ~11 shapes
-- with different fields) alongside a few pulled-out, indexed columns for fast filtering/queries
-- (HCR/FPAR/PPA-drift computation, etc.) without needing json_extract() on every query.
CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  type TEXT NOT NULL,
  task_id TEXT,
  timestamp TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_session_id ON telemetry_events(session_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_type ON telemetry_events(type);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_session_type ON telemetry_events(session_id, type);
`;
