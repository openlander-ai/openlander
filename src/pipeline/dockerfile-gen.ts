import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('dockerfile-gen');

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Framework/language detection result for Dockerfile generation.
 */
export interface FrameworkDetection {
  framework: string;
  language: string;
  buildCommand?: string;
  startCommand?: string;
  port?: number;
}

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const DEFAULT_DOCKERIGNORE = `# VCS
.git
.gitignore

# Dependencies
node_modules

# Build artifacts
dist
build
.next
coverage

# Runtime files
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Env/config
.env
.env.*

# IDE
.DS_Store
.idea
.vscode

# Python
__pycache__
*.pyc
.venv
venv

# Rust/Go
target
`;

/**
 * Detect framework and runtime language using deterministic, rule-based file checks.
 */
export function detectFramework(projectPath: string): FrameworkDetection {
  const packageJsonPath = join(projectPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    const packageJson = readPackageJson(packageJsonPath);
    const deps = packageJson.dependencies ?? {};
    const devDeps = packageJson.devDependencies ?? {};
    const scripts = packageJson.scripts ?? {};

    if (hasKey(deps, 'next') || hasKey(devDeps, 'next')) {
      // Check for Next.js static export (output: 'export' in next.config.*)
      if (isNextjsStaticExport(projectPath)) {
        return {
          framework: 'nextjs-static',
          language: 'node',
          buildCommand: 'npm run build',
          startCommand: 'nginx -g "daemon off;"',
          port: 3000,
        };
      }
      return {
        framework: 'nextjs',
        language: 'node',
        buildCommand: 'npm run build && npm start',
        startCommand: 'npm start',
        port: 3000,
      };
    }

    if (hasKey(devDeps, 'vite') || hasKey(deps, 'vite')) {
      return {
        framework: 'vite',
        language: 'node',
        buildCommand: 'npm run build',
        startCommand: 'nginx -g "daemon off;"',
        port: 3000,
      };
    }

    if (hasKey(deps, 'express')) {
      return {
        framework: 'express',
        language: 'node',
        startCommand: 'npm start',
        port: 3000,
      };
    }

    if (hasKey(scripts, 'start')) {
      return {
        framework: 'node',
        language: 'node',
        startCommand: 'npm start',
        port: 3000,
      };
    }

    return {
      framework: 'node',
      language: 'node',
      startCommand: 'node index.js',
      port: 3000,
    };
  }

  const requirementsPath = join(projectPath, 'requirements.txt');
  const pyprojectPath = join(projectPath, 'pyproject.toml');
  if (existsSync(requirementsPath) || existsSync(pyprojectPath)) {
    const requirementsContent = readTextIfExists(requirementsPath);
    const pyprojectContent = readTextIfExists(pyprojectPath);
    const pythonSpec = `${requirementsContent}\n${pyprojectContent}`.toLowerCase();

    if (pythonSpec.includes('fastapi')) {
      return {
        framework: 'fastapi',
        language: 'python',
        startCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000',
        port: 8000,
      };
    }

    if (pythonSpec.includes('flask')) {
      return {
        framework: 'flask',
        language: 'python',
        startCommand: 'gunicorn app:app --bind 0.0.0.0:5000',
        port: 5000,
      };
    }

    if (pythonSpec.includes('django')) {
      return {
        framework: 'django',
        language: 'python',
        startCommand: 'gunicorn config.wsgi:application --bind 0.0.0.0:8000',
        port: 8000,
      };
    }

    return {
      framework: 'python',
      language: 'python',
      startCommand: 'python main.py',
      port: 8000,
    };
  }

  if (existsSync(join(projectPath, 'go.mod'))) {
    return {
      framework: 'go',
      language: 'go',
      buildCommand: 'go build -o app . && ./app',
      startCommand: './app',
      port: 8080,
    };
  }

  if (existsSync(join(projectPath, 'Cargo.toml'))) {
    return {
      framework: 'rust',
      language: 'rust',
      buildCommand: 'cargo build --release',
      startCommand: './app',
      port: 8080,
    };
  }

  if (existsSync(join(projectPath, 'index.html'))) {
    return {
      framework: 'static-html',
      language: 'html',
      startCommand: 'nginx -g "daemon off;"',
      port: 80,
    };
  }

  return {
    framework: 'unknown',
    language: 'unknown',
    port: 8080,
  };
}

/**
 * Check if a Next.js project uses static export (output: 'export' in next.config.*).
 * When output is 'export', `next start` fails — must use a static server instead.
 */
function isNextjsStaticExport(projectPath: string): boolean {
  const configFiles = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
  for (const configFile of configFiles) {
    const configPath = join(projectPath, configFile);
    const content = readTextIfExists(configPath);
    if (content && /output\s*:\s*['"]export['"]/.test(content)) {
      return true;
    }
  }
  return false;
}

/**
 * Generate a production Dockerfile from a deterministic framework detection result.
 */
export function generateDockerfile(detection: FrameworkDetection): string {
  switch (detection.framework) {
    case 'nextjs':
      return `FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "require('http').get('http://127.0.0.1:3000', (res) => process.exit(res.statusCode >= 500 ? 1 : 0)).on('error', () => process.exit(1))"
CMD ["npm", "start"]
`;

    case 'nextjs-static':
      return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27.4-alpine AS runner
RUN addgroup -S app && adduser -S app -G app \
  && sed -i 's|pid.*nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && rm -f /etc/nginx/conf.d/default.conf \
  && printf 'server {\\n  listen 3000;\\n  server_name _;\\n  root /usr/share/nginx/html;\\n  index index.html;\\n  location / {\\n    try_files $uri $uri/ /index.html;\\n  }\\n}\\n' > /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html
RUN chown -R app:app /usr/share/nginx/html /var/cache/nginx /var/run /var/log/nginx
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
`;

    case 'vite':
      return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27.4-alpine AS runner
RUN addgroup -S app && adduser -S app -G app \
  && sed -i 's|pid.*nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && rm -f /etc/nginx/conf.d/default.conf \
  && printf 'server {\\n  listen 3000;\\n  server_name _;\\n  root /usr/share/nginx/html;\\n  index index.html;\\n  location / {\\n    try_files $uri /index.html;\\n  }\\n}\\n' > /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
RUN chown -R app:app /usr/share/nginx/html /var/cache/nginx /var/run /var/log/nginx
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
`;

    case 'express':
    case 'node':
      return `FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "require('http').get('http://127.0.0.1:3000', (res) => process.exit(res.statusCode >= 500 ? 1 : 0)).on('error', () => process.exit(1))"
CMD ["npm", "start"]
`;

    case 'fastapi':
      return `FROM python:3.12.8-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN useradd --create-home --shell /bin/bash app
COPY . .
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi
RUN chown -R app:app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`;

    case 'flask':
      return `FROM python:3.12.8-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN useradd --create-home --shell /bin/bash app
COPY . .
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi
RUN chown -R app:app /app
USER app
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000')"
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:5000"]
`;

    case 'django':
      return `FROM python:3.12.8-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN useradd --create-home --shell /bin/bash app
COPY . .
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi
RUN chown -R app:app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000')"
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
`;

    case 'python':
      return `FROM python:3.12.8-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN useradd --create-home --shell /bin/bash app
COPY . .
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi
RUN chown -R app:app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000')"
CMD ["python", "main.py"]
`;

    case 'go':
      return `FROM golang:1.23.6-alpine AS builder
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/app .

FROM alpine:3.21.2 AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /out/app ./app
RUN chown -R app:app /app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["./app"]
`;

    case 'rust':
      return `FROM rust:1.83.0-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock* ./
RUN mkdir -p src && printf 'fn main() {}\\n' > src/main.rs
RUN cargo build --release || true
RUN rm -rf src
COPY . .
RUN cargo build --release
RUN mkdir -p /out && find target/release -maxdepth 1 -type f -executable -exec cp {} /out/ \\
  || true

FROM debian:12.9-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app && useradd --system --gid app --create-home app
WORKDIR /app
COPY --from=builder /out /app/bin
RUN chown -R app:app /app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["sh", "-c", "wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1"]
CMD ["sh", "-c", "set -e; BIN=$(find /app/bin -maxdepth 1 -type f -executable | head -n 1); exec $BIN"]
`;

    case 'static-html':
      return `FROM nginx:1.27.4-alpine
RUN addgroup -S app && adduser -S app -G app \
  && sed -i 's|pid.*nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && apk add --no-cache libcap \
  && setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx \
  && apk del libcap \
  && rm -f /etc/nginx/conf.d/default.conf \
  && printf 'server {\\n  listen 80;\\n  server_name _;\\n  root /usr/share/nginx/html;\\n  index index.html;\\n  location / {\\n    try_files $uri $uri/ =404;\\n  }\\n}\\n' > /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
RUN chown -R app:app /usr/share/nginx/html /var/cache/nginx /var/run /var/log/nginx
USER app
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
`;

    default:
      return `FROM alpine:3.21.2
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY . .
RUN chown -R app:app /app
USER app
EXPOSE ${String(detection.port ?? 8080)}
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["sh", "-c", "exit 0"]
CMD ["sh", "-c", "echo 'Unknown framework. Provide a Dockerfile.' && sleep infinity"]
`;
  }
}

/**
 * Ensure Dockerfile exists for a project, generating Dockerfile and .dockerignore when missing.
 */
export function ensureDockerfile(projectPath: string): {
  generated: boolean;
  detection: FrameworkDetection | null;
} {
  const dockerfilePath = join(projectPath, 'Dockerfile');
  const dockerignorePath = join(projectPath, '.dockerignore');

  if (!existsSync(dockerignorePath)) {
    writeFileSync(dockerignorePath, DEFAULT_DOCKERIGNORE, 'utf8');
  }

  if (existsSync(dockerfilePath)) {
    return { generated: false, detection: null };
  }

  const detection = detectFramework(projectPath);
  const dockerfile = generateDockerfile(detection);
  writeFileSync(dockerfilePath, dockerfile, 'utf8');

  return {
    generated: true,
    detection,
  };
}

function readPackageJson(packageJsonPath: string): PackageJsonLike {
  try {
    const raw = readFileSync(packageJsonPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return {};
    }

    return {
      dependencies: readStringRecord(parsed.dependencies),
      devDependencies: readStringRecord(parsed.devDependencies),
      scripts: readStringRecord(parsed.scripts),
    };
  } catch (err) {
    log.debug({ err }, 'Failed to parse package.json — returning empty config');
    return {};
    return {};
  }
}

function readTextIfExists(filePath: string): string {
  if (!existsSync(filePath)) {
    return '';
  }

  try {
    return readFileSync(filePath, 'utf8');
  } catch (err) {
    log.debug({ err }, 'Failed to read file — returning empty string');
    return '';
    return '';
  }
}

function hasKey(obj: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      result[k] = v;
    }
  }

  return result;
}

/**
 * Parse a Dockerfile and return the first EXPOSE port number.
 * Returns undefined if no EXPOSE directive is found.
 */
export function parseDockerfileExposePort(dockerfilePath: string): number | undefined {
  try {
    const content = readFileSync(dockerfilePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Match: EXPOSE 80, EXPOSE 8080/tcp, EXPOSE 3000
      const match = trimmed.match(/^EXPOSE\s+(\d+)/i);
      if (match?.[1]) {
        const port = parseInt(match[1], 10);
        if (!isNaN(port) && port > 0 && port <= 65535) {
          return port;
        }
      }
    }
  } catch {
    log.warn({ dockerfilePath }, 'Failed to parse Dockerfile for EXPOSE port');
  }
  return undefined;
}
