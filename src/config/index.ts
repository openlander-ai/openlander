import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
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
 * Config is stored at ~/.openlander/config.json by default. Multi-instance and
 * ephemeral environments can set OPENLANDER_DATA_DIR to use an isolated root.
 * Forward-compatible with v0.5 — new fields are added with defaults,
 * existing configs never break.
 */

// --- Environment Policies ---

/** Supported deployment environment types. */
export type OpenLanderEnv = 'production' | 'development';
export const SHARED_NETWORK_NAME = 'openlander';
export const DEFAULT_PROJECT_NETWORK_POOL_CIDR = '10.240.0.0/12';
export const DOCKER_LABELS = {
  MANAGED: 'openlander.managed',
  INSTANCE: 'openlander.instance',
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
  /** OpenAI-compatible endpoint override. Only used with provider=openai. */
  baseURL?: string;
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
  /** IPv4 pool divided into /24 subnets for newly created OpenLander networks. */
  projectNetworkPoolCidr?: string;
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
  /** @deprecated Legacy manual API token; Connected Publish uses OAuth. */
  apiToken: string;
  /** @deprecated Legacy manually selected tunnel id. */
  tunnelId: string;
  /** @deprecated Legacy manually selected account id. */
  accountId: string;
  /** Public OAuth client id registered by the OpenLander publisher. */
  oauthClientId: string;
  /** Fixed public callback page registered on the Cloudflare OAuth client. */
  oauthRedirectUri: string;
  /** Dot-delimited Cloudflare OAuth scopes registered for this client. */
  oauthScopes: string[];
}

export interface MonitoringConfig {
  /** Healthcheck interval in seconds */
  healthcheckIntervalSec: number;
  /** Days of inactivity before suggesting cleanup */
  inactivityThresholdDays: number;
  /**
   * Timeout (ms) before a pending human approval auto-times-out. Default 10 min
   * (mirrors APPROVAL_TIMEOUT_MS). Raise it for approvals that take longer.
   */
  approvalTimeoutMs: number;
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
  /** Human-readable identity shown to MCP clients (e.g. openlander-ais-prod). */
  instanceName?: string;
  /** Stable instance identifier generated by the runtime. */
  instanceId?: string;
  /** External MCP servers the agent can consume tools from */
  servers: McpServerEntry[];
  /** Whether to expose platform tools (Docker, Git, etc.) via MCP. Default false in v0.1. */
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
  /** Managed, access-code-protected public sharing through this OpenLander host. */
  protectedShare: ProtectedShareConfig;
}

export interface ProtectedShareConfig {
  /** Whether managed Traefik should claim HTTPS for active protected shares. */
  enabled: boolean;
  /** Public IPv4 address or operator-owned base domain used to mint share hostnames. */
  publicHost: string;
  /** ACME registration email used by managed Traefik for HTTPS certificates. */
  acmeEmail: string;
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
  /** ISO timestamp when this provider was connected. */
  connectedAt?: string | null;
  /** ISO timestamp of the last successful provider validation/sync. */
  lastSyncAt?: string | null;
}

export interface GitProvidersConfig {
  github: GitProviderEntry;
  gitlab: GitProviderEntry;
  // bitbucket: GitProviderEntry;  // future
  // gitea: GitProviderEntry;  // future
}

// --- Defaults ---

export function resolveDataDir(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.OPENLANDER_DATA_DIR?.trim();
  return configured ? resolve(configured) : join(homedir(), '.openlander');
}

const CONFIG_DIR = resolveDataDir();

const DISABLED_AI_FEATURES: AIFeaturesConfig = {
  autoRecovery: { enabled: false },
  buildDebugger: { enabled: false },
  webAgent: { enabled: false },
  envDetection: { enabled: false },
  secretScan: { enabled: false },
  rollbackSuggestion: { enabled: false },
  operationalMonitoring: { enabled: false },
  codingPlan: { enabled: false },
};

const DISABLED_OPS_CONFIG: OpsConfig = {
  ...DEFAULT_OPS_CONFIG,
  enabled: false,
  recovery: {
    ...DEFAULT_OPS_CONFIG.recovery,
    enabled: false,
  },
  auto_restart: false,
  auto_cleanup: false,
  drift_detection: false,
};

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
      projectNetworkPoolCidr: DEFAULT_PROJECT_NETWORK_POOL_CIDR,
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
      oauthClientId: process.env['OPENLANDER_CLOUDFLARE_OAUTH_CLIENT_ID']?.trim() ?? '',
      oauthRedirectUri: process.env['OPENLANDER_CLOUDFLARE_OAUTH_REDIRECT_URI']?.trim() ?? '',
      oauthScopes: (process.env['OPENLANDER_CLOUDFLARE_OAUTH_SCOPES'] ?? '')
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0),
    },
    monitoring: {
      healthcheckIntervalSec: 60,
      inactivityThresholdDays: 14,
      approvalTimeoutMs: 10 * 60 * 1000,
    },
    mcp: {
      enabled: false,
      transport: 'stdio',
      instanceName: '',
      instanceId: '',
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
      github: { token: '', username: '', connectedAt: null, lastSyncAt: null },
      gitlab: { token: '', username: '', connectedAt: null, lastSyncAt: null },
    },
    localModel: {
      preferLocal: false,
      modelName: 'openlander-agent',
    },
    traefik: {
      mode: 'managed',
      externalNetwork: undefined,
      protectedShare: {
        enabled: false,
        publicHost: '',
        acmeEmail: '',
      },
    },
    ai: { ...DISABLED_AI_FEATURES },
    google: {
      clientId: '',
      clientSecret: '',
    },
    ops: { ...DISABLED_OPS_CONFIG },
    servers: [],
  };
}

// --- Config Manager ---

/** Get the OpenLander data directory. */
export function getDataDir(): string {
  return CONFIG_DIR;
}

/** Get the Postgres database URL. */
export function getDatabaseUrl(): string {
  return process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
}

/**
 * @deprecated OpenLander is Postgres-only. Kept temporarily so callers can be
 * converted in a focused pass.
 */
export function getDbPath(): string {
  return getDatabaseUrl();
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
    return normalizeRuntimeConfig({ ...defaults }, defaults);
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const saved = JSON.parse(raw) as Partial<OpenLanderConfig>;
    const merged = deepMerge(defaults, saved);

    return normalizeRuntimeConfig(merged, defaults);
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

function hasLegacyLlmCredential(llm: LLMProviderConfig): boolean {
  return Boolean(llm.authToken.trim() || llm.apiKey.trim());
}

/**
 * Normalizes LLM config for use with ModelRegistry.
 * If the new `providers` field is absent, synthesizes it from legacy single-provider fields.
 * Does NOT mutate the config object or write to disk.
 */
export function normalizeLlmConfig(llm: LLMProviderConfig): NormalizedLlmConfig {
  if (llm.providers && llm.defaultRoute) {
    return llm as NormalizedLlmConfig;
  }

  if (llm.providers) {
    const providerIds = Object.keys(llm.providers);
    return {
      ...llm,
      providers: llm.providers,
      defaultRoute: { providerId: providerIds[0] ?? '__none__' },
    };
  }

  if (!hasLegacyLlmCredential(llm)) {
    return {
      ...llm,
      providers: {},
      defaultRoute: { providerId: '__none__' },
    };
  }

  return {
    ...llm,
    providers: {
      default: {
        provider: llm.provider,
        apiKey: llm.apiKey,
        authToken: llm.authToken,
        defaultModel: llm.model,
        ...(llm.baseURL ? { baseURL: llm.baseURL } : {}),
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

function normalizeRuntimeConfig(
  config: OpenLanderConfig,
  defaults: OpenLanderConfig,
): OpenLanderConfig {
  return {
    ...config,
    docker: normalizeDockerConfig(config.docker, defaults.docker),
    git: normalizeGitConfig(config.git, defaults.git),
    // OpenLander 0.1 keeps external MCP agents but disables built-in LLM/AI Ops.
    // Stored tokens/settings are ignored rather than deleted.
    ai: { ...DISABLED_AI_FEATURES },
    ops: { ...DISABLED_OPS_CONFIG },
  };
}

function normalizeDockerConfig(docker: DockerConfig, defaults: DockerConfig): DockerConfig {
  const networkName = docker.networkName.trim();

  return {
    ...docker,
    // Early 0.1 dogfood configs used "web"; the runtime network is now fixed
    // to the shared OpenLander network unless the user explicitly chose another
    // non-legacy network name.
    networkName:
      networkName.length === 0 || networkName === 'web' ? defaults.networkName : networkName,
  };
}

function normalizeGitConfig(git: GitConfig, defaults: GitConfig): GitConfig {
  const sshKeyPath = git.sshKeyPath.trim();
  const cloneDir = git.cloneDir.trim();
  const workspaceOverride = process.env['OPENLANDER_WORKSPACE_DIR']?.trim();

  return {
    ...git,
    sshKeyPath: sshKeyPath && existsSync(sshKeyPath) ? sshKeyPath : '',
    cloneDir:
      cloneDir && (cloneDir.startsWith('/Users/') || !existsSync(dirname(cloneDir)))
        ? workspaceOverride && workspaceOverride.length > 0
          ? workspaceOverride
          : defaults.cloneDir
        : cloneDir,
  };
}
