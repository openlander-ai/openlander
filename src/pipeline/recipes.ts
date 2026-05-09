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
  action?: RecipeAction;
}

export type RecipeAction =
  | {
      type: 'set_env';
      key: string;
      value: string;
    }
  | {
      type: 'dockerfile_replace_pattern';
      pattern: string;
      replacement: string;
    }
  | {
      type: 'dockerfile_add_line';
      line: string;
      anchor: string;
      position: 'before' | 'after';
    }
  | {
      type: 'retry_no_cache';
    }
  | {
      type: 'skip';
    };

/**
 * Top build error patterns, ordered by frequency.
 * Sources: common Docker build failures from Node.js, Python, Java, .NET, Go, Ruby/Rails, and PHP/Laravel projects.
 */
export const BUILD_RECIPES: Recipe[] = [
  {
    pattern: /lease.*does not exist|failed.*commit.*on ref.*lease|buildkit.*lease/i,
    title: 'Docker BuildKit cache corruption (lease)',
    diagnosis:
      'The Docker BuildKit cache lease expired or was invalidated. This is a transient issue caused by build cache corruption — not a problem with the application code.',
    fix: 'Retry the build with `--no-cache` to bypass the corrupted cache layer. This usually resolves the issue on the first retry.',
    action: {
      type: 'retry_no_cache',
    },
  },
  {
    pattern: /node-gyp|gyp ERR|make.*Error.*1/i,
    title: 'Native module compilation failure (node-gyp)',
    diagnosis:
      'A native Node.js addon failed to compile. Common with packages like bcrypt, sharp, canvas, or sqlite3 on Alpine Linux.',
    fix: 'Switch base image from `node:22-alpine` to `node:22-bookworm-slim`. Or add build dependencies: `RUN apk add --no-cache python3 make g++` for Alpine.',
    action: {
      type: 'dockerfile_replace_pattern',
      pattern: 'FROM (node:[^-\\s]+)-alpine',
      replacement: 'FROM $1-bookworm-slim',
    },
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
    action: {
      type: 'dockerfile_add_line',
      line: 'ENV NODE_OPTIONS="--max-old-space-size=4096"',
      anchor: '^CMD\\b|^ENTRYPOINT\\b',
      position: 'before',
    },
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
    pattern:
      /NETSDK1\d{3}|The current \.NET SDK does not support targeting|It was not possible to find any installed \.NET SDKs/i,
    title: '.NET SDK/target framework mismatch',
    diagnosis:
      'The project target framework does not match the SDK version available in the build image, or no SDK is installed.',
    fix: 'Use an SDK base image aligned with the target framework (`mcr.microsoft.com/dotnet/sdk:8.0` for `net8.0`, `sdk:9.0` for `net9.0`) and ensure `global.json` does not pin an unavailable SDK version.',
  },
  {
    pattern:
      /NU1101|NU1301|error NU\d{4}|Unable to load the service index for source|dotnet restore.*failed/i,
    title: '.NET restore/dependency resolution failure',
    diagnosis:
      '`dotnet restore` could not resolve packages due to invalid package source settings, private feed credentials, or unavailable NuGet endpoints.',
    fix: 'Verify NuGet sources and credentials (`NuGet.config`), ensure private feed auth is passed in build args/secrets, and rerun restore with diagnostics: `dotnet restore --verbosity detailed`.',
  },
  {
    pattern:
      /Could not resolve dependencies|Could not find artifact|Non-resolvable parent POM|Failed to execute goal/i,
    title: 'Maven dependency resolution failure',
    diagnosis:
      'Maven could not resolve one or more dependencies or plugins. Typical causes are stale local metadata, private repository credentials, or an invalid parent POM reference.',
    fix: 'Verify repository access in `settings.xml` (if private), confirm dependency coordinates/versions, and rebuild with `./mvnw -U -DskipTests clean package` (or `mvn ...`) to refresh metadata.',
  },
  {
    pattern:
      /Could not determine java version|Unsupported class file major version|invalid source release|No matching toolchains found/i,
    title: 'Gradle/JDK version mismatch',
    diagnosis:
      'The Gradle build is running with a JDK version that does not match the project toolchain or compiled class target.',
    fix: 'Use a compatible JDK base image (for example Temurin 17 or 21), set Gradle toolchain/sourceCompatibility consistently, and rebuild via `./gradlew build -x test` (or `gradle ...`).',
  },
  {
    pattern:
      /Could not find gem|Bundler::GemNotFound|Gemfile\.lock.*(missing|not found)|bundle install.*failed/i,
    title: 'Bundler dependency resolution failure',
    diagnosis:
      'Bundler could not resolve or install gems. Usually caused by missing Gemfile.lock, mismatched Ruby/Bundler versions, or stale lockfile entries.',
    fix: 'Commit `Gemfile.lock`, use a compatible Ruby version in the Docker base image, and run `bundle install` locally to refresh lockfile metadata before rebuilding.',
  },
  {
    pattern: /native extension|extconf\.rb failed|mkmf\.log|pg_config.*not found|nokogiri.*failed/i,
    title: 'Ruby native extension build failure',
    diagnosis:
      'A gem with native extensions (for example `pg` or `nokogiri`) failed to compile because system build tools or headers are missing.',
    fix: 'Install required OS packages before `bundle install` (for Debian: `build-essential`, `libpq-dev`, `pkg-config`; for Alpine: `build-base`, `postgresql-dev`, `linux-headers`).',
  },
  {
    pattern:
      /assets:precompile|Sprockets::|Webpacker::Manifest::MissingEntryError|Propshaft::MissingAssetError/i,
    title: 'Rails asset precompile failure',
    diagnosis:
      'Rails failed during production asset build. Common causes are missing JS/CSS toolchain dependencies, missing `SECRET_KEY_BASE`, or invalid asset references.',
    fix: 'Precompile with `RAILS_ENV=production SECRET_KEY_BASE=dummy bundle exec rails assets:precompile`, ensure required frontend build tools are installed, and fix missing asset references.',
  },
  {
    pattern:
      /Your lock file does not contain a compatible set of packages|Your requirements could not be resolved to an installable set of packages/i,
    title: 'Composer dependency resolution failure',
    diagnosis:
      'Composer could not resolve dependency constraints from `composer.json`/`composer.lock`. This is usually caused by conflicting version ranges or stale lockfile metadata.',
    fix: 'Regenerate lockfile with `composer update` in a clean environment, commit `composer.lock`, and ensure dependency constraints are compatible before rebuilding.',
  },
  {
    pattern:
      /requires ext-[a-z0-9_]+ \* -> it is missing from your system|composer detected issues in your platform/i,
    title: 'PHP extension/platform requirement missing',
    diagnosis:
      'Composer detected missing PHP platform requirements (extension or PHP version mismatch), so package installation cannot proceed.',
    fix: 'Install required PHP extensions in Dockerfile (for example `docker-php-ext-install pdo pdo_mysql`) and align base image PHP version with `composer.json` platform constraints.',
  },
  {
    pattern: /EXPOSE.*port|listen.*EADDRINUSE|address already in use/i,
    title: 'Port conflict',
    diagnosis: 'The application is trying to bind to a port that is already in use.',
    fix: 'OpenLander auto-assigns ports — ensure your app reads the PORT environment variable: `const port = process.env.PORT || 3000`.',
  },
  {
    pattern:
      /container name.*already in use|Conflict.*container name|container.*already exists.*You have to remove/i,
    title: 'Docker container name conflict',
    diagnosis:
      'A container with the same name already exists. This happens when redeploying without removing the previous container first.',
    fix: 'Either: (1) Remove the old container: `docker rm -f <container_name>` then retry. (2) Use `docker compose down` before redeploying. (3) Use `docker compose up --force-recreate` to replace the existing container.',
  },
  {
    pattern: /env_file.*not found|No such file.*\.env|env_file.*does not exist/i,
    title: 'Docker Compose env_file missing',
    diagnosis:
      'The docker-compose.yml references an env_file that does not exist. This is common in monorepos where environment files are in different locations.',
    fix: 'Choose one of 3 monorepo patterns: (1) Root .env: `env_file: .env` — single file at repo root, shared by all services. (2) Selective injection: `environment: - KEY=${KEY}` — pass specific vars from host to container. (3) Per-service files: `env_file: ./services/backend/.env` — separate env file per service. Ensure the referenced file exists in the build context.',
  },
  {
    pattern: /depends_on.*not found|service.*not found|no such service|unknown service/i,
    title: 'Docker Compose service dependency not found',
    diagnosis:
      'The docker-compose.yml references a service in `depends_on` that is not defined in the same compose file.',
    fix: 'Verify all service names in `depends_on` are defined in the same docker-compose.yml. Check for typos in service names. If services are in separate compose files, use `docker compose -f file1.yml -f file2.yml up` to load multiple files.',
  },
  {
    pattern: /port.*already allocated|Bind.*address already in use.*compose|docker compose.*port/i,
    title: 'Docker Compose port conflict',
    diagnosis:
      'A port specified in the docker-compose.yml is already in use by another container or service.',
    fix: 'Either: (1) Stop the conflicting container: `docker ps` to find it, then `docker stop <container>`. (2) Change the port mapping in docker-compose.yml: `ports: ["8080:3000"]` instead of `"3000:3000"`. (3) Let OpenLander auto-assign ports by removing explicit port mappings.',
  },
  {
    pattern:
      /build.*context.*not found|unable to prepare context|build context.*does not exist|COPY.*build context/i,
    title: 'Docker Compose build context not found',
    diagnosis:
      'The `build.context` path in docker-compose.yml does not exist or is outside the allowed build context.',
    fix: 'Verify the `build.context` path in docker-compose.yml is relative to the compose file location. For example, if docker-compose.yml is in `./services/backend/`, then `build: { context: . }` refers to `./services/backend/`, not the repo root. Use `build: { context: ../.. }` to reference the repo root if needed.',
  },
  {
    pattern: /version.*obsolete|Compose file version.*is not supported|version.*deprecated/i,
    title: 'Docker Compose file version obsolete',
    diagnosis:
      'The docker-compose.yml specifies a version that is no longer supported by the installed Docker Compose.',
    fix: 'Update the `version:` field in docker-compose.yml to a supported version (3.8, 3.9, or omit it entirely for latest). Run `docker compose version` to check your installed version, then update the compose file accordingly.',
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
