import { describe, it, expect } from 'vitest';
import { createDeployPlanSchema } from '../../src/tools/defs/schemas.js';

describe('Project name validation - BUG-001', () => {
  describe('Valid project names', () => {
    it('accepts lowercase letters and numbers', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: 'my-app',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('my-app');
      }
    });

    it('accepts names starting with lowercase letter', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: 'api2',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('api2');
      }
    });

    it('accepts names starting with number', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: '2api',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('2api');
      }
    });

    it('accepts names with hyphens', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: 'test-123',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-123');
      }
    });

    it('accepts optional name (auto-generated from repo)', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid project names', () => {
    it('rejects Korean characters', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: '한글',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('lowercase letters, numbers, and hyphens');
      }
    });

    it('rejects special characters', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: 'My Project!',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('lowercase letters, numbers, and hyphens');
      }
    });

    it('rejects path traversal attempts', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: '../escape',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('lowercase letters, numbers, and hyphens');
      }
    });

    it('rejects names starting with hyphen', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: '-leading',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('lowercase letters, numbers, and hyphens');
      }
    });

    it('rejects uppercase letters', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: 'MyApp',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('lowercase letters, numbers, and hyphens');
      }
    });

    it('rejects spaces', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: 'my app',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('lowercase letters, numbers, and hyphens');
      }
    });

    it('rejects underscores', () => {
      const input = {
        repo_url: 'https://github.com/user/repo',
        name: 'my_app',
      };

      const result = createDeployPlanSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('lowercase letters, numbers, and hyphens');
      }
    });
  });
});
