# Plan: Modular Docker Refactor with Transport Abstraction

**Created:** 2026-04-11
**Status:** DRAFT
**Scope:** Pure refactoring -- zero behavior changes, zero caller changes
**Estimated complexity:** HIGH (1506 lines, 47 methods, 30+ caller files, 30+ test files)

---

## Context

`src/pipeline/docker.ts` is a 1506-line monolithic file containing a single `Docker` class with 47 public methods, standalone utility functions, and 9 exported interfaces/types. Every Docker operation in the system routes through this one file.

The goal is to split it into domain-specific modules using Composition + Facade, with a lightweight shared context object for dependency injection, and split the test file accordingly -- all while maintaining zero-change compatibility for all 30+ caller files and 30+ test files.

## Critical Architectural Decision: Import Path Compatibility

**Problem:** The project uses `"module": "NodeNext"` + `"type": "module"`. With ESM + NodeNext, `import from './docker.js'` resolves to the **literal file** `docker.ts` -- it does NOT resolve to `docker/index.ts`. This means we cannot simply replace `docker.ts` with a `docker/` directory.

**Solution:** Keep `src/pipeline/docker.ts` as a thin barrel re-export file (same pattern as existing `deploy.ts` which re-exports from `deploy-core.ts`). Place all domain modules in `src/pipeline/docker/`. This ensures every `import { Docker } from './docker.js'` and `import { getDockerHostType } from '../../pipeline/docker.js'` continues to resolve correctly with zero import path changes.

## Architecture Target

```
src/pipeline/
├── docker.ts              <-- KEPT as barrel re-export (replaces 1506 lines with ~25 lines)
├── docker/
│   ├── facade.ts          <-- Docker class (facade, delegates to domain ops)
│   ├── context.ts         <-- DockerContext type + createDockerContext() factory
│   ├── container.ts       <-- ContainerOps class (16 methods, includes waitForHealthy)
│   ├── image.ts           <-- ImageOps class (9 methods)
│   ├── network.ts         <-- NetworkOps class (7 methods)
│   ├── volume.ts          <-- VolumeOps class (4 methods)
│   ├── exec.ts            <-- ExecOps class (3 methods)
│   ├── stream.ts          <-- StreamOps class (3 methods: getLogs, getLogStream, getEventStream)
│   ├── infra.ts           <-- InfraOps class (3 methods: ping, ensureRunning, getDiskUsage)
│   ├── types.ts           <-- All exported interfaces/types
│   └── helpers.ts         <-- Error matchers + standalone functions + diagnostics (status, isUserInDockerGroup, resolveDockerSocket, etc.)

test/pipeline/
├── docker-methods.test.ts <-- REMOVED after split
├── docker-sandbox.test.ts <-- KEPT as-is (imports from docker.ts barrel unchanged)
├── docker/
│   ├── container.test.ts
│   ├── image.test.ts
│   ├── network.test.ts
│   ├── volume.test.ts
│   ├── exec.test.ts
│   ├── stream.test.ts
│   └── infra.test.ts
```

## Work Objectives

1. Zero caller changes -- all 30+ source files and 30+ test files importing from `docker.js` continue to work
2. Shared context -- `DockerContext` type (`{ client, networkName }`) injected into all ops classes via constructor
3. Domain isolation -- each ops class is independently testable and has a single responsibility
4. All 838 lines of existing tests pass without modification (test imports unchanged)
5. New domain test files provide same coverage as the monolithic test file

## Guardrails

### Must Have

- `src/pipeline/docker.ts` barrel re-exports every symbol currently exported (Docker class, all types, getDockerHostType, resolveDockerSocket)
- Each domain ops class receives `DockerContext` (containing `client: Dockerode` and `networkName: string`) via constructor injection
- The Docker facade class constructor signature stays identical: `constructor(socketPath?: string, networkName?: string)`
- Private helpers (`writeSecretFiles`, `getProjectVolumeBinds`, `resolveExtraHosts`) extracted to `helpers.ts` as standalone functions taking explicit parameters
- `activeBuilds` Map stays in ImageOps (only buildImage and cancelBuild use it)
- Each ops class creates its own module logger (e.g. `docker:container`, `docker:image`)
- All existing tests pass with zero modifications

### Must NOT Have

- No import path changes in any caller file
- No new npm dependencies
- No behavior changes to any method
- No changes to the `test/helpers/docker-mocks.ts` harness interface

---

## Task Flow

### Wave 1: Foundation (sequential -- types, helpers, transport)

#### Task 1: Extract types, helpers, and context factory

**Files to create:**

- `src/pipeline/docker/types.ts`
- `src/pipeline/docker/helpers.ts`
- `src/pipeline/docker/context.ts`

**Details:**

`docker/types.ts` contains:

- `DockerStatus` type
- `SecretFileMount` interface
- `RunContainerOptions` interface
- `RunComposeServiceOptions` interface
- `ContainerInfo` interface
- `PortInfo` interface
- `AllContainerInfo` interface
- `BuildImageOptions` interface
- `BuildComposeServiceOptions` interface
- `WaitForHealthyResult` interface

`docker/helpers.ts` contains:

**Error matchers (module-scoped → exported):**

- `isAlreadyConnectedError(msg: string): boolean`
- `isContainerNotRunning(msg: string): boolean`
- `isContainerAlreadyRunning(msg: string): boolean`
- `isNotConnectedToNetwork(msg: string): boolean`

**Stream utilities:**

- `stripDockerStreamHeaders(buffer: Buffer): string` (used by StreamOps.getLogs only)

**Extracted from Docker class (private → standalone with explicit params):**

- `writeSecretFiles(containerName: string, files: SecretFileMount[]): string[]`
- `getProjectVolumeBinds(client: Dockerode, projectName: string): Promise<string[]>` — takes `client` param explicitly
- `resolveExtraHosts(client: Dockerode, networkName: string): Promise<string[]>` — takes `client` + `networkName` params explicitly
- `cleanupSecretFiles(containerName: string): void`

**Diagnostics (standalone, no Dockerode client needed):**

- `resolveDockerSocket(): string | undefined` (currently exported from docker.ts)
- `getDockerHostType(): 'local' | 'remote'` (currently exported from docker.ts)
- `isUserInDockerGroup(): boolean` (currently module-scoped)
- `dockerStatus(client: Dockerode): Promise<DockerStatus>` — extracted from `Docker.status()`. Takes `client` as param. Contains the `execSync` shell-out logic for install/permission checks.

> **Why `status()` moves to helpers:** This method shells out to `docker --version`, `sg docker`, `docker info` etc. It checks Docker _installation and permissions_ — a diagnostic concern, not an operational one. The facade delegates to `dockerStatus(this.ctx.client)`.

`docker/context.ts` contains:

```typescript
import type Dockerode from 'dockerode';

/** Shared context injected into all domain ops classes. */
export interface DockerContext {
  readonly client: Dockerode;
  readonly networkName: string;
}

/**
 * Create a DockerContext by initializing Dockerode.
 * Encapsulates: SSH transport stub, createRequire loading, socket resolution.
 * This is the ONLY place that instantiates Dockerode.
 */
export function createDockerContext(socketPath?: string, networkName?: string): DockerContext {
  // Move current Docker constructor logic here:
  // - SSH transport stub via require.cache
  // - Dockerode class loading via createRequire
  // - networkName resolution from getPolicy('production').networkName
  // - socketPath resolution via resolveDockerSocket()
  // Returns { client, networkName }
}
```

> **Why not a Transport abstraction:** A `DockerTransport` interface with `client: Dockerode` doesn't actually abstract anything — a future remote transport wouldn't expose a Dockerode instance. A proper transport abstraction would require operation-level interfaces (50+ methods), which is out of scope. `DockerContext` is honest about what it is: a shared config/connection object for DI. If remote Docker support is needed later, the abstraction can be introduced at that point (YAGNI).

**Acceptance Criteria:**

- [ ] `docker/types.ts` exports all 10 types/interfaces
- [ ] `docker/helpers.ts` exports all error matchers, standalone functions, and `dockerStatus()`
- [ ] `docker/context.ts` exports `DockerContext` type and `createDockerContext()` factory
- [ ] `createDockerContext()` produces identical `client` and `networkName` as current `Docker` constructor
- [ ] `dockerStatus()` produces identical behavior to current `Docker.status()`
- [ ] TypeScript compiles with no errors
- [ ] No files outside `src/pipeline/docker/` are modified

**Commit:** `refactor(pipeline): extract docker types, helpers, and context factory`

---

### Wave 2: Domain ops classes (parallelizable)

#### Task 2: Create domain ops classes

**Files to create (all in `src/pipeline/docker/`):**

- `container.ts` -- `ContainerOps` class
- `image.ts` -- `ImageOps` class
- `network.ts` -- `NetworkOps` class
- `volume.ts` -- `VolumeOps` class
- `exec.ts` -- `ExecOps` class
- `stream.ts` -- `StreamOps` class
- `infra.ts` -- `InfraOps` class

**Pattern for each ops class:**

```typescript
import type { DockerContext } from './context.js';
import { createModuleLogger } from '../../lib/logger.js';
const log = createModuleLogger('docker:container'); // domain-specific logger
// + domain-specific type/helper imports

export class ContainerOps {
  constructor(
    private readonly ctx: DockerContext,
    private readonly deps: {
      ensureSharedNetworkAttachment: (id: string, alias: string) => Promise<void>;
    },
  ) {}
  // Use this.ctx.client instead of this.client
  // Use this.ctx.networkName instead of this.networkName
}
```

**Method assignment per class:**

| Class          | Methods                                                                                                                                                                                                                                                                                              | Count |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `ContainerOps` | runContainer, runComposeService, runInfraContainer, runServiceContainer, stopContainer, startContainer, removeContainer, safeRemoveContainer, restartContainer, renameContainer, waitForContainer, inspectContainer, getContainerStats, listManagedContainers, listAllContainers, **waitForHealthy** | 16    |
| `ImageOps`     | buildImage, buildComposeService, cancelBuild, pullImage, inspectImage, removeImage, tagImage, getImageExposedPort, listDanglingImages (owns `activeBuilds` Map)                                                                                                                                      | 9     |
| `NetworkOps`   | ensureSharedNetworkAttachment, connectContainerToNetwork, disconnectContainerFromNetwork, getNetworkInfo, ensureProjectNetwork, removeProjectNetwork, ensureNetwork                                                                                                                                  | 7     |
| `VolumeOps`    | inspectVolume, listVolumes, createVolume, removeVolume                                                                                                                                                                                                                                               | 4     |
| `ExecOps`      | execSimple, execStream, execTerminal                                                                                                                                                                                                                                                                 | 3     |
| `StreamOps`    | getLogs, getLogStream, getEventStream                                                                                                                                                                                                                                                                | 3     |
| `InfraOps`     | ping, ensureRunning, getDiskUsage                                                                                                                                                                                                                                                                    | 3     |
| _helpers.ts_   | dockerStatus (standalone function), getNetworkName (facade getter)                                                                                                                                                                                                                                   | —     |

> **`waitForHealthy` → ContainerOps:** This method polls `container.inspect()` checking `State.Restarting`, `State.Running`, `State.Health`. It's a container lifecycle concern (run → verify healthy), not a streaming concern. `StreamOps` handles data streams (logs, events).

> **`status()` → helpers.ts `dockerStatus()`:** This method shells out to `docker --version`, `sg docker`, `docker info` to check installation and permissions. It's a diagnostic function, not an operational method. Keeping it in InfraOps would mix shell-out diagnostics with Dockerode API operations.

> **`getNetworkName()` → facade getter:** One-liner returning `this.ctx.networkName`. No ops class needed — facade exposes directly.

**Import dependency manifest per ops class:**

| Ops Class      | From `helpers.ts`                                                                                                                | From `types.ts`                                                                                      | From `../../errors.js`                        | From other modules                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContainerOps` | writeSecretFiles, getProjectVolumeBinds, resolveExtraHosts, isContainerNotRunning, isContainerAlreadyRunning, cleanupSecretFiles | RunContainerOptions, RunComposeServiceOptions, ContainerInfo, AllContainerInfo, WaitForHealthyResult | ContainerNotFoundError, isDockerNotFoundError | `../../config/index.js` (SHARED_NETWORK_NAME, DOCKER_LABELS, getDataDir), `./helpers.js` (containerName, stripContainerPrefix)¹, `../../lib/sleep.js` (sleep) |
| `ImageOps`     | —                                                                                                                                | BuildImageOptions, BuildComposeServiceOptions                                                        | DockerBuildError                              | `node:stream` (Readable)                                                                                                                                      |
| `NetworkOps`   | isAlreadyConnectedError, isNotConnectedToNetwork                                                                                 | —                                                                                                    | isDockerNotFoundError                         | `../../config/index.js` (SHARED_NETWORK_NAME), `./helpers.js` (containerName)¹                                                                                |
| `StreamOps`    | stripDockerStreamHeaders                                                                                                         | —                                                                                                    | ContainerNotFoundError, isDockerNotFoundError | —                                                                                                                                                             |
| `ExecOps`      | —                                                                                                                                | —                                                                                                    | —                                             | `node:stream` (PassThrough)                                                                                                                                   |
| `VolumeOps`    | —                                                                                                                                | —                                                                                                    | isDockerNotFoundError                         | `../../config/index.js` (DOCKER_LABELS)                                                                                                                       |
| `InfraOps`     | —                                                                                                                                | —                                                                                                    | DockerNotRunningError                         | —                                                                                                                                                             |

¹ `containerName` and `stripContainerPrefix` are from `../../pipeline/helpers.js` (existing file, NOT `docker/helpers.ts`). Keep this import path — do not move these functions.

**Cross-domain dependencies (exhaustive):**

1. **ContainerOps → NetworkOps: `ensureSharedNetworkAttachment`**
   - Used by: `runContainer()`, `runComposeService()` (both call after container.start when networkMode ≠ SHARED_NETWORK_NAME)
   - Resolution: **Callback injection** via constructor `deps.ensureSharedNetworkAttachment`

2. **ContainerOps → NetworkOps: additional network connect in `runComposeService()`**
   - Lines 628-646: `this.client.getNetwork(networkName).connect()` for `opts.networks?.slice(1)`
   - Includes cleanup logic (stop + remove on failure)
   - Resolution: **Callback injection** `deps.connectToNetwork: (containerId: string, networkName: string) => Promise<void>`. ContainerOps handles the cleanup orchestration (stop/remove on failure) since that's container lifecycle.

3. **ContainerOps: private helpers → standalone functions**
   - `writeSecretFiles`, `getProjectVolumeBinds`, `resolveExtraHosts` → imported from `./helpers.js`
   - `getProjectVolumeBinds(client, projectName)` and `resolveExtraHosts(client, networkName)` take explicit params

4. **StreamOps.getLogs() → `stripDockerStreamHeaders()`**
   - Resolution: Direct import from `./helpers.js` (no cross-domain issue)

**Acceptance Criteria:**

- [ ] Each ops class compiles independently
- [ ] Each ops class constructor takes `DockerContext` (+ any cross-domain callbacks)
- [ ] No ops class imports from another ops class (no circular dependencies)
- [ ] Cross-domain dependencies resolved via constructor-injected callbacks only
- [ ] `activeBuilds` Map is private to `ImageOps`
- [ ] Each ops class has its own logger: `createModuleLogger('docker:<domain>')`
- [ ] All imports verified against the dependency manifest above

**Commit:** `refactor(pipeline): create domain ops classes for docker module`

---

### Wave 3: Facade + barrel (sequential)

#### Task 3: Create facade and barrel re-export

**Files to create:**

- `src/pipeline/docker/facade.ts`

**Files to modify:**

- `src/pipeline/docker.ts` (replace 1506-line monolith with ~25-line barrel)

**`docker/facade.ts`:**

```typescript
import { createDockerContext, type DockerContext } from './context.js';
import { ContainerOps } from './container.js';
import { ImageOps } from './image.js';
import { NetworkOps } from './network.js';
import { VolumeOps } from './volume.js';
import { ExecOps } from './exec.js';
import { StreamOps } from './stream.js';
import { InfraOps } from './infra.js';
import { cleanupSecretFiles, dockerStatus } from './helpers.js';
import type { DockerStatus } from './types.js';

export class Docker {
  private readonly ctx: DockerContext;
  private readonly containerOps: ContainerOps;
  private readonly imageOps: ImageOps;
  private readonly networkOps: NetworkOps;
  private readonly volumeOps: VolumeOps;
  private readonly execOps: ExecOps;
  private readonly streamOps: StreamOps;
  private readonly infraOps: InfraOps;

  constructor(socketPath?: string, networkName?: string) {
    this.ctx = createDockerContext(socketPath, networkName);
    this.networkOps = new NetworkOps(this.ctx);
    this.containerOps = new ContainerOps(this.ctx, {
      ensureSharedNetworkAttachment: (id, alias) =>
        this.networkOps.ensureSharedNetworkAttachment(id, alias),
      connectToNetwork: (containerId, networkName) =>
        this.networkOps.connectContainerToNetwork(containerId, networkName),
    });
    this.imageOps = new ImageOps(this.ctx);
    this.volumeOps = new VolumeOps(this.ctx);
    this.execOps = new ExecOps(this.ctx);
    this.streamOps = new StreamOps(this.ctx);
    this.infraOps = new InfraOps(this.ctx);
  }

  // --- Delegated methods (one-liner each) ---
  // Container (16): runContainer, runComposeService, runInfraContainer, runServiceContainer,
  //   stopContainer, startContainer, removeContainer, safeRemoveContainer, restartContainer,
  //   renameContainer, waitForContainer, inspectContainer, getContainerStats,
  //   listManagedContainers, listAllContainers, waitForHealthy
  // Image (9): buildImage, buildComposeService, cancelBuild, pullImage, inspectImage,
  //   removeImage, tagImage, getImageExposedPort, listDanglingImages
  // Network (7): ensureSharedNetworkAttachment, connectContainerToNetwork,
  //   disconnectContainerFromNetwork, getNetworkInfo, ensureProjectNetwork,
  //   removeProjectNetwork, ensureNetwork
  // Volume (4): inspectVolume, listVolumes, createVolume, removeVolume
  // Exec (3): execSimple, execStream, execTerminal
  // Stream (3): getLogs, getLogStream, getEventStream
  // Infra (3): ping, ensureRunning, getDiskUsage

  // --- Standalone helpers delegated at facade level ---
  async status(): Promise<DockerStatus> {
    return dockerStatus(this.ctx.client);
  }
  cleanupSecretFiles(name: string): void {
    cleanupSecretFiles(name);
  }
  getNetworkName(): string {
    return this.ctx.networkName;
  }
}
```

> **Facade boilerplate note:** 45 one-liner delegations ≈ 150 lines of pure boilerplate. This is an accepted cost — ESM doesn't support `Proxy`-based delegation with type safety. New method additions require 3 edits: ops class + facade + barrel (if new type). Document this in onboarding.

**`docker.ts` barrel (replaces entire monolithic file):**

```typescript
// Barrel re-export -- preserves all existing import paths.
// Every `import { Docker } from './docker.js'` resolves to this file.
export { Docker } from './docker/facade.js';
export type {
  DockerStatus,
  SecretFileMount,
  RunContainerOptions,
  RunComposeServiceOptions,
  ContainerInfo,
  PortInfo,
  AllContainerInfo,
  BuildImageOptions,
  BuildComposeServiceOptions,
  WaitForHealthyResult,
} from './docker/types.js';
export { resolveDockerSocket, getDockerHostType } from './docker/helpers.js';
```

**Acceptance Criteria:**

- [ ] `docker.ts` barrel is under 30 lines
- [ ] `docker/facade.ts` delegates all 45 methods + `status()` + `cleanupSecretFiles()` + `getNetworkName()`
- [ ] Every symbol previously exported from `docker.ts` is still exported (types + values)
- [ ] `tsc --noEmit` passes with zero errors
- [ ] No files outside `src/pipeline/docker.ts` and `src/pipeline/docker/` are modified
- [ ] All 30+ source caller files compile without changes
- [ ] All 30+ test files compile without changes

**Commit:** `refactor(pipeline): replace docker monolith with facade + barrel re-export`

---

### Wave 4: Verification (sequential, critical gate)

#### Task 4: Full test suite verification

**Actions:**

1. Run `npx vitest run test/pipeline/docker-methods.test.ts test/pipeline/docker-sandbox.test.ts` -- existing docker tests
2. Run `npx vitest run` -- full test suite to catch any caller breakage
3. Run `npx tsc --noEmit` -- full type check
4. Verify no import path in any file outside `src/pipeline/docker/` was changed

**Acceptance Criteria:**

- [ ] All existing docker tests pass (838 lines in docker-methods.test.ts, 225 lines in docker-sandbox.test.ts)
- [ ] Full test suite passes (no regressions in 30+ files importing Docker)
- [ ] TypeScript compilation succeeds with zero errors
- [ ] `git diff --name-only` confirms only `src/pipeline/docker.ts` and `src/pipeline/docker/*` and `test/pipeline/docker/*` were touched

**Commit:** none (verification gate only)

---

### Wave 5: Test split (parallelizable)

#### Task 5: Split test file into domain test files

**Files to create (in `test/pipeline/docker/`):**

- `container.test.ts`
- `image.test.ts`
- `network.test.ts`
- `volume.test.ts`
- `exec.test.ts`
- `stream.test.ts`
- `infra.test.ts`

**Strategy:**

- **All test files import via the barrel** (`../../../src/pipeline/docker.js`) — NOT direct ops class imports. This preserves the existing mock pattern and ensures tests validate the full facade → ops delegation path. Direct ops class unit tests are a possible future enhancement but out of scope.
- Each test file uses the same mock pattern as `docker-methods.test.ts` (mock `dockerode` via `require.cache`)
- Tests are organized by domain, matching the ops class boundaries
- Test descriptions preserved exactly from `docker-methods.test.ts`
- After all domain test files are verified, delete `test/pipeline/docker-methods.test.ts`
- `test/pipeline/docker-sandbox.test.ts` remains unchanged (different mock pattern, different concerns)

**Test distribution from existing `docker-methods.test.ts`:**

- `container.test.ts`: inspectContainer, stopContainer, startContainer, removeContainer, safeRemoveContainer, restartContainer, renameContainer, waitForContainer, getContainerStats, listManagedContainers, listAllContainers, runContainer, runComposeService, runInfraContainer, runServiceContainer, **waitForHealthy**
- `image.test.ts`: buildImage, buildComposeService, cancelBuild, pullImage, inspectImage, removeImage, tagImage, getImageExposedPort, listDanglingImages
- `network.test.ts`: ensureSharedNetworkAttachment, connectContainerToNetwork, disconnectContainerFromNetwork, getNetworkInfo, ensureProjectNetwork, removeProjectNetwork, ensureNetwork
- `volume.test.ts`: inspectVolume, listVolumes, createVolume, removeVolume
- `exec.test.ts`: execSimple, execStream, execTerminal
- `stream.test.ts`: getLogs, getLogStream, getEventStream
- `infra.test.ts`: ping, **status**, ensureRunning, getDiskUsage, getNetworkName

**Acceptance Criteria:**

- [ ] All domain test files pass individually
- [ ] Combined test count matches original `docker-methods.test.ts` test count
- [ ] `test/pipeline/docker-methods.test.ts` is deleted
- [ ] `test/pipeline/docker-sandbox.test.ts` still passes unchanged
- [ ] Full test suite passes

**Commit:** `test(pipeline): split docker tests into domain-specific files`

---

### Wave 6: Final verification

#### Task 6: Final cleanup and full verification

**Actions:**

1. Run full test suite
2. Run `tsc --noEmit`
3. Verify git diff shows only expected files changed
4. Verify line counts: facade.ts should be ~150-200 lines, each ops class 60-500 lines, barrel ~25 lines
5. Verify no orphaned imports or dead code

**Acceptance Criteria:**

- [ ] Full test suite green
- [ ] TypeScript compiles clean
- [ ] No files outside the docker module boundary were modified except `src/pipeline/docker.ts` (barrel)
- [ ] Total code across all docker/ files approximately matches original 1506 lines (no significant bloat from delegation overhead)

**Commit:** `refactor(pipeline): docker module cleanup and verification`

---

## Success Criteria

1. **Zero caller changes** -- `git diff` shows no modifications to any file outside `src/pipeline/docker.ts` and `src/pipeline/docker/*` and `test/pipeline/docker/*`
2. **Full backward compatibility** -- all 30+ source callers and 30+ test files compile and run without changes
3. **Clean DI** -- `DockerContext` injected into all ops classes; Dockerode instantiation isolated in `createDockerContext()`
4. **Domain isolation** -- each ops class depends only on context + helpers, no cross-domain imports (callbacks for cross-domain calls)
5. **All tests pass** -- existing test suite green, new domain test files provide equivalent coverage
6. **Clean architecture** -- each file under 500 lines, single responsibility, no circular dependencies

## Risks and Mitigations

| Risk                                                                                                          | Impact                      | Mitigation                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESM import path resolution breaks                                                                             | HIGH -- all callers fail    | Keep `docker.ts` as barrel (verified: `deploy.ts` uses same pattern)                                                                                                        |
| Mock pattern in tests breaks with modular structure                                                           | MEDIUM -- test failures     | Tests import via barrel (`docker.js`), not internal modules; mock pattern unchanged                                                                                         |
| Cross-domain method calls (runContainer → ensureSharedNetworkAttachment, runComposeService → network.connect) | MEDIUM -- circular deps     | Constructor-injected callbacks for both. ContainerOps handles cleanup orchestration.                                                                                        |
| Private helpers need Dockerode client reference                                                               | LOW -- design friction      | Extract to standalone functions taking `client` as explicit parameter                                                                                                       |
| `createRequire` Dockerode loading is fragile                                                                  | LOW -- existing risk        | Encapsulate entirely in `createDockerContext()`, not spread across modules                                                                                                  |
| Facade boilerplate overhead (~150 lines of one-liner delegations)                                             | LOW -- maintenance cost     | Accepted cost. ESM doesn't support Proxy-based delegation with type safety. New methods require 3 edits: ops class + facade + barrel (if new type). Document in onboarding. |
| `runComposeService` mixed container+network cleanup logic                                                     | LOW -- domain boundary blur | Network connection is injected as callback; cleanup (stop/remove on failure) stays in ContainerOps as container lifecycle                                                   |

## Resolved Decisions

| Question                                              | Decision                                       | Rationale                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ContainerOps: callback vs direct NetworkOps reference | **Callback injection**                         | Avoids circular deps, explicit DI, TypeScript-friendly                                                                              |
| `cleanupSecretFiles`: facade or helpers-only          | **Facade delegates to helpers function**       | Callers use `docker.cleanupSecretFiles()` — must preserve API                                                                       |
| `stripDockerStreamHeaders`: export or internal        | **helpers.ts, imported by StreamOps only**     | No external callers — internal utility                                                                                              |
| PR strategy: single vs stacked                        | **Single PR**                                  | Pure refactoring, wave-aligned commits for reviewability                                                                            |
| Transport abstraction depth                           | **DockerContext (data holder), not interface** | YAGNI — `DockerTransport` with `client: Dockerode` doesn't abstract remote. Real abstraction = 50+ operation methods, out of scope. |
| `waitForHealthy` placement                            | **ContainerOps**                               | Polls `container.inspect()` for State — container lifecycle, not streaming                                                          |
| `status()` placement                                  | **helpers.ts standalone `dockerStatus()`**     | Shells out to CLI — diagnostic, not operational                                                                                     |
| Test import strategy                                  | **Barrel import only**                         | Preserves existing mock pattern, validates full delegation chain                                                                    |

## Open Questions

See `.omc/plans/open-questions.md` for remaining tracked items (non-docker items only).
