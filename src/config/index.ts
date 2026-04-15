import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createModuleLogger } from '../lib/logger.js';
import type {
  LLMProviderEntry,
  LLMRoute,
  AIModelFeature,
  ModelRoutingConfig,
} from '../llm/model-registry.js';
import type { LLMProviderType } from '../llm/providers.js';
import type { OpsConfig } from '../monitor/ops-types.js';
import { DEFAULT_OPS_CONFIG } from '../monitor/ops-types.js';

const log = createModuleLogger('config');

/**
 * OpenLander configuration system.
 *
 * Config is stored at ~/.openlander/config.json.
 * Forward-compatible with v0.5 — new fields are added with defaults,
 * existing configs never break.
 */

// --- Environment Policies ---

/** Supported deployment environment types. */
export type OpenLanderEnv = 'production' | 'development';
export const SHARED_NETWORK_NAME = 'openlander';
export const DOCKER_LABELS = {
  MANAGED: 'openlander.managed',
  ROLE: 'openlander.role',
  PROJECT: 'openlander.project',
  SERVICE: 'openlander.service',
  VOLUME: 'openlander.volume',
  MOUNT_PATH: 'openlander.mount_path',
} as const;

/** Valid environment names for input validation. */
const VALID_ENVIRONMENTS: ReadonlySet<string> = new Set<string>(['production', 'development']);

/** Deploy-level policy that varies per environment type. */
export interface EnvironmentPolicy {
  networkName: string;
  portRangeStart: number;
  portRangeEnd: number;
}

/** Default policies per environment. Pipeline functions read these via getPolicy(). */
const DEFAULT_POLICIES: Record<OpenLanderEnv, EnvironmentPolicy> = {
  production: {
    networkName: SHARED_NETWORK_NAME,
    portRangeStart: 10001,
    portRangeEnd: 10999,
  },
  development: {
    networkName: SHARED_NETWORK_NAME,
    portRangeStart: 20001,
    portRangeEnd: 20999,
  },
};

/**
 * Get the deploy policy for an environment type.
 * Pipeline code should always go through this function — never read DEFAULT_POLICIES directly.
 * Future: this will layer global config overrides and per-project overrides on top.
 */
export function getPolicy(envType: OpenLanderEnv): EnvironmentPolicy {
  return DEFAULT_POLICIES[envType];
}

/** Validate whether a string is a valid environment type. */
export function isValidEnvironment(value: string): value is OpenLanderEnv {
  return VALID_ENVIRONMENTS.has(value);
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

  /** v1.0: AI feature toggles */
  ai: AIFeaturesConfig;

  /** v1.1: Google OAuth credentials for Gemini API access */
  google: GoogleOAuthConfig;

  /** v1.1: Operations agent settings */
  ops: OpsConfig;

  /** v1.2: Multi-server configuration */
  servers?: MultiServerConfig[];
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface LLMProviderConfig {
  provider: LLMProviderType;
  apiKey: string;
  model: string;
  /** v0.2: OAuth access token (used instead of apiKey when OAuth is active) */
  authToken: string;
  /** v1.1: Multi-provider registry. If present, used for feature-based routing. */
  providers?: Record<string, LLMProviderEntry>;
  /** v1.1: Default route when no feature-specific route is configured. */
  defaultRoute?: LLMRoute;
  /** v1.1: Per-feature model routing overrides. */
  routes?: Partial<Record<AIModelFeature, LLMRoute>>;
}

export interface ServerConfig {
  port: number;
  host: string;
  /** Base URL for internal access */
  baseUrl: string;
  corsOrigin?: string;
}

export interface MultiServerConfig {
  id: string;
  name: string;
  host: string;
  port?: number;
  sshUser?: string;
  sshKeyPath?: string;
  dockerSocketPath?: string;
  isDefault?: boolean;
}

export interface DockerConfig {
  socketPath: string;
  /** Network name for Traefik routing (production default) */
  networkName: string;
  /** Port range for managed containers (production defaults) */
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

export interface EmailChannelConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  from: string;
  to: string[];
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
  email: EmailChannelConfig;
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

export interface AIFeatureToggle {
  enabled: boolean;
  /** v1.1: Which registered provider to use for this feature. Falls back to defaultRoute. */
  providerId?: string;
  /** v1.1: Model override for this feature. Falls back to provider.defaultModel. */
  model?: string;
}

export interface AIFeaturesConfig {
  autoRecovery: AIFeatureToggle;
  buildDebugger: AIFeatureToggle;
  webAgent: AIFeatureToggle;
  envDetection: AIFeatureToggle;
  secretScan: AIFeatureToggle;
  rollbackSuggestion: AIFeatureToggle;
  operationalMonitoring: AIFeatureToggle;
  codingPlan: AIFeatureToggle;
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

const CONFIG_DIR = join(homedir(), '.openlander');

function buildDefaultConfig(): OpenLanderConfig {
  const prodPolicy = DEFAULT_POLICIES.production;

  return {
    language: 'en',
    llm: {
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.5-flash',
      authToken: '',
    },
    server: {
      port: 10114,
      host: '0.0.0.0',
      baseUrl: 'http://localhost:10114',
    },
    docker: {
      socketPath: '',
      networkName: prodPolicy.networkName,
      portRangeStart: prodPolicy.portRangeStart,
      portRangeEnd: prodPolicy.portRangeEnd,
    },
    git: {
      sshKeyPath: join(homedir(), '.ssh', 'id_ed25519'),
      cloneDir: join(CONFIG_DIR, 'repos'),
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
      platformTools: true,
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
      email: {
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        auth: { user: '', pass: '' },
        from: '',
        to: [],
      },
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
    ai: {
      autoRecovery: { enabled: true },
      buildDebugger: { enabled: true },
      webAgent: { enabled: true },
      envDetection: { enabled: true },
      secretScan: { enabled: true },
      rollbackSuggestion: { enabled: true },
      operationalMonitoring: { enabled: true },
      codingPlan: { enabled: true },
    },
    google: {
      clientId: '',
      clientSecret: '',
    },
    ops: { ...DEFAULT_OPS_CONFIG },
    servers: [],
  };
}

// --- Config Manager ---

/** Get the OpenLander data directory. */
export function getDataDir(): string {
  return CONFIG_DIR;
}

/** Get the default database file path. */
export function getDbPath(): string {
  return join(CONFIG_DIR, 'openlander.db');
}

/** Get the config file path. */
export function getConfigPath(): string {
  return join(CONFIG_DIR, 'config.json');
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
    const merged = deepMerge(defaults, saved);

    return merged;
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

/** Get the default local server configuration. */
export function getDefaultServer(): MultiServerConfig {
  return { id: 'local', name: 'Local', host: '127.0.0.1', isDefault: true };
}

// --- LLM config normalization ---

export type NormalizedLlmConfig = LLMProviderConfig & {
  providers: NonNullable<LLMProviderConfig['providers']>;
  defaultRoute: NonNullable<LLMProviderConfig['defaultRoute']>;
};

/**
 * Normalizes LLM config for use with ModelRegistry.
 * If the new `providers` field is absent, synthesizes it from legacy single-provider fields.
 * Does NOT mutate the config object or write to disk.
 */
export function normalizeLlmConfig(llm: LLMProviderConfig): NormalizedLlmConfig {
  if (llm.providers && llm.defaultRoute) {
    return llm as NormalizedLlmConfig;
  }

  return {
    ...llm,
    providers: {
      default: {
        provider: llm.provider,
        apiKey: llm.apiKey,
        authToken: llm.authToken,
        defaultModel: llm.model,
      },
    },
    defaultRoute: { providerId: 'default' },
  };
}

// --- Re-exports from model-registry ---

export type { LLMProviderEntry, LLMRoute, AIModelFeature, ModelRoutingConfig };

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
