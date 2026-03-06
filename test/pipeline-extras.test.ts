import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  detectFramework,
  generateDockerfile,
  ensureDockerfile,
  type FrameworkDetection,
} from '../src/pipeline/dockerfile-gen.js';

// ---------------------------------------------------------------------------
// Framework Detection Tests
// ---------------------------------------------------------------------------

describe('detectFramework', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-dockerfile-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Next.js project from package.json dependencies', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
      'utf8',
    );

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('nextjs');
    expect(result.language).toBe('node');
    expect(result.port).toBe(3000);
  });

  it('detects Next.js from devDependencies', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { next: '^14.0.0' } }),
      'utf8',
    );

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('nextjs');
  });

  it('detects Vite project', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.0.0' } }),
      'utf8',
    );

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('vite');
    expect(result.language).toBe('node');
  });

  it('detects Express project', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.18.0' } }),
      'utf8',
    );

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('express');
    expect(result.language).toBe('node');
  });

  it('detects generic Node project with start script', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { start: 'node index.js' } }),
      'utf8',
    );

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('node');
    expect(result.startCommand).toBe('npm start');
  });

  it('detects FastAPI project from requirements.txt', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'fastapi\nuvicorn', 'utf8');

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('fastapi');
    expect(result.language).toBe('python');
    expect(result.port).toBe(8000);
  });

  it('detects Flask project from requirements.txt', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'flask\ngunicorn', 'utf8');

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('flask');
    expect(result.language).toBe('python');
    expect(result.port).toBe(5000);
  });

  it('detects Django project from requirements.txt', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'django\ngunicorn', 'utf8');

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('django');
    expect(result.language).toBe('python');
  });

  it('detects generic Python project', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'requests\nnumpy', 'utf8');

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('python');
    expect(result.language).toBe('python');
  });

  it('detects Python project from pyproject.toml', () => {
    writeFileSync(join(tmpDir, 'pyproject.toml'), '[project]\nname = "test"', 'utf8');

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('python');
    expect(result.language).toBe('python');
  });

  it('detects Go project from go.mod', () => {
    writeFileSync(join(tmpDir, 'go.mod'), 'module example.com/myapp\ngo 1.21', 'utf8');

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('go');
    expect(result.language).toBe('go');
    expect(result.port).toBe(8080);
  });

  it('detects Rust project from Cargo.toml', () => {
    writeFileSync(join(tmpDir, 'Cargo.toml'), '[package]\nname = "myapp"', 'utf8');

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('rust');
    expect(result.language).toBe('rust');
  });

  it('detects static HTML project from index.html', () => {
    writeFileSync(join(tmpDir, 'index.html'), '<html><body>Hello</body></html>', 'utf8');

    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('static-html');
    expect(result.language).toBe('html');
    expect(result.port).toBe(80);
  });

  it('returns unknown for unrecognized projects', () => {
    // Empty directory
    const result = detectFramework(tmpDir);

    expect(result.framework).toBe('unknown');
    expect(result.language).toBe('unknown');
  });

  it('detects monorepo subdirectory (Next.js in subfolder)', () => {
    mkdirSync(join(tmpDir, 'frontend'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'frontend', 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
      'utf8',
    );

    const result = detectFramework(join(tmpDir, 'frontend'));

    expect(result.framework).toBe('nextjs');
  });
});

// ---------------------------------------------------------------------------
// Dockerfile Generation Tests
// ---------------------------------------------------------------------------

describe('generateDockerfile', () => {
  it('generates Next.js Dockerfile with multi-stage build', () => {
    const detection: FrameworkDetection = {
      framework: 'nextjs',
      language: 'node',
      buildCommand: 'npm run build && npm start',
      startCommand: 'npm start',
      port: 3000,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM node:20-alpine AS deps');
    expect(dockerfile).toContain('FROM node:20-alpine AS builder');
    expect(dockerfile).toContain('FROM node:20-alpine AS runner');
    expect(dockerfile).toContain('npm run build');
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(dockerfile).toContain('HEALTHCHECK');
  });

  it('generates Vite Dockerfile with nginx', () => {
    const detection: FrameworkDetection = {
      framework: 'vite',
      language: 'node',
      buildCommand: 'npm run build',
      startCommand: 'nginx -g "daemon off;"',
      port: 3000,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM nginx:1.27.4-alpine AS runner');
    expect(dockerfile).toContain('/app/dist');
    expect(dockerfile).toContain('/usr/share/nginx/html');
  });

  it('generates Express/Node Dockerfile', () => {
    const detection: FrameworkDetection = {
      framework: 'express',
      language: 'node',
      startCommand: 'npm start',
      port: 3000,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM node:20-alpine AS deps');
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('CMD ["npm", "start"]');
  });

  it('generates FastAPI Dockerfile', () => {
    const detection: FrameworkDetection = {
      framework: 'fastapi',
      language: 'python',
      startCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000',
      port: 8000,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM python:3.12.8-slim');
    expect(dockerfile).toContain('"uvicorn"');
    expect(dockerfile).toContain('"main:app"');
    expect(dockerfile).toContain('EXPOSE 8000');
  });

  it('generates Flask Dockerfile', () => {
    const detection: FrameworkDetection = {
      framework: 'flask',
      language: 'python',
      startCommand: 'gunicorn app:app --bind 0.0.0.0:5000',
      port: 5000,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM python:3.12.8-slim');
    expect(dockerfile).toContain('"gunicorn"');
    expect(dockerfile).toContain('"app:app"');
    expect(dockerfile).toContain('EXPOSE 5000');
  });

  it('generates Go Dockerfile', () => {
    const detection: FrameworkDetection = {
      framework: 'go',
      language: 'go',
      buildCommand: 'go build -o app . && ./app',
      startCommand: './app',
      port: 8080,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM golang:1.23.6-alpine AS builder');
    expect(dockerfile).toContain('FROM alpine:3.21.2 AS runner');
    expect(dockerfile).toContain('EXPOSE 8080');
  });

  it('generates Rust Dockerfile', () => {
    const detection: FrameworkDetection = {
      framework: 'rust',
      language: 'rust',
      buildCommand: 'cargo build --release',
      startCommand: './app',
      port: 8080,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM rust:1.83.0-bookworm AS builder');
    expect(dockerfile).toContain('cargo build --release');
    expect(dockerfile).toContain('EXPOSE 8080');
  });

  it('generates static HTML Dockerfile with nginx', () => {
    const detection: FrameworkDetection = {
      framework: 'static-html',
      language: 'html',
      startCommand: 'nginx -g "daemon off;"',
      port: 80,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM nginx:1.27.4-alpine');
    expect(dockerfile).toContain('EXPOSE 80');
    expect(dockerfile).toContain('/usr/share/nginx/html');
  });

  it('generates fallback Dockerfile for unknown frameworks', () => {
    const detection: FrameworkDetection = {
      framework: 'unknown',
      language: 'unknown',
      port: 8080,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('FROM alpine:3.21.2');
    expect(dockerfile).toContain('Unknown framework');
    expect(dockerfile).toContain('EXPOSE 8080');
  });

  it('uses custom port for unknown framework', () => {
    const detection: FrameworkDetection = {
      framework: 'unknown',
      language: 'unknown',
      port: 9000,
    };

    const dockerfile = generateDockerfile(detection);

    expect(dockerfile).toContain('EXPOSE 9000');
  });
});

// ---------------------------------------------------------------------------
// ensureDockerfile Tests
// ---------------------------------------------------------------------------

describe('ensureDockerfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-ensure-dockerfile-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates Dockerfile when it does not exist', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.18.0' } }),
      'utf8',
    );

    const result = ensureDockerfile(tmpDir);

    expect(result.generated).toBe(true);
    expect(result.detection?.framework).toBe('express');
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(true);
  });

  it('does not modify existing Dockerfile', () => {
    const existingDockerfile = 'FROM alpine\necho "custom"';
    writeFileSync(join(tmpDir, 'Dockerfile'), existingDockerfile, 'utf8');

    const result = ensureDockerfile(tmpDir);

    expect(result.generated).toBe(false);
    expect(result.detection).toBeNull();
    expect(readFileSync(join(tmpDir, 'Dockerfile'), 'utf8')).toBe(existingDockerfile);
  });

  it('generates .dockerignore when it does not exist', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');

    ensureDockerfile(tmpDir);

    expect(existsSync(join(tmpDir, '.dockerignore'))).toBe(true);
    const dockerignore = readFileSync(join(tmpDir, '.dockerignore'), 'utf8');
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('.git');
    expect(dockerignore).toContain('.env');
  });

  it('does not modify existing .dockerignore', () => {
    const existingDockerignore = 'custom\nignore\n';
    writeFileSync(join(tmpDir, '.dockerignore'), existingDockerignore, 'utf8');
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM alpine', 'utf8');

    ensureDockerfile(tmpDir);

    expect(readFileSync(join(tmpDir, '.dockerignore'), 'utf8')).toBe(existingDockerignore);
  });

  it('handles monorepo paths correctly', () => {
    mkdirSync(join(tmpDir, 'services', 'api'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'services', 'api', 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.18.0' } }),
      'utf8',
    );

    const result = ensureDockerfile(join(tmpDir, 'services', 'api'));

    expect(result.generated).toBe(true);
    expect(result.detection?.framework).toBe('express');
    expect(existsSync(join(tmpDir, 'services', 'api', 'Dockerfile'))).toBe(true);
  });
});
