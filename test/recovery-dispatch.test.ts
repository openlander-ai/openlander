import { describe, expect, it } from 'vitest';

import {
  DockerfileNotFoundError,
  GitAuthError,
  GitBranchNotFoundError,
  GitRepoNotFoundError,
} from '../src/errors.js';
import { dispatchRecovery } from '../src/pipeline/recovery-dispatch.js';

describe('dispatchRecovery', () => {
  it('classifies auth failure as clone_auth with fixability=user', () => {
    const plan = dispatchRecovery(
      'clone',
      new GitAuthError('https://github.com/user/repo').message,
    );
    expect(plan.category).toBe('clone_auth');
    expect(plan.fixability).toBe('user');
    expect(plan.userSteps.length).toBeGreaterThan(0);
    expect(plan.agentGuidance).toBe('');
  });

  it('classifies repo not found as clone_repo_not_found with fixability=user', () => {
    const plan = dispatchRecovery(
      'clone',
      new GitRepoNotFoundError('https://github.com/user/repo').message,
    );
    expect(plan.category).toBe('clone_repo_not_found');
    expect(plan.fixability).toBe('user');
  });

  it('classifies branch not found as clone_branch_not_found with fixability=user', () => {
    const plan = dispatchRecovery(
      'clone',
      new GitBranchNotFoundError('https://github.com/user/repo', 'develop').message,
    );
    expect(plan.category).toBe('clone_branch_not_found');
    expect(plan.fixability).toBe('user');
  });

  it('classifies generic clone error as clone_generic with fixability=user', () => {
    const plan = dispatchRecovery('clone', 'Failed to clone: timeout');
    expect(plan.category).toBe('clone_generic');
    expect(plan.fixability).toBe('user');
  });

  it('classifies branch-not-found BEFORE repo-not-found (ordering)', () => {
    const plan = dispatchRecovery('clone', "Branch 'main' not found in repo");
    expect(plan.category).toBe('clone_branch_not_found');
    expect(plan.category).not.toBe('clone_repo_not_found');
  });

  it('classifies docker daemon error regardless of step', () => {
    const plan = dispatchRecovery('build', 'cannot connect to docker daemon');
    expect(plan.category).toBe('docker_daemon');
    expect(plan.fixability).toBe('report');
  });

  it('classifies dockerfile missing as dockerfile_missing with fixability=agent', () => {
    const plan = dispatchRecovery('dockerfile', new DockerfileNotFoundError('/tmp/repo').message);
    expect(plan.category).toBe('dockerfile_missing');
    expect(plan.fixability).toBe('agent');
  });

  it('classifies TypeScript compile error as compile_error with fixability=user', () => {
    const plan = dispatchRecovery('build', 'error TS2322: Type x is not assignable');
    expect(plan.category).toBe('compile_error');
    expect(plan.fixability).toBe('user');
  });

  it('classifies test failure as test_failure with fixability=user', () => {
    const plan = dispatchRecovery('build', 'tests failed');
    expect(plan.category).toBe('test_failure');
    expect(plan.fixability).toBe('user');
  });

  it('classifies missing env var as env_missing with fixability=agent', () => {
    const plan = dispatchRecovery('build', 'required environment variable DATABASE_URL');
    expect(plan.category).toBe('env_missing');
    expect(plan.fixability).toBe('agent');
  });

  it('classifies generic build failure as build_error with fixability=agent', () => {
    const plan = dispatchRecovery('build', 'some unknown build error');
    expect(plan.category).toBe('build_error');
    expect(plan.fixability).toBe('agent');
  });

  it('detects compile error from buildLog even if not in error string', () => {
    const plan = dispatchRecovery('build', 'build failed', '... error TS1234 ...');
    expect(plan.category).toBe('compile_error');
    expect(plan.fixability).toBe('user');
  });

  it('classifies runtime crash as runtime_crash with fixability=agent', () => {
    const plan = dispatchRecovery('runtime', 'Container crashed after start');
    expect(plan.category).toBe('runtime_crash');
    expect(plan.fixability).toBe('agent');
  });

  it('classifies generic runtime failure as runtime_generic with fixability=agent', () => {
    const plan = dispatchRecovery('runtime', 'something went wrong at runtime');
    expect(plan.category).toBe('runtime_generic');
    expect(plan.fixability).toBe('agent');
  });

  it('classifies unknown step as unknown with fixability=agent', () => {
    const plan = dispatchRecovery('something-else', 'weird error');
    expect(plan.category).toBe('unknown');
    expect(plan.fixability).toBe('agent');
  });

  it('returns English title/description by default', () => {
    const plan = dispatchRecovery(
      'clone',
      new GitAuthError('https://github.com/user/repo').message,
    );
    expect(plan.title).toBe('Git Authentication Failed');
    expect(plan.description).toBe('SSH key or credentials are not configured for this repository.');
  });

  it('returns Korean title/description when locale=ko', () => {
    const plan = dispatchRecovery(
      'clone',
      new GitAuthError('https://github.com/user/repo').message,
      undefined,
      'ko',
    );
    expect(plan.title).toBe('Git 인증 실패');
    expect(plan.description).toBe('이 저장소에 대한 SSH 키 또는 인증 정보가 설정되지 않았습니다.');
  });

  it('covers all 13 recovery categories', () => {
    const categories = new Set([
      dispatchRecovery('clone', new GitAuthError('https://github.com/user/repo').message).category,
      dispatchRecovery('clone', new GitRepoNotFoundError('https://github.com/user/repo').message)
        .category,
      dispatchRecovery(
        'clone',
        new GitBranchNotFoundError('https://github.com/user/repo', 'main').message,
      ).category,
      dispatchRecovery('clone', 'Failed to clone: timeout').category,
      dispatchRecovery('build', 'cannot connect to docker daemon').category,
      dispatchRecovery('dockerfile', new DockerfileNotFoundError('/tmp/repo').message).category,
      dispatchRecovery('build', 'required environment variable DATABASE_URL').category,
      dispatchRecovery('build', 'some unknown build error').category,
      dispatchRecovery('build', 'error TS2322: Type x is not assignable').category,
      dispatchRecovery('build', 'tests failed').category,
      dispatchRecovery('runtime', 'Container crashed after start').category,
      dispatchRecovery('runtime', 'something went wrong at runtime').category,
      dispatchRecovery('something-else', 'weird error').category,
    ]);

    expect(categories).toEqual(
      new Set([
        'clone_auth',
        'clone_repo_not_found',
        'clone_branch_not_found',
        'clone_generic',
        'docker_daemon',
        'dockerfile_missing',
        'env_missing',
        'build_error',
        'compile_error',
        'test_failure',
        'runtime_crash',
        'runtime_generic',
        'unknown',
      ]),
    );
  });

  it('provides non-empty agentGuidance for agent-fixable categories', () => {
    const plans = [
      dispatchRecovery('dockerfile', new DockerfileNotFoundError('/tmp/repo').message),
      dispatchRecovery('build', 'required environment variable DATABASE_URL'),
      dispatchRecovery('build', 'some unknown build error'),
      dispatchRecovery('runtime', 'Container crashed after start'),
      dispatchRecovery('runtime', 'something went wrong at runtime'),
      dispatchRecovery('something-else', 'weird error'),
    ];

    for (const plan of plans) {
      expect(plan.fixability).toBe('agent');
      expect(plan.agentGuidance.trim().length).toBeGreaterThan(0);
    }
  });

  it('provides empty agentGuidance for user-fixable categories', () => {
    const plans = [
      dispatchRecovery('clone', new GitAuthError('https://github.com/user/repo').message),
      dispatchRecovery('clone', new GitRepoNotFoundError('https://github.com/user/repo').message),
      dispatchRecovery(
        'clone',
        new GitBranchNotFoundError('https://github.com/user/repo', 'main').message,
      ),
      dispatchRecovery('clone', 'Failed to clone: timeout'),
      dispatchRecovery('build', 'error TS2322: Type x is not assignable'),
      dispatchRecovery('build', 'tests failed'),
    ];

    for (const plan of plans) {
      expect(plan.fixability).toBe('user');
      expect(plan.agentGuidance).toBe('');
    }
  });

  it('provides non-empty userSteps for user-fixable categories', () => {
    const plans = [
      dispatchRecovery('clone', new GitAuthError('https://github.com/user/repo').message),
      dispatchRecovery('clone', new GitRepoNotFoundError('https://github.com/user/repo').message),
      dispatchRecovery(
        'clone',
        new GitBranchNotFoundError('https://github.com/user/repo', 'main').message,
      ),
      dispatchRecovery('clone', 'Failed to clone: timeout'),
      dispatchRecovery('build', 'error TS2322: Type x is not assignable'),
      dispatchRecovery('build', 'tests failed'),
    ];

    for (const plan of plans) {
      expect(plan.fixability).toBe('user');
      expect(plan.userSteps.length).toBeGreaterThan(0);
    }
  });

  it('provides empty userSteps for agent-fixable categories', () => {
    const plans = [
      dispatchRecovery('dockerfile', new DockerfileNotFoundError('/tmp/repo').message),
      dispatchRecovery('build', 'required environment variable DATABASE_URL'),
      dispatchRecovery('build', 'some unknown build error'),
      dispatchRecovery('runtime', 'Container crashed after start'),
      dispatchRecovery('runtime', 'something went wrong at runtime'),
      dispatchRecovery('something-else', 'weird error'),
    ];

    for (const plan of plans) {
      expect(plan.fixability).toBe('agent');
      expect(plan.userSteps).toEqual([]);
    }
  });

  it('provides non-empty allowedTools for agent-fixable categories', () => {
    const plans = [
      dispatchRecovery('dockerfile', new DockerfileNotFoundError('/tmp/repo').message),
      dispatchRecovery('build', 'required environment variable DATABASE_URL'),
      dispatchRecovery('build', 'some unknown build error'),
      dispatchRecovery('runtime', 'Container crashed after start'),
      dispatchRecovery('runtime', 'something went wrong at runtime'),
      dispatchRecovery('something-else', 'weird error'),
    ];

    for (const plan of plans) {
      expect(plan.fixability).toBe('agent');
      expect(plan.allowedTools.length).toBeGreaterThan(0);
    }
  });

  it('provides empty allowedTools for user-fixable categories', () => {
    const plans = [
      dispatchRecovery('clone', new GitAuthError('https://github.com/user/repo').message),
      dispatchRecovery('clone', new GitRepoNotFoundError('https://github.com/user/repo').message),
      dispatchRecovery(
        'clone',
        new GitBranchNotFoundError('https://github.com/user/repo', 'main').message,
      ),
      dispatchRecovery('clone', 'Failed to clone: timeout'),
      dispatchRecovery('build', 'error TS2322: Type x is not assignable'),
      dispatchRecovery('build', 'tests failed'),
    ];

    for (const plan of plans) {
      expect(plan.fixability).toBe('user');
      expect(plan.allowedTools).toEqual([]);
    }
  });

  // The Git Providers settings page lives at `/settings/git-providers`
  // in v0.1 (`web/src/App.tsx` route mount; `Sidebar.tsx` Settings nav
  // entry). The legacy `/settings/git` actionUrl predated PR #216 and
  // would dead-end against the catch-all `*` redirect to `/home` in
  // v0.1. Pin the canonical path so a future rename surfaces a test
  // failure rather than a silent live-link regression.
  it('routes git-related recovery actionUrls to /settings/git-providers (v0.1 IA)', () => {
    const cases = [
      // clone_auth — SSH key / credentials missing
      dispatchRecovery('clone', new GitAuthError('https://github.com/user/repo').message),
      // clone_repo_not_found — private repo or wrong URL
      dispatchRecovery('clone', new GitRepoNotFoundError('https://github.com/user/repo').message),
      // clone_generic — fallback bucket
      dispatchRecovery('clone', 'Failed to clone: timeout'),
    ];

    for (const plan of cases) {
      const gitActionUrls = plan.userSteps
        .map((step) => step.actionUrl)
        .filter((url): url is string => typeof url === 'string');
      // Every git-related step that surfaces a clickable link should
      // point at the canonical v0.1 surface.
      expect(gitActionUrls.length).toBeGreaterThan(0);
      for (const url of gitActionUrls) {
        expect(url).toBe('/settings/git-providers');
      }
    }
  });
});
