/**
 * Build error recipe system.
 *
 * Recipes are pattern-matched against build logs to provide
 * instant diagnosis without requiring an LLM call.
 * When a recipe matches, the diagnosis is returned directly.
 * When no recipe matches, the BuildDebugger LLM analysis is used as fallback.
 */

export interface Recipe {
  /** Regex pattern to match against build log output */
  pattern: RegExp;
  /** Short title for the error category */
  title: string;
  /** Root cause explanation */
  diagnosis: string;
  /** Actionable fix instructions */
  fix: string;
}

/**
 * Top build error patterns, ordered by frequency.
 * Sources: common Docker build failures from Node.js, Python, and Go projects.
 */
export const BUILD_RECIPES: Recipe[] = [
  {
    pattern: /node-gyp|gyp ERR|make.*Error.*1/i,
    title: 'Native module compilation failure (node-gyp)',
    diagnosis:
      'A native Node.js addon failed to compile. Common with packages like bcrypt, sharp, canvas, or sqlite3 on Alpine Linux.',
    fix: 'Switch base image from `node:22-alpine` to `node:22-bookworm-slim`. Or add build dependencies: `RUN apk add --no-cache python3 make g++` for Alpine.',
  },
  {
    pattern: /sharp\/.*Error|libvips|vips\/vips/i,
    title: 'Sharp image library build failure',
    diagnosis: 'The `sharp` package requires `libvips` which is not available in the base image.',
    fix: 'Use `node:22-bookworm-slim` (not Alpine). Or add: `RUN apk add --no-cache vips-dev` for Alpine. Also ensure `sharp` platform config in package.json: `"sharp": { "platforms": ["linux"] }`.',
  },
  {
    pattern: /prisma.*generate|prisma.*engine|PRISMA_BINARY/i,
    title: 'Prisma client generation failure',
    diagnosis:
      'Prisma needs to generate its client during build, or the binary target does not match the container OS.',
    fix: 'Add `RUN npx prisma generate` after `COPY . .` in the Dockerfile. Also add the correct binary target in schema.prisma: `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` for Alpine.',
  },
  {
    pattern: /ECONNREFUSED|EAI_AGAIN|getaddrinfo.*ENOTFOUND|network.*unreachable/i,
    title: 'Network error during build',
    diagnosis:
      'The build tried to reach an external service (npm registry, database, API) that was unreachable.',
    fix: 'Check: (1) Docker network/DNS settings, (2) npm registry availability, (3) Do not connect to databases during build — use runtime-only connections.',
  },
  {
    pattern: /ENOMEM|Cannot allocate memory|JavaScript heap out of memory/i,
    title: 'Out of memory during build',
    diagnosis:
      'The build process ran out of memory. Common with large TypeScript projects or webpack builds.',
    fix: 'Increase Docker memory limit, or add `ENV NODE_OPTIONS="--max-old-space-size=4096"` in the Dockerfile before the build step.',
  },
  {
    pattern: /COPY failed.*stat.*no such file/i,
    title: 'Dockerfile COPY source not found',
    diagnosis:
      'A COPY instruction references a file or directory that does not exist in the build context.',
    fix: 'Check the COPY source path. Common causes: (1) .dockerignore excluding needed files, (2) Wrong relative path, (3) File only exists after a build step.',
  },
  {
    pattern: /Module not found|Cannot find module|ERR_MODULE_NOT_FOUND/i,
    title: 'Missing module/dependency',
    diagnosis: 'A required module is not installed or the import path is wrong.',
    fix: 'Ensure `npm install` or `npm ci` runs before the build step. Check that the module is in dependencies (not just devDependencies if needed at runtime).',
  },
  {
    pattern: /EACCES.*permission denied|chmod|chown.*Operation not permitted/i,
    title: 'File permission error',
    diagnosis: 'The build or run process lacks permissions to access a file or directory.',
    fix: 'Add `RUN chown -R node:node /app` before switching to non-root user. Or run the problematic step as root before `USER node`.',
  },
  {
    pattern: /pip.*install.*error|ModuleNotFoundError|No matching distribution/i,
    title: 'Python dependency installation failure',
    diagnosis:
      'A Python package failed to install — either missing system dependencies or incompatible Python version.',
    fix: 'Use `python:3.12-bookworm-slim` (not Alpine). For Alpine, add: `RUN apk add --no-cache gcc musl-dev libffi-dev`. Check Python version compatibility.',
  },
  {
    pattern: /EXPOSE.*port|listen.*EADDRINUSE|address already in use/i,
    title: 'Port conflict',
    diagnosis: 'The application is trying to bind to a port that is already in use.',
    fix: 'OpenLander auto-assigns ports — ensure your app reads the PORT environment variable: `const port = process.env.PORT || 3000`.',
  },
];

/**
 * Match a build log against known recipes.
 * Returns the first matching recipe, or null if none match.
 */
export function matchRecipe(buildLog: string): Recipe | null {
  return BUILD_RECIPES.find((r) => r.pattern.test(buildLog)) ?? null;
}

/**
 * Match all applicable recipes against a build log.
 * Multiple patterns may match for complex errors.
 */
export function matchAllRecipes(buildLog: string): Recipe[] {
  return BUILD_RECIPES.filter((r) => r.pattern.test(buildLog));
}
