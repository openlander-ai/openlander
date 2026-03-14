import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { detectFramework } from '../../src/pipeline/dockerfile-gen.js';

const qaRoot = mkdtempSync(join(tmpdir(), 'openlander-manual-qa-'));

afterAll(() => {
  rmSync(qaRoot, { recursive: true, force: true });
});

describe('manual QA evidence: framework auto-detect markers', () => {
  test('Rails markers (config/routes.rb + Gemfile) => rails', () => {
    const dir = join(qaRoot, 'rails');
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'routes.rb'), '# marker');
    writeFileSync(join(dir, 'Gemfile'), 'source "https://rubygems.org"');

    const result = detectFramework(dir).framework;
    expect(result).toBe('rails');
  });

  test('Spring markers (pom.xml + src/main/java/) => spring-boot', () => {
    const dir = join(qaRoot, 'spring');
    mkdirSync(join(dir, 'src', 'main', 'java'), { recursive: true });
    writeFileSync(join(dir, 'pom.xml'), '<project></project>');

    const result = detectFramework(dir).framework;
    expect(result).toBe('spring-boot');
  });

  test('Laravel markers (composer.json + artisan) => laravel', () => {
    const dir = join(qaRoot, 'laravel');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'composer.json'), '{}');
    writeFileSync(join(dir, 'artisan'), '#!/usr/bin/env php');

    const result = detectFramework(dir).framework;
    expect(result).toBe('laravel');
  });

  test('ASP.NET markers (*.csproj + Program.cs) => aspnet', () => {
    const dir = join(qaRoot, 'aspnet');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'WebApp.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
    writeFileSync(join(dir, 'Program.cs'), 'var builder = WebApplication.CreateBuilder(args);');

    const result = detectFramework(dir).framework;
    expect(result).toBe('aspnet');
  });
});
