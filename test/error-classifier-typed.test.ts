/**
 * Codex HIGH-3 fix — typed-error → ErrorClass mapping.
 *
 * Asserts that first-party typed errors from `src/errors.ts` are
 * classified by `classifyByErrorName` BEFORE the message-regex
 * fallback. Without this layer the classifier collapsed almost every
 * production failure to `RUNTIME_CRASH` because the typed error's
 * human-readable `.message` rarely matches a hand-crafted regex.
 *
 * Co-located in `test/` to match this repo's vitest config
 * (`test/**\/*.test.{ts,tsx}`).
 */
import { describe, expect, it } from 'vitest';

import {
  CloudflareNotFoundError,
  CloudflaredNotFoundError,
  ConfigNotFoundError,
  ContainerNotFoundError,
  DockerBuildError,
  DockerNotRunningError,
  DockerfileNotFoundError,
  GitAuthError,
  GitBranchNotFoundError,
  GitCloneError,
  GitRepoNotFoundError,
  ImageNotFoundError,
  ImagePullError,
  LLMConcurrencyExceededError,
  LLMNotConfiguredError,
  LLMProviderError,
  LLMUnreachableError,
  MissingImageUrlError,
  NetworkNotFoundError,
  PortExhaustedError,
  PreflightCheckError,
  RepoPersistenceError,
  ServiceConfigError,
  ServiceContainerStateError,
  ServiceInUseError,
  ServiceOperationError,
  ServiceOperationUnsupportedError,
  TunnelStartError,
  UnsafeRepoUrlError,
  VolumeNotFoundError,
} from '../src/errors.js';
import {
  classifyByErrorName,
  classifyDeployError,
} from '../src/pipeline/error-classifier.js';

describe('classifyByErrorName — typed first-party errors win before regex', () => {
  it('DockerNotRunningError → DOCKER_DAEMON_UNREACHABLE', () => {
    const err = new DockerNotRunningError();
    expect(classifyByErrorName(err)).toBe('DOCKER_DAEMON_UNREACHABLE');
    expect(classifyDeployError(err)).toBe('DOCKER_DAEMON_UNREACHABLE');
  });

  it('DockerfileNotFoundError → BUILD_CONTEXT_MISMATCH', () => {
    const err = new DockerfileNotFoundError('/tmp/work/repo');
    expect(classifyByErrorName(err)).toBe('BUILD_CONTEXT_MISMATCH');
    expect(classifyDeployError(err)).toBe('BUILD_CONTEXT_MISMATCH');
  });

  it('DockerBuildError falls through (null) so message regex can refine', () => {
    // Build log mentions BUILD_CONTEXT_MISMATCH-shaped failure — the
    // outer `classifyDeployError` should still pick that up via the
    // message-regex layer rather than misclassifying as INFRA.
    const err = new DockerBuildError(
      'svc:tag',
      'failed to solve: failed to compute cache key: COPY apps/web ./apps/web: not found in build context',
    );
    expect(classifyByErrorName(err)).toBeNull();
  });

  it('PortExhaustedError → PORT_CONFLICT', () => {
    const err = new PortExhaustedError(30000, 30100, 100);
    expect(classifyByErrorName(err)).toBe('PORT_CONFLICT');
    expect(classifyDeployError(err)).toBe('PORT_CONFLICT');
  });

  it('ImagePullError → NETWORK_DEPENDENCY_UNREACHABLE', () => {
    const err = new ImagePullError('pull access denied for private/img');
    expect(classifyByErrorName(err)).toBe('NETWORK_DEPENDENCY_UNREACHABLE');
    expect(classifyDeployError(err)).toBe('NETWORK_DEPENDENCY_UNREACHABLE');
  });

  it.each([
    ['ContainerNotFoundError', new ContainerNotFoundError('abc')],
    ['NetworkNotFoundError', new NetworkNotFoundError('ol-net')],
    ['VolumeNotFoundError', new VolumeNotFoundError('ol-data')],
    ['ImageNotFoundError', new ImageNotFoundError('ol/img:tag')],
    ['MissingImageUrlError', new MissingImageUrlError()],
  ])('%s → INFRA_UNAVAILABLE', (_name, err) => {
    expect(classifyByErrorName(err)).toBe('INFRA_UNAVAILABLE');
    expect(classifyDeployError(err)).toBe('INFRA_UNAVAILABLE');
  });

  it.each([
    ['CloudflareNotFoundError', new CloudflareNotFoundError('zone xyz')],
    ['CloudflaredNotFoundError', new CloudflaredNotFoundError()],
    ['TunnelStartError', new TunnelStartError('failed to bind')],
  ])('%s → INFRA_UNAVAILABLE', (_name, err) => {
    expect(classifyByErrorName(err)).toBe('INFRA_UNAVAILABLE');
    expect(classifyDeployError(err)).toBe('INFRA_UNAVAILABLE');
  });

  it.each([
    ['GitAuthError', new GitAuthError('https://github.com/x/y')],
    ['GitCloneError', new GitCloneError('https://github.com/x/y', 'network down')],
    ['GitRepoNotFoundError', new GitRepoNotFoundError('https://github.com/x/y')],
    ['GitBranchNotFoundError', new GitBranchNotFoundError('https://github.com/x/y', 'feat')],
    ['UnsafeRepoUrlError', new UnsafeRepoUrlError('http://10.0.0.1', 'private network')],
  ])('%s → GIT_ACCESS_DENIED', (_name, err) => {
    expect(classifyByErrorName(err)).toBe('GIT_ACCESS_DENIED');
    expect(classifyDeployError(err)).toBe('GIT_ACCESS_DENIED');
  });

  it.each([
    ['ConfigNotFoundError', new ConfigNotFoundError()],
    ['LLMNotConfiguredError', new LLMNotConfiguredError()],
    ['ServiceConfigError', new ServiceConfigError('bad service config')],
  ])('%s → CONFIG_MISSING', (_name, err) => {
    expect(classifyByErrorName(err)).toBe('CONFIG_MISSING');
    expect(classifyDeployError(err)).toBe('CONFIG_MISSING');
  });

  it.each([
    ['LLMUnreachableError', new LLMUnreachableError('ollama', 'ECONNREFUSED')],
    ['LLMProviderError', new LLMProviderError('anthropic', 'rate limited')],
    ['LLMConcurrencyExceededError', new LLMConcurrencyExceededError(10, 10)],
    ['PreflightCheckError', new PreflightCheckError({
      pass: false,
      checks: {
        portAvailable: { pass: false, detail: 'used' },
        nameAvailable: { pass: true, detail: 'ok' },
        resourceOk: { pass: true, detail: 'ok' },
        proxyReady: { pass: true, detail: 'ok' },
      },
      warnings: [],
    })],
    ['RepoPersistenceError', new RepoPersistenceError('service', 'svc-1')],
    ['ServiceOperationError', new ServiceOperationError('start', 'docker hiccup')],
    ['ServiceOperationUnsupportedError', new ServiceOperationUnsupportedError('createDb', 'redis')],
    ['ServiceContainerStateError', new ServiceContainerStateError('svc-1', 'stopped')],
    ['ServiceInUseError', new ServiceInUseError('shared-pg', [{ id: 'p1', name: 'app' }])],
  ])('%s → INFRA_UNAVAILABLE', (_name, err) => {
    expect(classifyByErrorName(err)).toBe('INFRA_UNAVAILABLE');
    expect(classifyDeployError(err)).toBe('INFRA_UNAVAILABLE');
  });

  it('plain Error falls through to message regex (RUNTIME_CRASH default)', () => {
    expect(classifyByErrorName(new Error('something blew up'))).toBeNull();
    expect(classifyDeployError(new Error('something blew up'))).toBe('RUNTIME_CRASH');
  });

  it('non-object inputs return null (unknown / number / string)', () => {
    expect(classifyByErrorName(undefined)).toBeNull();
    expect(classifyByErrorName(null)).toBeNull();
    expect(classifyByErrorName(42)).toBeNull();
    expect(classifyByErrorName('boom')).toBeNull();
  });

  it('typed-error wins over a misleading message regex match', () => {
    // Construct a typed `DockerNotRunningError` whose message would
    // ALSO match the `RUNTIME_CRASH`-shaped fallback path. The typed
    // layer must run first so we still emit DOCKER_DAEMON_UNREACHABLE.
    const err = new DockerNotRunningError();
    // Smoke: the default `.message` does NOT contain `docker.sock` —
    // proving the regex layer alone wouldn't have caught it.
    expect(/docker\.sock/i.test(err.message)).toBe(false);
    expect(classifyDeployError(err)).toBe('DOCKER_DAEMON_UNREACHABLE');
  });
});
