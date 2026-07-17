// One-time migration: reads the existing JSON/JSONL files SessionService/ProjectService/
// TelemetryService used to read/write directly, and inserts them into the new SQLite DB.
// Safe to re-run — skips anything already present by ID (or, for telemetry events, skips a
// whole file if that session already has any events, since individual events have no natural
// dedup key). The source files are never modified or deleted.
//
// Run via: pnpm --filter backend run migrate:legacy

import fs from 'fs/promises';
import path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { Db } from './Database';
import { SessionRepository } from './repositories/SessionRepository';
import { ProjectRepository } from './repositories/ProjectRepository';
import { TelemetryRepository } from './repositories/TelemetryRepository';
import type { Project } from '@agent_design/shared/types';

async function readJsonSafe<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const { telemetryRoot } = ConfigManager.getInstance().get().paths;
  const root = telemetryRoot ?? path.resolve(process.cwd(), '../../telemetry');

  Db.getInstance(); // ensures schema is created before anything below runs

  const sessionRepo = new SessionRepository();
  const projectRepo = new ProjectRepository();
  const telemetryRepo = new TelemetryRepository();

  // Projects first — sessions FK to projects.
  const legacyProjects = await readJsonSafe<Project & { sessionIds?: string[] }>(path.join(root, 'projects.json'));
  let projectCount = 0;
  for (const p of legacyProjects) {
    if (projectRepo.getProject(p.id)) continue;
    projectRepo.createProject({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      condition: p.condition,
      workspaceDir: p.workspaceDir,
      agentIds: p.agentIds ?? [],
      skillFiles: p.skillFiles ?? [],
      color: p.color,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
    projectCount++;
  }

  // Sessions + their embedded messages.
  const legacySessions = await readJsonSafe<any>(path.join(root, 'sessions.json'));
  let sessionCount = 0;
  let messageCount = 0;
  for (const s of legacySessions) {
    if (sessionRepo.exists(s.id)) continue;
    sessionRepo.upsert({
      id: s.id,
      condition: s.condition,
      title: s.title,
      projectId: s.projectId,
      agentIds: s.agentIds ?? [],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    });
    sessionCount++;
    for (const m of s.messages ?? []) {
      sessionRepo.addMessage(
        s.id,
        { id: m.id, role: m.role, content: m.content, agentId: m.agentId, timestamp: m.timestamp },
        s.updatedAt,
      );
      messageCount++;
    }
  }

  // Summaries (no natural ID in the old format — dedup by exact projectId+agentId+timestamp).
  const legacySummaries = await readJsonSafe<any>(path.join(root, 'summaries.json'));
  let summaryCount = 0;
  for (const summary of legacySummaries) {
    const existing = projectRepo.getSummariesForProject(summary.projectId);
    const alreadyPresent = existing.some(
      (s) => s.agentId === summary.agentId && s.timestamp === summary.timestamp,
    );
    if (alreadyPresent) continue;
    projectRepo.addSummary(summary);
    summaryCount++;
  }

  // Attachments (rows only — the underlying files on disk are untouched either way).
  const legacyAttachments = await readJsonSafe<any>(path.join(root, 'attachments.json'));
  let attachmentCount = 0;
  for (const attachment of legacyAttachments) {
    if (projectRepo.getAttachmentById(attachment.id)) continue;
    projectRepo.addAttachment(attachment);
    attachmentCount++;
  }

  // Telemetry experiment JSONL logs.
  let eventCount = 0;
  let skippedFiles = 0;
  try {
    const experimentsDir = path.join(root, 'experiments');
    const files = (await fs.readdir(experimentsDir)).filter((f) => f.endsWith('.jsonl'));
    for (const file of files) {
      const content = await fs.readFile(path.join(experimentsDir, file), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length === 0) continue;

      const firstEvent = JSON.parse(lines[0]);
      const sessionId = firstEvent.sessionId;
      const alreadyMigrated = (Db.getInstance().prepare('SELECT COUNT(*) as c FROM telemetry_events WHERE session_id = ?').get(sessionId) as { c: number }).c > 0;
      if (alreadyMigrated) {
        skippedFiles++;
        continue;
      }

      for (const line of lines) {
        try {
          telemetryRepo.insert(JSON.parse(line));
          eventCount++;
        } catch {
          // skip malformed line, don't abort the whole file
        }
      }
    }
  } catch {
    // no experiments/ directory — nothing to migrate
  }

  console.log(
    `Legacy data migration complete: ${projectCount} projects, ${sessionCount} sessions ` +
    `(${messageCount} messages), ${summaryCount} summaries, ${attachmentCount} attachments, ` +
    `${eventCount} telemetry events (${skippedFiles} session logs already migrated, skipped).`,
  );
}

main().catch((err) => {
  console.error('Legacy data migration failed:', err);
  process.exit(1);
});
