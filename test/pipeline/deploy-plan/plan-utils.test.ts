import { describe, expect, it } from 'vitest';

import {
  computeComplexity,
  computeMissingEnvVars,
} from '../../../src/pipeline/deploy-plan/plan-utils.js';
import type { PlanEnvEntry } from '../../../src/pipeline/deploy-plan/types.js';

describe('plan-utils', () => {
  describe('computeMissingEnvVars', () => {
    it('returns only required keys that are neither auto-detected nor provided', () => {
      const entries: PlanEnvEntry[] = [
        { key: 'A', source: '.env.example', required: true },
        { key: 'B', source: '.env.example', required: true },
        { key: 'C', source: '.env.example', required: true },
      ];

      const autoDetected = { A: 'x' };
      const provided = { B: 'y' };

      expect(computeMissingEnvVars(entries, provided, autoDetected)).toEqual([
        { key: 'C', source: '.env.example', required: true },
      ]);
    });

    it('returns empty list when all required keys are satisfied', () => {
      const entries: PlanEnvEntry[] = [
        { key: 'A', source: '.env.example', required: true },
        { key: 'B', source: '.env.example', required: true },
      ];

      const autoDetected = { A: 'auto-value' };
      const provided = { B: 'provided-value' };

      expect(computeMissingEnvVars(entries, provided, autoDetected)).toEqual([]);
    });

    it('does not flag env vars that exist in the database', () => {
      const entries: PlanEnvEntry[] = [
        { key: 'DATABASE_URL', source: 'Dockerfile', required: true },
        { key: 'API_KEY', source: '.env.example', required: true },
      ];

      const provided = {};
      const autoDetected = {};
      const existingEnvVars = { DATABASE_URL: 'postgres://...' };

      expect(computeMissingEnvVars(entries, provided, autoDetected, existingEnvVars)).toEqual([
        { key: 'API_KEY', source: '.env.example', required: true },
      ]);
    });

    it('flags env vars as missing when existingEnvVars is empty (new project)', () => {
      const entries: PlanEnvEntry[] = [
        { key: 'DATABASE_URL', source: 'Dockerfile', required: true },
        { key: 'API_KEY', source: '.env.example', required: true },
      ];

      const provided = {};
      const autoDetected = {};
      const existingEnvVars = {};

      expect(computeMissingEnvVars(entries, provided, autoDetected, existingEnvVars)).toEqual([
        { key: 'DATABASE_URL', source: 'Dockerfile', required: true },
        { key: 'API_KEY', source: '.env.example', required: true },
      ]);
    });

    it('prioritizes provided vars over existing database vars', () => {
      const entries: PlanEnvEntry[] = [
        { key: 'DATABASE_URL', source: 'Dockerfile', required: true },
      ];

      const provided = { DATABASE_URL: 'new-value' };
      const autoDetected = {};
      const existingEnvVars = { DATABASE_URL: 'old-value' };

      expect(computeMissingEnvVars(entries, provided, autoDetected, existingEnvVars)).toEqual([]);
    });

    it('prioritizes auto-detected vars over existing database vars', () => {
      const entries: PlanEnvEntry[] = [
        { key: 'DATABASE_URL', source: 'Dockerfile', required: true },
      ];

      const provided = {};
      const autoDetected = { DATABASE_URL: 'auto-value' };
      const existingEnvVars = { DATABASE_URL: 'old-value' };

      expect(computeMissingEnvVars(entries, provided, autoDetected, existingEnvVars)).toEqual([]);
    });
  });

  describe('computeComplexity', () => {
    it('returns simple when there are no missing vars, no services, and not compose', () => {
      expect(
        computeComplexity({
          missingCount: 0,
          serviceCount: 0,
          isCompose: false,
        }),
      ).toBe('simple');
    });

    it('returns complex when missing vars are greater than 3', () => {
      expect(
        computeComplexity({
          missingCount: 4,
          serviceCount: 0,
          isCompose: false,
        }),
      ).toBe('complex');
    });

    it('returns complex when services are greater than 2', () => {
      expect(
        computeComplexity({
          missingCount: 0,
          serviceCount: 3,
          isCompose: false,
        }),
      ).toBe('complex');
    });

    it('returns standard for moderate complexity', () => {
      expect(
        computeComplexity({
          missingCount: 1,
          serviceCount: 1,
          isCompose: false,
        }),
      ).toBe('standard');
    });
  });
});
