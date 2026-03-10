import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('config');

/**
 * OpenLander configuration system.
 *
 * Config is stored at ~/.openlander/config.json.
 * Forward-compatible with v0.5 — new fields are added with defaults,
 * existing configs never break.
 */

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

const DEFAULT_CONFIG: OpenLanderConfig = {
  language: 'en',
  llm: {
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-2.0-flash',
    authToken: '',
    ollamaEndpoint: 'http://localhost:11434',
  },
  server: {
    port: 10114,
    host: '0.0.0.0',
    baseUrl: 'http://localhost:10114',
  },
  docker: {
    socketPath: '',
    networkName: 'web',
    portRangeStart: 10001,
    portRangeEnd: 10999,
  },
  git: {
    sshKeyPath: join(homedir(), '.ssh', 'id_ed25519'),
    cloneDir: join(homedir(), '.openlander', 'repos'),
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
  },
  channels: {
    slack: { enabled: false, token: '', signingSecret: '', recoveryChannelId: '' },
    discord: { enabled: false, token: '', applicationId: '', publicKey: '', recoveryChannelId: '' },
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

// --- Config Manager ---

const CONFIG_DIR = join(homedir(), '.openlander');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const DB_PATH = join(CONFIG_DIR, 'openlander.db');

/** Get the path to the OpenLander data directory. */
export function getDataDir(): string {
  return CONFIG_DIR;
}

/** Get the default database file path. */
export function getDbPath(): string {
  return DB_PATH;
}

/** Get the config file path. */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Load configuration from disk.
 * Merges saved config with defaults — new fields get default values automatically.
 */
export function loadConfig(): OpenLanderConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const saved = JSON.parse(raw) as Partial<OpenLanderConfig>;
    return deepMerge(DEFAULT_CONFIG, saved);
  } catch (err) {
    log.debug({ err }, 'Config file corrupted — returning defaults');
    return { ...DEFAULT_CONFIG };
  }
}

/** Save configuration to disk. */
export function saveConfig(config: OpenLanderConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
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
  return existsSync(CONFIG_PATH);
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
