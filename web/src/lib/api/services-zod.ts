/**
 * Zod schemas for service-related API shapes — contract test use only.
 *
 * These schemas MUST stay in sync with the TS types in services.ts and
 * errorClasses.ts. Each schema is paired with a compile-time parity
 * assertion so drift is a build error, not a silent runtime mismatch.
 *
 * Import rule: this file is test-only. Never import it from production
 * code. Phase G bundle audit verifies zod is absent from web/dist/assets/.
 */
import { z } from 'zod';
import type { ServiceMetrics } from './services';
import type { ServiceHealth } from '../projectTopology';
import type { ErrorClass } from '../errorClasses';

// ─── ErrorClass ──────────────────────────────────────────────────────────────

export const ErrorClassSchema = z.enum([
  'CONFIG_MISSING',
  'GIT_ACCESS_DENIED',
  'BUILD_CONTEXT_MISMATCH',
  'IMAGE_WRONG_STAGE',
  'DEPENDENCY_UNHEALTHY',
  'DB_EXTENSION_MISSING',
  'PORT_CONFLICT',
  'CLI_OVERRIDE_SYNTAX',
  'RUNTIME_CRASH',
  'INFRA_UNAVAILABLE',
  'OOM_KILLED',
  'DOCKER_DAEMON_UNREACHABLE',
  'DISK_EXHAUSTED',
  'NETWORK_DEPENDENCY_UNREACHABLE',
  'HEALTHCHECK_TIMEOUT',
  'BUILD_TIMEOUT',
]);

// Compile-time parity assertion: z.infer<ErrorClassSchema> ↔ ErrorClass
type _ErrorClassParity =
  z.infer<typeof ErrorClassSchema> extends ErrorClass
    ? ErrorClass extends z.infer<typeof ErrorClassSchema>
      ? true
      : never
    : never;
const _errorClassCheck: _ErrorClassParity = true;
void _errorClassCheck;

// ─── ServiceHealth ────────────────────────────────────────────────────────────

export const ServiceHealthValueSchema = z.enum(['healthy', 'crashed', 'deploying']);

// Compile-time parity assertion
type _ServiceHealthParity =
  z.infer<typeof ServiceHealthValueSchema> extends ServiceHealth
    ? ServiceHealth extends z.infer<typeof ServiceHealthValueSchema>
      ? true
      : never
    : never;
const _serviceHealthCheck: _ServiceHealthParity = true;
void _serviceHealthCheck;

export const ServiceHealthSchema = z.object({
  health: ServiceHealthValueSchema,
});

// ─── ServiceMetrics ───────────────────────────────────────────────────────────

export const ServiceMetricsSchema = z.object({
  cpu: z.array(z.number()),
  memory: z.array(z.number()),
  requestsPerSec: z.array(z.number()),
  errorRate: z.array(z.number()),
  p95LatencyMs: z.number(),
  totalRequests: z.number(),
});

// Compile-time parity assertion
type _ServiceMetricsParity =
  z.infer<typeof ServiceMetricsSchema> extends ServiceMetrics
    ? ServiceMetrics extends z.infer<typeof ServiceMetricsSchema>
      ? true
      : never
    : never;
const _serviceMetricsCheck: _ServiceMetricsParity = true;
void _serviceMetricsCheck;
