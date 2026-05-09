import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PlanEnvEntry } from '../pipeline/deploy-plan/types.js';

/**
 * Parse KEY=value pairs from an env-like file.
 */
export function scanEnvFile(
  filePath: string,
  source: string,
  existing: PlanEnvEntry[] = [],
): PlanEnvEntry[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const seen = new Set(existing.map((entry) => entry.key));
    const discovered: PlanEnvEntry[] = [];
    const pattern = /^([A-Z_][A-Z0-9_]*)\s*=[ \t]*(.*)?$/gm;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const key = match[1];
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      const rawValue = match[2]?.trim();
      const hasDefault = rawValue !== undefined && rawValue !== '' && !rawValue.startsWith('#');

      discovered.push({
        key,
        source,
        required: !hasDefault,
        default: hasDefault ? rawValue : undefined,
      });
    }

    return discovered;
  } catch {
    return [];
  }
}

/**
 * Detect adjacent env template files and parse the first match.
 */
export function scanEnvTemplate(
  clonePath: string,
  envFilePath: string,
  existing: PlanEnvEntry[] = [],
): PlanEnvEntry[] {
  const dir = join(clonePath, envFilePath, '..');
  const templates = ['.env.example', '.env.sample', '.env.template'];

  for (const templateName of templates) {
    const templatePath = join(dir, templateName);
    if (!existsSync(templatePath)) {
      continue;
    }

    const relativeTemplatePath = relative(clonePath, templatePath);
    return scanEnvFile(templatePath, `${envFilePath} → ${relativeTemplatePath}`, existing);
  }

  return [];
}

/**
 * Parse Docker ARG declarations as environment entries.
 */
export function scanDockerfileArgs(
  clonePath: string,
  dockerfilePath: string,
  existing: PlanEnvEntry[] = [],
): PlanEnvEntry[] {
  try {
    const content = readFileSync(join(clonePath, dockerfilePath), 'utf8');
    const seen = new Set(existing.map((entry) => entry.key));
    const discovered: PlanEnvEntry[] = [];
    const argPattern = /^ARG\s+([A-Z_][A-Z0-9_]*)(?:\s*=[ \t]*(.*))?$/gm;

    let match: RegExpExecArray | null;
    while ((match = argPattern.exec(content)) !== null) {
      const key = match[1];
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      const defaultValue = match[2]?.trim();
      discovered.push({
        key,
        source: `Dockerfile ARG (${dockerfilePath})`,
        required: !defaultValue,
        default: defaultValue || undefined,
      });
    }

    return discovered;
  } catch {
    return [];
  }
}
