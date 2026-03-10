import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('build-args');

export const BUILD_TIME_PREFIXES = [
  'NEXT_PUBLIC_',
  'VITE_',
  'REACT_APP_',
  'NUXT_PUBLIC_',
  'PUBLIC_',
  'GATSBY_',
];

/** Returns only env vars whose keys match known build-time prefixes. */
export function filterBuildTimeVars(envVars: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    if (BUILD_TIME_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      result[key] = value;
    }
  }
  if (Object.keys(result).length > 0) {
    log.debug({ keys: Object.keys(result) }, 'Build-time vars detected');
  }
  return result;
}

/**
 * Injects ARG declarations after every FROM line in a Dockerfile.
 * Required so --build-arg values are accessible within each build stage.
 */
export function injectBuildArgs(dockerfileContent: string, buildArgKeys: string[]): string {
  if (buildArgKeys.length === 0) return dockerfileContent;

  const argLines = buildArgKeys.map((k) => `ARG ${k}`).join('\n');
  const lines = dockerfileContent.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    result.push(line);
    if (/^FROM\s/i.test(line)) {
      result.push(argLines);
    }
  }

  return result.join('\n');
}
