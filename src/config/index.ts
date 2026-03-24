import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('config');

/**
 * OpenLander configuration system.
 *
 * Config is stored at ~/.openlander/{env}/config.json.
 * Supports production and development environments with full isolation.
 * Forward-compatible with v0.5 — new fields are added with defaults,
 * existing configs never break.
 */

// --- Environment ---

/** Supported runtime environments. */
export type OpenLanderEnv = 'production' | 'development';

/** Whitelist of valid environment names. Prevents arbitrary path traversal. */
const VALID_ENVIRONMENTS: ReadonlySet<string> = new Set<string>(['production', 'development']);

/** Per-environment defaults for settings that must differ between environments. */
const ENV_DEFAULTS: Record<
  OpenLanderEnv,
  {
    serverPort: number;
    baseUrl: string;
    networkName: string;
    portRangeStart: number;
    portRangeEnd: number;
    traefikContainerName: string;
    traefikHttpPort: number;
    traefikDashboardPort: number;
  }
> = {
  production: {
    serverPort: 10114,
    baseUrl: 'http://localhost:10114',
    networkName: 'openlander-prod',
    portRangeStart: 10001,
    portRangeEnd: 10499,
    traefikContainerName: 'traefik-ol-prod',
    traefikHttpPort: 80,
    traefikDashboardPort: 8080,
  },
  development: {
    serverPort: 10214,
    baseUrl: 'http://localhost:10214',
    networkName: 'openlander-dev',
    portRangeStart: 10501,
    portRangeEnd: 10999,
    traefikContainerName: 'traefik-ol-dev',
    traefikHttpPort: 8180,
    traefikDashboardPort: 8280,
  },
};

/** Module-level current environment. Set once at startup via setEnvironment(). */
let currentEnv: OpenLanderEnv = 'production';

/**
 * Resolve the environment from OPENLANDER_ENV env var or CLI --env flag.
 * Returns 'production' if not set or invalid.
 */
export function resolveEnvironment(cliEnv?: string): OpenLanderEnv {
  const raw = cliEnv ?? process.env['OPENLANDER_ENV'] ?? 'production';
  if (VALID_ENVIRONMENTS.has(raw)) {
    return raw as OpenLanderEnv;
  }
  log.warn({ value: raw }, 'Invalid OPENLANDER_ENV value — falling back to production');
  return 'production';
}

/** Set the current environment for this process. Call once at startup. */
export function setEnvironment(env: OpenLanderEnv): void {
  if (!VALID_ENVIRONMENTS.has(env)) {
    throw new Error(
      `Invalid environment: ${env}. Must be one of: ${[...VALID_ENVIRONMENTS].join(', ')}`,
    );
  }
  currentEnv = env;
  log.info({ env }, 'Environment set');
}

/** Get the current environment. */
export function getEnvironment(): OpenLanderEnv {
  return currentEnv;
}

/** Get the environment-specific defaults. */
export function getEnvDefaults(env?: OpenLanderEnv): (typeof ENV_DEFAULTS)[OpenLanderEnv] {
  return ENV_DEFAULTS[env ?? currentEnv];
}

/** Reset environment to production (for testing only). */
export function _resetEnvironment(): void {
  currentEnv = 'production';
}

// --- Config schema ---

export interface OpenLanderConfig {
  /** User-facing language for UI and agent responses */
  language: 'en' | 'ko';

  /** v0.1: LLM provider settings */
  llm: LLMProviderConfig;

  /** v0.1: Server settings */
  server: ServerConfig;

  /** v0.1: Docker settings */
  docker: DockerConfig;

  /** v0.1: Git settings */
  git: GitConfig;

  /** v0.2: Cloudflare settings */
  cloudflare: CloudflareConfig;

  /** v0.2: Monitoring settings */
  monitoring: MonitoringConfig;

  /** v0.3: MCP server settings */
  mcp: MCPConfig;

  /** v0.4: Channel/bot settings */
  channels: ChannelConfig;

  /** v0.5: Git hosting providers (GitHub, GitLab, etc.) */
  gitProviders: GitProvidersConfig;

  /** v0.5: Local model settings */
  localModel: LocalModelConfig;

  /** v0.9: Traefik reverse proxy settings */
  traefik: TraefikConfig;
}

export interface LLMProviderConfig {
  provider: 'gemini' | 'openrouter' | 'anthropic' | 'openai' | 'ollama';
  apiKey: string;
  model: string;
  /** v0.2: OAuth access token (used instead of apiKey when OAuth is active) */
  authToken: string;
  /** v0.5: Ollama endpoint for local models */
  ollamaEndpoint: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  /** Base URL for internal access */
  baseUrl: string;
}

export interface DockerConfig {
  socketPath: string;
  /** Network name for Traefik routing */
  networkName: string;
  /** Port range for managed containers */
  portRangeStart: number;
  portRangeEnd: number;
}

export interface GitConfig {
  sshKeyPath: string;
  /** Directory to store cloned repos */
  cloneDir: string;
}

export interface CloudflareConfig {
  /** API token for DNS + Tunnel management */
  apiToken: string;
  /** Tunnel ID for production domains */
  tunnelId: string;
  /** Account ID */
  accountId: string;
}

export interface MonitoringConfig {
  /** Healthcheck interval in seconds */
  healthcheckIntervalSec: number;
  /** Days of inactivity before suggesting cleanup */
  inactivityThresholdDays: number;
}

export interface McpServerEntry {
  /** Unique server identifier */
  id: string;
  /** Display name */
  name: string;
  /** Transport type */
  transport: 'stdio' | 'sse' | 'http';
  /** Server URL (for sse/http transports) */
  url?: string;
  /** Command to run (for stdio transport) */
  command?: string;
  /** Command arguments (for stdio transport) */
  args?: string[];
  /** HTTP headers (for sse/http transports) */
  headers?: Record<string, string>;
  /** Environment variables (for stdio transport) */
  env?: Record<string, string>;
  /** Whether this server is enabled */
  enabled: boolean;
}

export interface MCPConfig {
  /** Whether MCP server is enabled */
  enabled: boolean;
  /** MCP transport: stdio or sse */
  transport: 'stdio' | 'sse';
  /** External MCP servers the agent can consume tools from */
  servers: McpServerEntry[];
  /** Whether to expose platform tools (Docker, Git, etc.) via MCP */
  platformTools?: boolean;
}

export interface ChannelConfig {
  slack: { enabled: boolean; token: string; signingSecret: string; recoveryChannelId?: string };
  discord: {
    enabled: boolean;
    token: string;
    applicationId: string;
    publicKey: string;
    recoveryChannelId?: string;
  };
  telegram: { enabled: boolean; token: string; webhookSecret: string; recoveryChannelId?: string };
}

export interface LocalModelConfig {
  /** Whether to prefer local model over API */
  preferLocal: boolean;
  /** Model name for Ollama */
  modelName: string;
}

/** Traefik reverse proxy mode configuration. */
export interface TraefikConfig {
  /** Proxy mode: 'managed' (OpenLander runs Traefik) or 'external' (use existing Traefik). */
  mode: 'managed' | 'external';
  /** External mode: Name of the Docker network to connect containers to. */
  externalNetwork?: string;
}

export interface GitProviderEntry {
  /** Personal Access Token or API token */
  token: string;
  /** Cached username (set after token validation) */
  username: string;
  /** Base API URL (for self-hosted instances) */
  baseUrl?: string;
  /** Authentication method used */
  authMethod?: 'oauth' | 'pat';
}

export interface GitProvidersConfig {
  github: GitProviderEntry;
  gitlab: GitProviderEntry;
  // bitbucket: GitProviderEntry;  // future
  // gitea: GitProviderEntry;  // future
}

// --- Defaults ---

/** Build the default config for the current environment. */
function buildDefaultConfig(): OpenLanderConfig {
  const envDef = ENV_DEFAULTS[currentEnv];
  const dataDir = getDataDir();

  return {
    language: 'en',
    llm: {
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.0-flash',
      authToken: '',
      ollamaEndpoint: 'http://localhost:11434',
    },
    server: {
      port: envDef.serverPort,
      host: '0.0.0.0',
      baseUrl: envDef.baseUrl,
    },
    docker: {
      socketPath: '',
      networkName: envDef.networkName,
      portRangeStart: envDef.portRangeStart,
      portRangeEnd: envDef.portRangeEnd,
    },
    git: {
      sshKeyPath: join(homedir(), '.ssh', 'id_ed25519'),
      cloneDir: join(dataDir, 'repos'),
    },
    cloudflare: {
      apiToken: '',
      tunnelId: '',
      accountId: '',
    },
    monitoring: {
      healthcheckIntervalSec: 60,
      inactivityThresholdDays: 14,
    },
    mcp: {
      enabled: false,
      transport: 'stdio',
      servers: [],
      platformTools: false,
    },
    channels: {
      slack: { enabled: false, token: '', signingSecret: '', recoveryChannelId: '' },
      discord: {
        enabled: false,
        token: '',
        applicationId: '',
        publicKey: '',
        recoveryChannelId: '',
      },
      telegram: { enabled: false, token: '', webhookSecret: '', recoveryChannelId: '' },
    },
    gitProviders: {
      github: { token: '', username: '' },
      gitlab: { token: '', username: '' },
    },
    localModel: {
      preferLocal: false,
      modelName: 'openlander-agent',
    },
    traefik: {
      mode: 'managed',
      externalNetwork: undefined,
    },
  };
}

// --- Config Manager ---

const BASE_DIR = join(homedir(), '.openlander');

/** Get the path to the OpenLander data directory for the current environment. */
export function getDataDir(): string {
  return join(BASE_DIR, currentEnv);
}

/** Get the default database file path for the current environment. */
export function getDbPath(): string {
  return join(getDataDir(), 'openlander.db');
}

/** Get the config file path for the current environment. */
export function getConfigPath(): string {
  return join(getDataDir(), 'config.json');
}

/**
 * Load configuration from disk.
 * Merges saved config with defaults — new fields get default values automatically.
 */
export function loadConfig(): OpenLanderConfig {
  const configPath = getConfigPath();
  const defaults = buildDefaultConfig();

  if (!existsSync(configPath)) {
    return { ...defaults };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const saved = JSON.parse(raw) as Partial<OpenLanderConfig>;
    return deepMerge(defaults, saved);
  } catch (err) {
    log.debug({ err }, 'Config file corrupted — returning defaults');
    return { ...defaults };
  }
}

/** Save configuration to disk. */
export function saveConfig(config: OpenLanderConfig): void {
  const configPath = getConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Update specific config fields (partial update). */
export function updateConfig(partial: DeepPartial<OpenLanderConfig>): OpenLanderConfig {
  const current = loadConfig();
  const updated = deepMerge(current, partial as Partial<OpenLanderConfig>);
  saveConfig(updated);
  return updated;
}

/** Check if initial onboarding has been completed. */
export function isOnboarded(): boolean {
  return existsSync(getConfigPath());
}

// --- Migration ---

const MIGRATION_LOCK_FILE = '.migration-lock';
const MIGRATION_MARKER = '.migrated';

/**
 * Migrate old flat ~/.openlander/ data into ~/.openlander/production/.
 *
 * The old layout stored config.json, openlander.db, repos/, etc. directly
 * under ~/.openlander/. The new layout nests them under ~/.openlander/{env}/.
 *
 * Uses a lock file to prevent race conditions when two instances start simultaneously.
 * Only runs once — skipped if a migration marker exists.
 */
export function migrateOldDataDir(): void {
  const prodDir = join(BASE_DIR, 'production');
  const markerPath = join(prodDir, MIGRATION_MARKER);
  const lockPath = join(BASE_DIR, MIGRATION_LOCK_FILE);

  // Already migrated
  if (existsSync(markerPath)) return;

  // Nothing to migrate — no old config.json in base dir
  const oldConfigPath = join(BASE_DIR, 'config.json');
  if (!existsSync(oldConfigPath)) {
    // Ensure prod dir exists and mark as "migrated" (nothing to migrate)
    mkdirSync(prodDir, { recursive: true });
    writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
    return;
  }

  // Acquire lock (simple file-based lock for single-machine concurrency)
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  } catch (_err) {
    // Lock exists — another process is migrating. Wait briefly and check again.
    log.info('Migration lock exists — another process may be migrating');
    // Check if lock is stale (older than 30 seconds)
    try {
      const lockContent = readFileSync(lockPath, 'utf-8').trim();
      const lockPid = parseInt(lockContent, 10);
      if (!isNaN(lockPid)) {
        try {
          // Check if process is still alive (signal 0 doesn't kill)
          process.kill(lockPid, 0);
          // Process alive — skip migration, let the other process handle it
          log.info({ lockPid }, 'Migration in progress by another process — skipping');
          return;
        } catch (_killErr) {
          // Process dead — lock is stale, remove and retry
          log.info({ lockPid }, 'Stale migration lock detected — removing');
          try {
            unlinkSync(lockPath);
          } catch (_e) {
            /* ignore */
          }
        }
      }
    } catch (_readErr) {
      // Can't read lock — skip migration to be safe
      return;
    }

    // Retry lock acquisition
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    } catch (_retryErr) {
      log.warn('Could not acquire migration lock after retry — skipping migration');
      return;
    }
  }

  try {
    mkdirSync(prodDir, { recursive: true });

    // Files/dirs to migrate from BASE_DIR to BASE_DIR/production/
    const items = [
      'config.json',
      'openlander.db',
      'openlander.db-wal',
      'openlander.db-shm',
      'repos',
      'container-secrets',
      'traefik',
      'openlander.sock',
      'openlander.pid',
    ];

    for (const item of items) {
      const src = join(BASE_DIR, item);
      const dst = join(prodDir, item);
      if (existsSync(src) && !existsSync(dst)) {
        try {
          renameSync(src, dst);
          log.info({ item, from: src, to: dst }, 'Migrated item to production directory');
        } catch (err) {
          log.warn({ err, item }, 'Failed to migrate item — copying may be needed');
        }
      }
    }

    // Write migration marker
    writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
    log.info('Migration to production directory completed');
  } finally {
    // Release lock
    try {
      unlinkSync(lockPath);
    } catch (_e) {
      /* ignore */
    }
  }
}

// --- Utility types ---

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// --- Internal helpers ---

function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Partial<Record<string, unknown>>,
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }

  return result;
}
