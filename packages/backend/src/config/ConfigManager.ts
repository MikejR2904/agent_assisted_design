import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AppConfigSchema, type AppConfig } from '@agent_design/shared/schemas';

// Generated once per process (not per load()/reload() call) so hot-reloading config/app.json
// never rotates the JWT secret out from under already-issued tokens. Only actually used as the
// final fallback when nothing else supplies auth.jwtSecret — see load() below.
const RANDOM_JWT_SECRET_FALLBACK = crypto.randomBytes(32).toString('hex');
let warnedAboutRandomSecret = false;

// Standardizes on process.cwd()-relative resolution (cwd = packages/backend under the `pnpm
// --filter backend dev/start` scripts) — the convention already used by ProviderConfigLoader,
// agents.routes.ts, files.routes.ts, and most of the codebase. server.ts previously used
// __dirname-relative resolution instead; that inconsistency is exactly the kind of scatter this
// class replaces.
const REPO_ROOT = path.resolve(process.cwd(), '../..');
export const APP_CONFIG_FILE = path.resolve(REPO_ROOT, 'config', 'app.json');

function computePathDefaults() {
  return {
    workspaceRoot: path.resolve(REPO_ROOT, 'workspaces'),
    configRoot: path.resolve(REPO_ROOT, 'config'),
    skillsRoot: path.resolve(REPO_ROOT, 'skills'),
    telemetryRoot: path.resolve(REPO_ROOT, 'telemetry'),
  };
}

function readAppConfigFile(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(APP_CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // Missing/invalid config/app.json is the expected default state — env vars and schema
    // defaults cover everything.
    return {};
  }
}

function readEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, any> = {};
  if (process.env.PORT) overrides.server = { port: parseInt(process.env.PORT, 10) };
  if (process.env.FRONTEND_URL) overrides.server = { ...overrides.server, frontendUrl: process.env.FRONTEND_URL };
  if (process.env.LOG_LEVEL) overrides.telemetry = { logLevel: process.env.LOG_LEVEL };
  if (process.env.DOCKER_ENABLED) overrides.docker = { enabled: process.env.DOCKER_ENABLED === 'true' };
  if (process.env.DOCKER_IMAGE) overrides.docker = { ...overrides.docker, image: process.env.DOCKER_IMAGE };
  if (process.env.JWT_SECRET) overrides.auth = { jwtSecret: process.env.JWT_SECRET };

  const paths: Record<string, string> = {};
  if (process.env.WORKSPACE_ROOT) paths.workspaceRoot = process.env.WORKSPACE_ROOT;
  if (process.env.CONFIG_ROOT) paths.configRoot = process.env.CONFIG_ROOT;
  if (process.env.SKILLS_ROOT) paths.skillsRoot = process.env.SKILLS_ROOT;
  if (process.env.TELEMETRY_ROOT) paths.telemetryRoot = process.env.TELEMETRY_ROOT;
  if (Object.keys(paths).length) overrides.paths = paths;

  return overrides;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return (override === undefined ? base : (override as T));
  }
  const result: any = { ...base };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    result[key] = deepMerge((base as any)?.[key], value);
  }
  return result;
}

// Single source of truth for app configuration. Precedence, lowest to highest:
// computed path defaults  <  config/app.json (optional, git-ignored)  <  environment variables
// <  Zod schema defaults for anything still unset.
export class ConfigManager {
  private static instance: ConfigManager | undefined;
  private config: AppConfig;

  private constructor() {
    this.config = ConfigManager.load();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  get(): AppConfig {
    return this.config;
  }

  // Re-reads config/app.json and env vars, re-validates, and swaps the in-memory snapshot.
  // Called by hotReload.ts when config/app.json changes. Note: server.port and paths.* are read
  // once at process startup by things like the HTTP listener and the logger's file transport —
  // changing them here won't rebind those without a restart.
  reload(): AppConfig {
    this.config = ConfigManager.load();
    return this.config;
  }

  private static load(): AppConfig {
    const merged = deepMerge(
      { paths: computePathDefaults() },
      deepMerge(readAppConfigFile(), readEnvOverrides()),
    );
    const config = AppConfigSchema.parse(merged);

    if (!config.auth.jwtSecret) {
      config.auth.jwtSecret = RANDOM_JWT_SECRET_FALLBACK;
      if (!warnedAboutRandomSecret) {
        warnedAboutRandomSecret = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[ConfigManager] No auth.jwtSecret configured (JWT_SECRET env var or config/app.json) — ' +
          'using a randomly generated secret for this process. Tokens will stop validating on restart. ' +
          'Set JWT_SECRET for a stable secret.',
        );
      }
    }

    return config;
  }
}
