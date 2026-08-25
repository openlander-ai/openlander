import type { MigrationService, MigrationVolume, ProjectMigrationSnapshotV1 } from './types.js';
import {
  PROJECT_MIGRATION_TARGETS_SCHEMA_VERSION,
  type MigrationTargetFinding,
  type MigrationTargetId,
  type MigrationTargetPlan,
  type MigrationTargetReference,
  type MigrationTargetResourceMapping,
  type MigrationTargetSupportingResource,
  type MigrationTargetVolumeMapping,
  type ProjectMigrationTargetComparisonV1,
} from './target-types.js';

const STATEFUL_KINDS = new Set<MigrationService['kind']>([
  'postgres',
  'mysql',
  'redis',
  'mongo',
  'neo4j',
  'minio',
]);

const AWS_REFERENCES: MigrationTargetReference[] = [
  {
    title: 'Amazon ECS storage options',
    url: 'https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_data_volumes.html',
  },
  {
    title: 'Amazon ECS secrets',
    url: 'https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html',
  },
  {
    title: 'AWS Fargate for Amazon ECS',
    url: 'https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html',
  },
];

const GCP_REFERENCES: MigrationTargetReference[] = [
  {
    title: 'Cloud Run services, jobs, and worker pools',
    url: 'https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run',
  },
  {
    title: 'Cloud Run configuration and volume mounts',
    url: 'https://docs.cloud.google.com/run/docs/configuring',
  },
  {
    title: 'Google Cloud services recommended for Cloud Run',
    url: 'https://docs.cloud.google.com/run/docs/integrate/using-gcp-services',
  },
];

function compareText(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? '').localeCompare(right ?? '', 'en');
}

function immutableSourceAvailable(service: MigrationService): boolean {
  if (service.kind === 'image') {
    return service.source.image_reference?.includes('@sha256:') === true;
  }
  return Boolean(service.last_deploy?.commit_sha);
}

function computeConfidence(service: MigrationService): 'high' | 'medium' | 'low' {
  if (service.kind === 'compose' || service.kind === 'compose-child') return 'low';
  return immutableSourceAvailable(service) ? 'high' : 'medium';
}

function computeMethod(
  service: MigrationService,
): MigrationTargetResourceMapping['migration_method'] {
  if (service.kind === 'compose') return 'manual_decomposition';
  if (service.kind === 'compose-child' && service.runtime_role === 'resource') {
    return 'manual_replatform';
  }
  return service.source.type === 'image' ? 'redeploy_image' : 'rebuild_from_source';
}

function awsResourceMapping(service: MigrationService): MigrationTargetResourceMapping {
  const common = {
    source_service_id: service.id,
    source_service_name: service.name,
    source_kind: service.kind,
    source_ownership: service.ownership,
  };
  switch (service.kind) {
    case 'postgres':
      return {
        ...common,
        target_resource_type: 'aws_rds_postgresql',
        target_resource_name: 'Amazon RDS for PostgreSQL',
        category: 'database',
        migration_method: 'logical_export_import',
        confidence: 'medium',
        required_actions: [
          'Select engine version and topology.',
          'Run logical export/import and validate data.',
        ],
        warnings: ['Container volume data is not directly portable to RDS.'],
      };
    case 'mysql':
      return {
        ...common,
        target_resource_type: 'aws_rds_mysql',
        target_resource_name: 'Amazon RDS for MySQL',
        category: 'database',
        migration_method: 'logical_export_import',
        confidence: 'medium',
        required_actions: [
          'Select engine version and topology.',
          'Run logical export/import and validate data.',
        ],
        warnings: ['Container volume data is not directly portable to RDS.'],
      };
    case 'redis':
      return {
        ...common,
        target_resource_type: 'aws_elasticache_valkey_redis',
        target_resource_name: 'Amazon ElastiCache for Valkey or Redis OSS',
        category: 'cache',
        migration_method: 'logical_export_import',
        confidence: 'medium',
        required_actions: [
          'Choose Valkey or Redis OSS compatibility.',
          'Plan snapshot or application-level cache warm-up.',
        ],
        warnings: ['Confirm persistence, eviction, and TLS behavior before cutover.'],
      };
    case 'mongo':
      return {
        ...common,
        target_resource_type: 'aws_documentdb_or_managed_mongodb',
        target_resource_name: 'Amazon DocumentDB or managed MongoDB',
        category: 'database',
        migration_method: 'manual_replatform',
        confidence: 'low',
        required_actions: [
          'Run MongoDB API and feature compatibility tests.',
          'Choose DocumentDB or an external managed MongoDB service.',
        ],
        warnings: ['DocumentDB must not be assumed to be fully MongoDB-compatible.'],
      };
    case 'neo4j':
      return {
        ...common,
        target_resource_type: 'neo4j_aura_or_self_managed_aws',
        target_resource_name: 'Neo4j AuraDB or self-managed Neo4j on AWS',
        category: 'database',
        migration_method: 'manual_replatform',
        confidence: 'low',
        required_actions: [
          'Choose Neo4j AuraDB or a reviewed self-managed Neo4j topology.',
          'Use a Neo4j-supported dump/load or export/import procedure and validate graph data.',
        ],
        warnings: [
          'Do not copy the raw OpenLander Neo4j volume into a different Neo4j deployment.',
        ],
      };
    case 'minio':
      return {
        ...common,
        target_resource_type: 'aws_s3_bucket',
        target_resource_name: 'Amazon S3',
        category: 'storage',
        migration_method: 'object_copy',
        confidence: 'low',
        required_actions: [
          'Inventory buckets outside this snapshot.',
          'Copy objects and validate S3 API behavior.',
        ],
        warnings: ['MinIO-specific behavior and credentials require application review.'],
      };
    default: {
      const isJob = service.runtime_role === 'job';
      const isComposeRoot = service.kind === 'compose';
      const isAmbiguousComposeChild =
        service.kind === 'compose-child' &&
        service.runtime_role === 'application' &&
        service.runtime.container_port === null;
      return {
        ...common,
        target_resource_type: isComposeRoot
          ? 'aws_ecs_task_definition_group'
          : isJob
            ? 'aws_ecs_fargate_task'
            : isAmbiguousComposeChild
              ? 'aws_ecs_or_managed_service'
              : 'aws_ecs_fargate_service',
        target_resource_name: isComposeRoot
          ? 'Amazon ECS task-definition group'
          : isJob
            ? 'Amazon ECS task on AWS Fargate'
            : isAmbiguousComposeChild
              ? 'ECS or managed AWS service (manual classification)'
              : 'Amazon ECS service on AWS Fargate',
        category: 'compute',
        migration_method: isAmbiguousComposeChild ? 'manual_replatform' : computeMethod(service),
        confidence: computeConfidence(service),
        required_actions:
          isComposeRoot || isAmbiguousComposeChild
            ? [
                'Decompose Compose services, profiles, overlays, networks, and dependencies manually.',
                ...(isAmbiguousComposeChild
                  ? [
                      'Classify this child as an HTTP service, worker, job, or managed data service.',
                    ]
                  : []),
              ]
            : [
                'Build or copy an immutable image into the destination registry.',
                'Create a task definition with ports, health checks, env, and secrets.',
              ],
        warnings:
          service.kind === 'compose-child'
            ? ['Confirm the Compose child role and dependency ordering manually.']
            : [],
      };
    }
  }
}

function gcpResourceMapping(service: MigrationService): MigrationTargetResourceMapping {
  const common = {
    source_service_id: service.id,
    source_service_name: service.name,
    source_kind: service.kind,
    source_ownership: service.ownership,
  };
  switch (service.kind) {
    case 'postgres':
      return {
        ...common,
        target_resource_type: 'gcp_cloud_sql_postgresql',
        target_resource_name: 'Cloud SQL for PostgreSQL',
        category: 'database',
        migration_method: 'logical_export_import',
        confidence: 'medium',
        required_actions: [
          'Select engine version, region, and availability.',
          'Run logical export/import and validate data.',
        ],
        warnings: ['Container volume data is not directly portable to Cloud SQL.'],
      };
    case 'mysql':
      return {
        ...common,
        target_resource_type: 'gcp_cloud_sql_mysql',
        target_resource_name: 'Cloud SQL for MySQL',
        category: 'database',
        migration_method: 'logical_export_import',
        confidence: 'medium',
        required_actions: [
          'Select engine version, region, and availability.',
          'Run logical export/import and validate data.',
        ],
        warnings: ['Container volume data is not directly portable to Cloud SQL.'],
      };
    case 'redis':
      return {
        ...common,
        target_resource_type: 'gcp_memorystore_redis',
        target_resource_name: 'Memorystore for Redis',
        category: 'cache',
        migration_method: 'logical_export_import',
        confidence: 'medium',
        required_actions: [
          'Select service tier and VPC connectivity.',
          'Plan snapshot import or application-level cache warm-up.',
        ],
        warnings: ['Confirm persistence, eviction, and TLS behavior before cutover.'],
      };
    case 'mongo':
      return {
        ...common,
        target_resource_type: 'gcp_firestore_mongodb_or_atlas',
        target_resource_name: 'Firestore with MongoDB compatibility or MongoDB Atlas',
        category: 'database',
        migration_method: 'manual_replatform',
        confidence: 'low',
        required_actions: [
          'Run MongoDB API and feature compatibility tests.',
          'Choose Firestore compatibility or an external managed MongoDB service.',
        ],
        warnings: ['Do not assume full behavioral compatibility without application tests.'],
      };
    case 'neo4j':
      return {
        ...common,
        target_resource_type: 'neo4j_aura_or_self_managed_gcp',
        target_resource_name: 'Neo4j AuraDB or self-managed Neo4j on Google Cloud',
        category: 'database',
        migration_method: 'manual_replatform',
        confidence: 'low',
        required_actions: [
          'Choose Neo4j AuraDB or a reviewed self-managed Neo4j topology.',
          'Use a Neo4j-supported dump/load or export/import procedure and validate graph data.',
        ],
        warnings: [
          'Do not copy the raw OpenLander Neo4j volume into a different Neo4j deployment.',
        ],
      };
    case 'minio':
      return {
        ...common,
        target_resource_type: 'gcp_cloud_storage_bucket',
        target_resource_name: 'Cloud Storage',
        category: 'storage',
        migration_method: 'object_copy',
        confidence: 'low',
        required_actions: [
          'Inventory buckets outside this snapshot.',
          'Copy objects and validate application API behavior.',
        ],
        warnings: [
          'Cloud Storage is not an S3-compatible drop-in replacement for every MinIO client.',
        ],
      };
    default: {
      const isComposeRoot = service.kind === 'compose';
      const isJob = service.runtime_role === 'job';
      const isAmbiguousComposeChild =
        service.kind === 'compose-child' &&
        service.runtime_role === 'application' &&
        service.runtime.container_port === null;
      const isWorker =
        !isComposeRoot &&
        !isJob &&
        !isAmbiguousComposeChild &&
        service.runtime.container_port === null;
      return {
        ...common,
        target_resource_type: isComposeRoot
          ? 'gcp_cloud_run_resource_group'
          : isJob
            ? 'gcp_cloud_run_job'
            : isAmbiguousComposeChild
              ? 'gcp_cloud_run_or_managed_service'
              : isWorker
                ? 'gcp_cloud_run_worker_pool'
                : 'gcp_cloud_run_service',
        target_resource_name: isComposeRoot
          ? 'Cloud Run resource group'
          : isJob
            ? 'Cloud Run job'
            : isAmbiguousComposeChild
              ? 'Cloud Run or managed Google Cloud service (manual classification)'
              : isWorker
                ? 'Cloud Run worker pool'
                : 'Cloud Run service',
        category: 'compute',
        migration_method: isAmbiguousComposeChild ? 'manual_replatform' : computeMethod(service),
        confidence: computeConfidence(service),
        required_actions:
          isComposeRoot || isAmbiguousComposeChild
            ? [
                'Decompose Compose services, profiles, overlays, networks, and dependencies manually.',
                ...(isAmbiguousComposeChild
                  ? [
                      'Classify this child as an HTTP service, worker, job, or managed data service.',
                    ]
                  : []),
              ]
            : [
                'Build or copy an immutable image into Artifact Registry.',
                'Configure ingress, port, health, env, secrets, and service identity.',
              ],
        warnings:
          service.kind === 'compose-child'
            ? ['Confirm the Compose child role and dependency ordering manually.']
            : [],
      };
    }
  }
}

function volumeMapping(
  target: MigrationTargetId,
  volume: MigrationVolume,
  servicesById: ReadonlyMap<string, MigrationService>,
): MigrationTargetVolumeMapping {
  const linkedServices = volume.service_ids.flatMap((id) => {
    const service = servicesById.get(id);
    return service ? [service] : [];
  });
  const belongsToStatefulService = linkedServices.some((service) =>
    STATEFUL_KINDS.has(service.kind),
  );
  if (belongsToStatefulService) {
    return {
      source_volume_id: volume.id,
      source_volume_name: volume.name ?? volume.source,
      source_type: volume.type,
      target_resource_type: 'mapped_managed_data_service',
      target_resource_name: 'Mapped managed data service',
      migration_method: 'logical_export_import',
      confidence: 'medium',
      service_ids: [...volume.service_ids].sort(compareText),
      required_actions: [
        'Do not copy the raw container volume.',
        'Use the mapped service’s logical export/import procedure.',
      ],
    };
  }
  const aws = target === 'aws_ecs_fargate';
  return {
    source_volume_id: volume.id,
    source_volume_name: volume.name ?? volume.source,
    source_type: volume.type,
    target_resource_type: aws ? 'aws_efs' : 'gcp_filestore_or_cloud_storage_volume',
    target_resource_name: aws ? 'Amazon EFS' : 'Filestore or Cloud Storage volume mount',
    migration_method: volume.type === 'bind' ? 'manual_replatform' : 'file_sync',
    confidence: volume.type === 'bind' ? 'low' : 'medium',
    service_ids: [...volume.service_ids].sort(compareText),
    required_actions: [
      'Confirm POSIX, locking, latency, ownership, and read/write requirements.',
      'Copy files with checksums and validate the destination mount before cutover.',
    ],
  };
}

function supportingResources(
  target: MigrationTargetId,
  snapshot: ProjectMigrationSnapshotV1,
): MigrationTargetSupportingResource[] {
  const hasCompute = snapshot.services.some((service) => !STATEFUL_KINDS.has(service.kind));
  const hasBuildSource = snapshot.services.some((service) =>
    ['git', 'compose', 'compose-child'].includes(service.kind),
  );
  const hasSensitiveConfig =
    snapshot.environment_variables.some((variable) => variable.sensitive) ||
    snapshot.secret_files.length > 0;
  const hasPlainConfig = snapshot.environment_variables.some((variable) => !variable.sensitive);
  const hasNetworkData = snapshot.services.some((service) => STATEFUL_KINDS.has(service.kind));
  const hasDomains = snapshot.domain_routes.length > 0;
  const resources: MigrationTargetSupportingResource[] = [];
  if (target === 'aws_ecs_fargate') {
    if (hasCompute) {
      resources.push({
        resource_type: 'aws_ecs_cluster',
        display_name: 'Amazon ECS cluster',
        category: 'compute',
        reason: 'Hosts the mapped Fargate services and tasks.',
        required: true,
      });
    }
    if (hasBuildSource) {
      resources.push({
        resource_type: 'aws_ecr_repository',
        display_name: 'Amazon ECR',
        category: 'compute',
        reason: 'Stores images rebuilt from Git or Compose sources.',
        required: true,
      });
    }
    if (hasSensitiveConfig) {
      resources.push({
        resource_type: 'aws_secrets_manager',
        display_name: 'AWS Secrets Manager',
        category: 'configuration',
        reason: 'Stores sensitive env values and recreated secret files.',
        required: true,
      });
    }
    if (hasPlainConfig) {
      resources.push({
        resource_type: 'aws_ssm_parameter_store',
        display_name: 'AWS Systems Manager Parameter Store',
        category: 'configuration',
        reason: 'Stores non-secret destination configuration.',
        required: false,
      });
    }
    if (hasNetworkData || snapshot.volumes.length > 0) {
      resources.push({
        resource_type: 'aws_vpc',
        display_name: 'Amazon VPC networking',
        category: 'networking',
        reason: 'Connects Fargate tasks to managed data services and persistent storage.',
        required: true,
      });
    }
    if (hasDomains) {
      resources.push({
        resource_type: 'aws_alb_route53_acm',
        display_name: 'Application Load Balancer, Route 53, and ACM',
        category: 'networking',
        reason: 'Provides verified ingress, TLS, and DNS cutover for custom domains.',
        required: true,
      });
    }
  } else {
    if (hasBuildSource) {
      resources.push({
        resource_type: 'gcp_artifact_registry',
        display_name: 'Artifact Registry',
        category: 'compute',
        reason: 'Stores images rebuilt from Git or Compose sources.',
        required: true,
      });
    }
    if (hasSensitiveConfig) {
      resources.push({
        resource_type: 'gcp_secret_manager',
        display_name: 'Secret Manager',
        category: 'configuration',
        reason: 'Stores sensitive env values and recreated secret files.',
        required: true,
      });
    }
    if (hasPlainConfig) {
      resources.push({
        resource_type: 'gcp_parameter_manager',
        display_name: 'Parameter Manager or Cloud Run environment variables',
        category: 'configuration',
        reason: 'Stores non-secret destination configuration.',
        required: false,
      });
    }
    if (hasNetworkData || snapshot.volumes.length > 0) {
      resources.push({
        resource_type: 'gcp_vpc_connectivity',
        display_name: 'Direct VPC egress and service networking',
        category: 'networking',
        reason: 'Connects Cloud Run resources to managed data services and persistent storage.',
        required: true,
      });
    }
    if (hasDomains) {
      resources.push({
        resource_type: 'gcp_load_balancer_dns_certificate_manager',
        display_name: 'External Application Load Balancer, Cloud DNS, and Certificate Manager',
        category: 'networking',
        reason: 'Provides verified ingress, TLS, and DNS cutover for custom domains.',
        required: true,
      });
    }
  }
  return resources.sort(
    (left, right) =>
      compareText(left.category, right.category) ||
      compareText(left.resource_type, right.resource_type),
  );
}

function targetFindings(
  target: MigrationTargetId,
  snapshot: ProjectMigrationSnapshotV1,
  mappings: readonly MigrationTargetResourceMapping[],
  volumes: readonly MigrationTargetVolumeMapping[],
): MigrationTargetFinding[] {
  const findings: MigrationTargetFinding[] = [];
  if (snapshot.readiness.status === 'blocked') {
    findings.push({
      code: 'SOURCE_SNAPSHOT_BLOCKED',
      level: 'blocker',
      message: 'Resolve the provider-neutral snapshot blockers before provisioning a destination.',
      service_id: null,
    });
  } else if (snapshot.readiness.status === 'needs_attention') {
    findings.push({
      code: 'SOURCE_READINESS_REVIEW_REQUIRED',
      level: 'warning',
      message: 'Review the provider-neutral snapshot warnings before selecting this target.',
      service_id: null,
    });
  }
  for (const mapping of mappings) {
    if (mapping.source_ownership === 'connected') {
      findings.push({
        code: 'CONNECTED_RESOURCE_OWNERSHIP_REVIEW_REQUIRED',
        level: 'warning',
        message:
          'Confirm whether this connected resource should move with the Project or remain shared.',
        service_id: mapping.source_service_id,
      });
    }
    if (mapping.source_kind === 'compose') {
      findings.push({
        code: 'COMPOSE_DECOMPOSITION_REQUIRED',
        level: 'warning',
        message:
          'Compose profiles, overlays, networks, and dependency ordering require manual decomposition.',
        service_id: mapping.source_service_id,
      });
    }
    if (mapping.target_resource_type.endsWith('_or_managed_service')) {
      findings.push({
        code: 'COMPOSE_CHILD_CLASSIFICATION_REQUIRED',
        level: 'warning',
        message:
          'Classify this portless Compose child before choosing a compute or managed-service target.',
        service_id: mapping.source_service_id,
      });
    }
    if (mapping.source_kind === 'mongo') {
      findings.push({
        code: 'MONGODB_COMPATIBILITY_REVIEW_REQUIRED',
        level: 'warning',
        message:
          'The proposed managed target requires MongoDB feature and behavior compatibility tests.',
        service_id: mapping.source_service_id,
      });
    }
    if (mapping.source_kind === 'minio') {
      findings.push({
        code: 'OBJECT_STORAGE_API_REVIEW_REQUIRED',
        level: 'warning',
        message: 'Validate object API, policy, presigned URL, metadata, and event behavior.',
        service_id: mapping.source_service_id,
      });
    }
  }
  if (volumes.length > 0) {
    findings.push({
      code: 'TARGET_VOLUME_PLAN_REQUIRED',
      level: 'warning',
      message: 'Choose and validate a destination strategy for every persistent mount.',
      service_id: null,
    });
  }
  if (volumes.some((volume) => volume.source_type === 'bind')) {
    findings.push({
      code: 'BIND_MOUNT_NOT_PORTABLE',
      level: 'warning',
      message: 'Host bind mounts cannot be transferred as cloud runtime configuration.',
      service_id: null,
    });
  }
  if (snapshot.environment_variables.length > 0 || snapshot.secret_files.length > 0) {
    findings.push({
      code: 'TARGET_CONFIGURATION_REENTRY_REQUIRED',
      level: 'warning',
      message: 'Re-enter excluded configuration and secrets through the target platform.',
      service_id: null,
    });
  }
  if (snapshot.domain_routes.length > 0) {
    findings.push({
      code: 'TARGET_INGRESS_CUTOVER_REQUIRED',
      level: 'warning',
      message: 'Validate target ingress and TLS before changing DNS.',
      service_id: null,
    });
  }
  if (
    target === 'gcp_cloud_run' &&
    mappings.some((mapping) => mapping.target_resource_type === 'gcp_cloud_run_worker_pool')
  ) {
    findings.push({
      code: 'CLOUD_RUN_WORKER_REVIEW_REQUIRED',
      level: 'warning',
      message:
        'Confirm worker-pool availability, scaling, and regional requirements for non-HTTP workloads.',
      service_id: null,
    });
  }
  return findings.sort(
    (left, right) =>
      ({ blocker: 0, warning: 1 })[left.level] - { blocker: 0, warning: 1 }[right.level] ||
      compareText(left.service_id, right.service_id) ||
      compareText(left.code, right.code),
  );
}

function buildTargetPlan(
  target: MigrationTargetId,
  snapshot: ProjectMigrationSnapshotV1,
): MigrationTargetPlan {
  const mapper = target === 'aws_ecs_fargate' ? awsResourceMapping : gcpResourceMapping;
  const resourceMappings = snapshot.services
    .map(mapper)
    .sort(
      (left, right) =>
        compareText(left.category, right.category) ||
        compareText(left.source_service_name, right.source_service_name) ||
        compareText(left.source_service_id, right.source_service_id),
    );
  const servicesById = new Map(snapshot.services.map((service) => [service.id, service]));
  const volumeMappings = snapshot.volumes
    .map((volume) => volumeMapping(target, volume, servicesById))
    .sort(
      (left, right) =>
        compareText(left.source_volume_name, right.source_volume_name) ||
        compareText(left.source_volume_id, right.source_volume_id),
    );
  const findings = targetFindings(target, snapshot, resourceMappings, volumeMappings);
  const blockerCount = findings.filter((finding) => finding.level === 'blocker').length;
  const manualReviewCount =
    findings.filter((finding) => finding.level === 'warning').length +
    resourceMappings.filter((mapping) => mapping.confidence === 'low').length +
    volumeMappings.filter((mapping) => mapping.confidence === 'low').length;
  return {
    id: target,
    provider: target === 'aws_ecs_fargate' ? 'aws' : 'gcp',
    display_name: target === 'aws_ecs_fargate' ? 'AWS ECS on Fargate' : 'Google Cloud Run',
    status: blockerCount > 0 ? 'blocked' : manualReviewCount > 0 ? 'review_required' : 'compatible',
    summary: {
      mapped_service_count: resourceMappings.length,
      mapped_volume_count: volumeMappings.length,
      manual_review_count: manualReviewCount,
      blocker_count: blockerCount,
    },
    resource_mappings: resourceMappings,
    volume_mappings: volumeMappings,
    supporting_resources: supportingResources(target, snapshot),
    findings,
    references: target === 'aws_ecs_fargate' ? AWS_REFERENCES : GCP_REFERENCES,
  };
}

export function createProjectMigrationTargetComparison(
  snapshot: ProjectMigrationSnapshotV1,
): ProjectMigrationTargetComparisonV1 {
  return {
    schema_version: PROJECT_MIGRATION_TARGETS_SCHEMA_VERSION,
    generated_at: snapshot.generated_at,
    project: {
      id: snapshot.project.id,
      name: snapshot.project.name,
      display_name: snapshot.project.display_name,
    },
    source_readiness: snapshot.readiness.status,
    targets: [
      buildTargetPlan('aws_ecs_fargate', snapshot),
      buildTargetPlan('gcp_cloud_run', snapshot),
    ],
    assessment_policy: {
      cloud_changes_made: false,
      pricing_queried: false,
      account_quotas_queried: false,
      data_copied: false,
      dns_changed: false,
    },
  };
}
