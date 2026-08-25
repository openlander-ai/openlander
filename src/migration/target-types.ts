import type { MigrationService } from './types.js';

export const PROJECT_MIGRATION_TARGETS_SCHEMA_VERSION =
  'openlander.project-migration-targets/v1' as const;

export type MigrationTargetId = 'aws_ecs_fargate' | 'gcp_cloud_run';
export type MigrationTargetProvider = 'aws' | 'gcp';
export type MigrationTargetStatus = 'compatible' | 'review_required' | 'blocked';
export type MigrationTargetConfidence = 'high' | 'medium' | 'low';
export type MigrationTargetFindingLevel = 'warning' | 'blocker';
export type MigrationTargetResourceCategory =
  'compute' | 'database' | 'cache' | 'storage' | 'configuration' | 'networking';
export type MigrationTargetMethod =
  | 'rebuild_from_source'
  | 'redeploy_image'
  | 'manual_decomposition'
  | 'logical_export_import'
  | 'object_copy'
  | 'file_sync'
  | 'manual_replatform';

export interface MigrationTargetResourceMapping {
  source_service_id: string;
  source_service_name: string;
  source_kind: MigrationService['kind'];
  source_ownership: 'project' | 'connected';
  target_resource_type: string;
  target_resource_name: string;
  category: MigrationTargetResourceCategory;
  migration_method: MigrationTargetMethod;
  confidence: MigrationTargetConfidence;
  required_actions: string[];
  warnings: string[];
}

export interface MigrationTargetVolumeMapping {
  source_volume_id: string;
  source_volume_name: string;
  source_type: 'volume' | 'bind';
  target_resource_type: string;
  target_resource_name: string;
  migration_method: 'logical_export_import' | 'file_sync' | 'manual_replatform';
  confidence: MigrationTargetConfidence;
  service_ids: string[];
  required_actions: string[];
}

export interface MigrationTargetSupportingResource {
  resource_type: string;
  display_name: string;
  category: MigrationTargetResourceCategory;
  reason: string;
  required: boolean;
}

export interface MigrationTargetFinding {
  code: string;
  level: MigrationTargetFindingLevel;
  message: string;
  service_id: string | null;
}

export interface MigrationTargetReference {
  title: string;
  url: string;
}

export interface MigrationTargetPlan {
  id: MigrationTargetId;
  provider: MigrationTargetProvider;
  display_name: string;
  status: MigrationTargetStatus;
  summary: {
    mapped_service_count: number;
    mapped_volume_count: number;
    manual_review_count: number;
    blocker_count: number;
  };
  resource_mappings: MigrationTargetResourceMapping[];
  volume_mappings: MigrationTargetVolumeMapping[];
  supporting_resources: MigrationTargetSupportingResource[];
  findings: MigrationTargetFinding[];
  references: MigrationTargetReference[];
}

export interface ProjectMigrationTargetComparisonV1 {
  schema_version: typeof PROJECT_MIGRATION_TARGETS_SCHEMA_VERSION;
  generated_at: string;
  project: {
    id: string;
    name: string;
    display_name: string;
  };
  source_readiness: 'ready' | 'needs_attention' | 'blocked';
  targets: MigrationTargetPlan[];
  assessment_policy: {
    cloud_changes_made: false;
    pricing_queried: false;
    account_quotas_queried: false;
    data_copied: false;
    dns_changed: false;
  };
}
