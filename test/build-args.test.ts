import { describe, it, expect } from 'vitest';
import { filterBuildTimeVars, injectBuildArgs } from '../src/pipeline/build-args.js';

describe('filterBuildTimeVars', () => {
  it('matches NEXT_PUBLIC_ prefix', () => {
    expect(filterBuildTimeVars({ NEXT_PUBLIC_API_URL: 'https://api.example.com' })).toEqual({
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
    });
  });

  it('matches VITE_ prefix', () => {
    expect(filterBuildTimeVars({ VITE_BASE_URL: '/app' })).toEqual({ VITE_BASE_URL: '/app' });
  });

  it('matches REACT_APP_ prefix', () => {
    expect(filterBuildTimeVars({ REACT_APP_KEY: 'abc' })).toEqual({ REACT_APP_KEY: 'abc' });
  });

  it('matches NUXT_PUBLIC_ prefix', () => {
    expect(filterBuildTimeVars({ NUXT_PUBLIC_API: 'x' })).toEqual({ NUXT_PUBLIC_API: 'x' });
  });

  it('matches PUBLIC_ prefix', () => {
    expect(filterBuildTimeVars({ PUBLIC_SITE_URL: 'https://example.com' })).toEqual({
      PUBLIC_SITE_URL: 'https://example.com',
    });
  });

  it('matches GATSBY_ prefix', () => {
    expect(filterBuildTimeVars({ GATSBY_API_KEY: 'key123' })).toEqual({
      GATSBY_API_KEY: 'key123',
    });
  });

  it('returns empty for non-matching vars', () => {
    expect(filterBuildTimeVars({ DATABASE_URL: 'postgres://...', SECRET_KEY: 'x' })).toEqual({});
  });

  it('returns only matching vars from mixed input', () => {
    const result = filterBuildTimeVars({
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
      DATABASE_URL: 'postgres://...',
      VITE_APP_TITLE: 'MyApp',
      SECRET_KEY: 'secret',
    });
    expect(result).toEqual({
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
      VITE_APP_TITLE: 'MyApp',
    });
  });
});

describe('injectBuildArgs', () => {
  it('injects ARG after FROM in single-stage Dockerfile', () => {
    const content = 'FROM node:22\nRUN npm install\n';
    const result = injectBuildArgs(content, ['NEXT_PUBLIC_API_URL']);
    expect(result).toBe('FROM node:22\nARG NEXT_PUBLIC_API_URL\nRUN npm install\n');
  });

  it('injects ARG after each FROM in 2-stage Dockerfile', () => {
    const content =
      'FROM node:22 AS builder\nRUN npm run build\nFROM node:22-slim\nCOPY --from=builder /app .';
    const result = injectBuildArgs(content, ['VITE_API_URL']);
    const lines = result.split('\n');
    const argLines = lines.filter((l) => l === 'ARG VITE_API_URL');
    expect(argLines).toHaveLength(2);
  });

  it('injects ARG after each FROM in 3-stage Dockerfile', () => {
    const content =
      'FROM node:22 AS deps\nRUN npm ci\nFROM node:22 AS builder\nRUN npm run build\nFROM node:22-slim\nCOPY --from=builder /app .';
    const result = injectBuildArgs(content, ['NEXT_PUBLIC_URL']);
    const lines = result.split('\n');
    const argLines = lines.filter((l) => l === 'ARG NEXT_PUBLIC_URL');
    expect(argLines).toHaveLength(3);
  });

  it('injects multiple ARG lines after FROM', () => {
    const content = 'FROM node:22\nRUN npm install\n';
    const result = injectBuildArgs(content, ['NEXT_PUBLIC_API_URL', 'VITE_APP_TITLE']);
    expect(result).toBe(
      'FROM node:22\nARG NEXT_PUBLIC_API_URL\nARG VITE_APP_TITLE\nRUN npm install\n',
    );
  });

  it('returns content unchanged when buildArgKeys is empty', () => {
    const content = 'FROM node:22\nRUN npm install\n';
    expect(injectBuildArgs(content, [])).toBe(content);
  });

  it('does not inject after commented # FROM lines', () => {
    const content = '# FROM node:22\nFROM node:22-slim\nRUN echo hello';
    const result = injectBuildArgs(content, ['NEXT_PUBLIC_X']);
    const lines = result.split('\n');
    const argLines = lines.filter((l) => l === 'ARG NEXT_PUBLIC_X');
    expect(argLines).toHaveLength(1);
  });
});
