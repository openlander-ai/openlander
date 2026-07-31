export const UPDATE_PHASES = [
  'preparing',
  'backing_up',
  'pulling',
  'restarting',
  'verifying',
  'completed',
  'rolling_back',
  'rolled_back',
  'failed',
] as const;

export type PlatformUpdatePhase = (typeof UPDATE_PHASES)[number];
export type ReleaseChannel = 'stable' | 'rc' | 'development';
export type PlatformUpdateSupportMode = 'compose' | 'manual';

export interface OpenLanderUpdateManifest {
  schema_version: 1;
  version: string;
  minimum_source_version: string;
  image: string;
  image_digest: string;
  compose_sha256: string;
  rollback_safe: boolean;
}

export interface PlatformReleaseSummary {
  version: string;
  tag: string;
  publishedAt: string;
  notes: string[];
  url: string;
  manifest: OpenLanderUpdateManifest | null;
  oneClickBlockReason: string | null;
}

export interface PlatformUpdateOperation {
  id: string;
  sourceVersion: string;
  targetVersion: string;
  phase: PlatformUpdatePhase;
  startedAt: string;
  updatedAt: string;
  message: string | null;
  errorCode: string | null;
  runnerContainerId: string | null;
}

export interface PlatformUpdateStatus {
  currentVersion: string;
  channel: ReleaseChannel;
  updateAvailable: boolean;
  canUpdate: boolean;
  release: PlatformReleaseSummary | null;
  support: {
    mode: PlatformUpdateSupportMode;
    reason: string | null;
    manualUpdateUrl: string;
  };
  checks: Array<{
    id: string;
    ok: boolean;
    message: string;
    availableBytes?: number;
    requiredBytes?: number;
  }>;
  operation: PlatformUpdateOperation | null;
  releaseCheckStale: boolean;
  releaseCheckedAt: string;
}

export interface ComposeInstallation {
  mode: PlatformUpdateSupportMode;
  reason: string | null;
  containerId: string | null;
  image: string | null;
  imageId: string | null;
  composeProject: string | null;
  composeService: string | null;
  workingDirectory: string | null;
  composeFiles: string[];
  dataVolumeName: string | null;
  dockerSocketPath: string | null;
  networkNames: string[];
}

export interface PlatformUpdateRunnerInput {
  operationId: string;
  sourceVersion: string;
  targetVersion: string;
  targetImage: string;
  targetDigest: string;
  targetComposeSha256: string;
  sourceImage: string;
  runnerImageId: string;
  composeProject: string;
  composeService: string;
  workingDirectory: string;
  composeFiles: string[];
  dataVolumeName: string;
  databaseContainerId: string;
  networkNames: string[];
}
