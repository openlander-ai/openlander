import { createHash } from 'node:crypto';
import { posix, resolve, sep } from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

import { DeliveryManifestError } from '../errors.js';

const relativeArtifactPath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .superRefine((value, ctx) => {
    const normalized = posix.normalize(value.replaceAll('\\', '/'));
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
      ctx.addIssue({ code: 'custom', message: 'Report path must stay inside the repository.' });
    }
  });

const deliveryManifestSchema = z
  .object({
    version: z.literal(1),
    runner: z
      .object({
        image: z.string().trim().min(1).max(1_000),
        timeout_seconds: z.number().int().min(1).max(3_600).default(900),
      })
      .strict(),
    checks: z
      .array(
        z
          .object({
            key: z
              .string()
              .trim()
              .regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
            gate: z.string().trim().min(1).max(100),
            command: z.array(z.string().min(1).max(2_000)).min(1).max(100),
            timeout_seconds: z.number().int().min(1).max(3_600).optional(),
            report: z
              .object({
                path: relativeArtifactPath,
                format: z.enum(['junit', 'playwright', 'json']),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type DeliveryManifest = z.infer<typeof deliveryManifestSchema>;
export type DeliveryManifestCheck = DeliveryManifest['checks'][number];

export function deliveryManifestSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseDeliveryManifest(content: string): DeliveryManifest {
  let parsedYaml: unknown;
  try {
    parsedYaml = parse(content);
  } catch (error) {
    throw new DeliveryManifestError('Delivery manifest is not valid YAML.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const parsed = deliveryManifestSchema.safeParse(parsedYaml);
  if (!parsed.success) {
    throw new DeliveryManifestError('Delivery manifest does not match version 1.', {
      issues: parsed.error.issues,
    });
  }
  const duplicateKeys = parsed.data.checks
    .map((check) => check.key)
    .filter((key, index, values) => values.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    throw new DeliveryManifestError('Delivery manifest check keys must be unique.', {
      duplicateKeys: [...new Set(duplicateKeys)],
    });
  }
  return parsed.data;
}

export function resolveManifestReportPath(repositoryPath: string, reportPath: string): string {
  const normalized = posix.normalize(reportPath.replaceAll('\\', '/'));
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new DeliveryManifestError('Report path must stay inside the repository.', {
      reportPath,
    });
  }
  const repositoryRoot = resolve(repositoryPath);
  const target = resolve(repositoryRoot, normalized);
  if (target !== repositoryRoot && !target.startsWith(`${repositoryRoot}${sep}`)) {
    throw new DeliveryManifestError('Report path must stay inside the repository.', {
      reportPath,
    });
  }
  return target;
}
