# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-04-11T00:52:16.669Z

## Original task

You are reviewing a Docker abstraction layer consolidation PR for an OpenLander project. The plan is at .sisyphus/plans/docker-layer-consolidation.md. The core changes are:

1. BUG FIX: Eliminated dual network attachment path in runContainer/runComposeService - previously did createContainer with NetworkingConfig AND post-start connectContainerToSharedNetwork, causing 'network sandbox not found' race. Now: creation-time when shared, post-start ensureSharedNetworkAttachment when non-shared. Removed disconnect→reconnect repair path.

2. safeRemoveContainer: Previously did pre-disconnect loop then remove. Now: force remove first, then poll container.inspect() until 404 (5×200ms). Handles ECONNREFUSED/ENOENT as gone.

3. New methods: inspectContainer, connectContainerToNetwork, restartContainer, execSimple, getNetworkInfo, runInfraContainer.

4. Migrations: service-manager.ts (network connect/disconnect ops), recover.ts (full runContainer migration), traefik.ts (connectContainerToNetwork + runInfraContainer), connectivity-check.ts and service-adapters/shared.ts (execSimple).

5. getClient() deprecated but not removed.

Key files to review: src/pipeline/docker.ts (the diff is the main focus), src/pipeline/recover.ts, src/pipeline/service-manager.ts, src/pipeline/traefik.ts, src/pipeline/deploy/connectivity-check.ts, src/pipeline/service-adapters/shared.ts, test/pipeline/docker-sandbox.test.ts, test/pipeline/docker-methods.test.ts.

Please review for:

- Correctness of the race condition fix (is the polling approach sound? edge cases?)
- safeRemoveContainer: is force-remove-then-poll better than the old disconnect-then-remove? Any risk of orphaned network endpoints?
- execSimple: stream handling correctness (demuxStream + PassThrough pattern)
- Error handling consistency across new methods
- Test coverage gaps
- Any migration regressions (did behavior change unintentionally?)
- The service-manager.ts migration: some createContainer calls were NOT migrated (backup/restore containers) - is the justification sound?
- recover.ts: the env var transformation from string[] to Record - is it safe?

Run: git diff 2504caf..217a28c -- src/pipeline/docker.ts src/pipeline/recover.ts src/pipeline/service-manager.ts src/pipeline/traefik.ts src/pipeline/deploy/connectivity-check.ts src/pipeline/service-adapters/shared.ts test/pipeline/docker-sandbox.test.ts test/pipeline/docker-methods.test.ts

## Final prompt

You are reviewing a Docker abstraction layer consolidation PR for an OpenLander project. The plan is at .sisyphus/plans/docker-layer-consolidation.md. The core changes are:

1. BUG FIX: Eliminated dual network attachment path in runContainer/runComposeService - previously did createContainer with NetworkingConfig AND post-start connectContainerToSharedNetwork, causing 'network sandbox not found' race. Now: creation-time when shared, post-start ensureSharedNetworkAttachment when non-shared. Removed disconnect→reconnect repair path.

2. safeRemoveContainer: Previously did pre-disconnect loop then remove. Now: force remove first, then poll container.inspect() until 404 (5×200ms). Handles ECONNREFUSED/ENOENT as gone.

3. New methods: inspectContainer, connectContainerToNetwork, restartContainer, execSimple, getNetworkInfo, runInfraContainer.

4. Migrations: service-manager.ts (network connect/disconnect ops), recover.ts (full runContainer migration), traefik.ts (connectContainerToNetwork + runInfraContainer), connectivity-check.ts and service-adapters/shared.ts (execSimple).

5. getClient() deprecated but not removed.

Key files to review: src/pipeline/docker.ts (the diff is the main focus), src/pipeline/recover.ts, src/pipeline/service-manager.ts, src/pipeline/traefik.ts, src/pipeline/deploy/connectivity-check.ts, src/pipeline/service-adapters/shared.ts, test/pipeline/docker-sandbox.test.ts, test/pipeline/docker-methods.test.ts.

Please review for:

- Correctness of the race condition fix (is the polling approach sound? edge cases?)
- safeRemoveContainer: is force-remove-then-poll better than the old disconnect-then-remove? Any risk of orphaned network endpoints?
- execSimple: stream handling correctness (demuxStream + PassThrough pattern)
- Error handling consistency across new methods
- Test coverage gaps
- Any migration regressions (did behavior change unintentionally?)
- The service-manager.ts migration: some createContainer calls were NOT migrated (backup/restore containers) - is the justification sound?
- recover.ts: the env var transformation from string[] to Record - is it safe?

Run: git diff 2504caf..217a28c -- src/pipeline/docker.ts src/pipeline/recover.ts src/pipeline/service-manager.ts src/pipeline/traefik.ts src/pipeline/deploy/connectivity-check.ts src/pipeline/service-adapters/shared.ts test/pipeline/docker-sandbox.test.ts test/pipeline/docker-methods.test.ts

## Raw output

```text
**Findings**

1. High: recovered built-in services lose their Docker healthchecks. The old recovery path recreated the container with `template.healthcheck`; the new path routes through `runContainer()`, which has no healthcheck support and only receives `cmd`. That changes MinIO/RabbitMQ recovery behavior in a real way. [recover.ts:156](/home/lee/OpenLander/src/pipeline/recover.ts#L156) [recover.ts:163](/home/lee/OpenLander/src/pipeline/recover.ts#L163) [service-manager.ts:350](/home/lee/OpenLander/src/pipeline/service-manager.ts#L350) [service-manager.ts:437](/home/lee/OpenLander/src/pipeline/service-manager.ts#L437)

2. High: the `recover.ts` env-var transformation is not safe against the format this codebase actually stores. `ServiceManager.create()` persists `opts.envVars` as JSON for an array of `{ key, value }` objects, but recovery now parses `service.env_vars` as `string[]` and only accepts `KEY=VALUE` entries. In the common created-service path, user env vars will be silently dropped during recovery. [service-manager.ts:324](/home/lee/OpenLander/src/pipeline/service-manager.ts#L324) [service-manager.ts:325](/home/lee/OpenLander/src/pipeline/service-manager.ts#L325) [service-manager.ts:497](/home/lee/OpenLander/src/pipeline/service-manager.ts#L497) [recover.ts:147](/home/lee/OpenLander/src/pipeline/recover.ts#L147)

3. Medium: `execInServiceContainer()` regressed timeout behavior when it moved onto `docker.execSimple()`. The old code destroyed the exec stream on timeout, preserved partial output, and cleared the timer. The new `Promise.race` leaves the underlying exec running, returns empty output on timeout, and never clears the timeout on success. That is both a resource-leak risk and a diagnostics regression. [shared.ts:24](/home/lee/OpenLander/src/pipeline/service-adapters/shared.ts#L24) [shared.ts:28](/home/lee/OpenLander/src/pipeline/service-adapters/shared.ts#L28) [shared.ts:44](/home/lee/OpenLander/src/pipeline/service-adapters/shared.ts#L44) [docker.ts:868](/home/lee/OpenLander/src/pipeline/docker.ts#L868)

**Notes**

The core race fix in [docker.ts:432](/home/lee/OpenLander/src/pipeline/docker.ts#L432) and [docker.ts:774](/home/lee/OpenLander/src/pipeline/docker.ts#L774) is directionally sound. Removing the create-time plus post-start dual attach path is the right fix, and force-remove plus bounded polling is better than pre-disconnect plus remove. Residual caveat: the poll only proves `container.inspect()` reaches 404, not that endpoint cleanup is fully visible in network state.

Leaving the backup/restore helpers on raw `createContainer()` looks justified. Those containers are ephemeral `AutoRemove` tar jobs and do not fit the `runContainer()` contract well. [service-manager.ts:643](/home/lee/OpenLander/src/pipeline/service-manager.ts#L643) [service-manager.ts:690](/home/lee/OpenLander/src/pipeline/service-manager.ts#L690)

Coverage is thin around the risky migrations. I’d add tests for recovery preserving service env vars and healthchecks, plus timeout/truncation semantics for `execInServiceContainer()`. The new Docker-focused tests passed: `npx vitest run test/pipeline/docker-sandbox.test.ts test/pipeline/docker-methods.test.ts`.


Reading additional input from stdin...
OpenAI Codex v0.118.0 (research preview)
--------
workdir: /home/lee/OpenLander
model: gpt-5.4
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: none
reasoning summaries: none
session id: 019d7a04-8119-7751-be49-15ab8cbd87e5
--------
user
You are reviewing a Docker abstraction layer consolidation PR for an OpenLander project. The plan is at .sisyphus/plans/docker-layer-consolidation.md. The core changes are:

1. BUG FIX: Eliminated dual network attachment path in runContainer/runComposeService - previously did createContainer with NetworkingConfig AND post-start connectContainerToSharedNetwork, causing 'network sandbox not found' race. Now: creation-time when shared, post-start ensureSharedNetworkAttachment when non-shared. Removed disconnect→reconnect repair path.

2. safeRemoveContainer: Previously did pre-disconnect loop then remove. Now: force remove first, then poll container.inspect() until 404 (5×200ms). Handles ECONNREFUSED/ENOENT as gone.

3. New methods: inspectContainer, connectContainerToNetwork, restartContainer, execSimple, getNetworkInfo, runInfraContainer.

4. Migrations: service-manager.ts (network connect/disconnect ops), recover.ts (full runContainer migration), traefik.ts (connectContainerToNetwork + runInfraContainer), connectivity-check.ts and service-adapters/shared.ts (execSimple).

5. getClient() deprecated but not removed.

Key files to review: src/pipeline/docker.ts (the diff is the main focus), src/pipeline/recover.ts, src/pipeline/service-manager.ts, src/pipeline/traefik.ts, src/pipeline/deploy/connectivity-check.ts, src/pipeline/service-adapters/shared.ts, test/pipeline/docker-sandbox.test.ts, test/pipeline/docker-methods.test.ts.

Please review for:
- Correctness of the race condition fix (is the polling approach sound? edge cases?)
- safeRemoveContainer: is force-remove-then-poll better than the old disconnect-then-remove? Any risk of orphaned network endpoints?
- execSimple: stream handling correctness (demuxStream + PassThrough pattern)
- Error handling consistency across new methods
- Test coverage gaps
- Any migration regressions (did behavior change unintentionally?)
- The service-manager.ts migration: some createContainer calls were NOT migrated (backup/restore containers) - is the justification sound?
- recover.ts: the env var transformation from string[] to Record - is it safe?

Run: git diff 2504caf..217a28c -- src/pipeline/docker.ts src/pipeline/recover.ts src/pipeline/service-manager.ts src/pipeline/traefik.ts src/pipeline/deploy/connectivity-check.ts src/pipeline/service-adapters/shared.ts test/pipeline/docker-sandbox.test.ts test/pipeline/docker-methods.test.ts
codex
Reviewing the consolidation diff and the plan first, then I’ll trace the new Docker flows against the migrated call sites and tests to look for regressions.
exec
/bin/bash -lc 'git diff 2504caf..217a28c -- src/pipeline/docker.ts src/pipeline/recover.ts src/pipeline/service-manager.ts src/pipeline/traefik.ts src/pipeline/deploy/connectivity-check.ts src/pipeline/service-adapters/shared.ts test/pipeline/docker-sandbox.test.ts test/pipeline/docker-methods.test.ts' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/src/pipeline/deploy/connectivity-check.ts b/src/pipeline/deploy/connectivity-check.ts
index dae2638..2c04f12 100644
--- a/src/pipeline/deploy/connectivity-check.ts
+++ b/src/pipeline/deploy/connectivity-check.ts
@@ -1,5 +1,3 @@
-import { PassThrough } from 'node:stream';
-
 import type { Docker } from '../docker.js';

 export interface ConnectivityResult {
@@ -15,13 +13,6 @@ interface EndpointTarget {
   port?: number;
 }

-interface ContainerCommandResult {
-  stdout: string;
-  stderr: string;
-  exitCode: number;
-  startFailed: boolean;
-}
-
 const DEFAULT_PORT_BY_PROTOCOL: Record<string, number> = {
   'http:': 80,
   'https:': 443,
@@ -121,45 +112,13 @@ async function runInContainer(
   docker: Docker,
   containerId: string,
   command: string[],
-): Promise<ContainerCommandResult> {
-  const client = docker.getClient();
-  const container = client.getContainer(containerId);
-
+): Promise<{ stdout: string; stderr: string; exitCode: number; startFailed: boolean }> {
   try {
-    const exec = await container.exec({
-      Cmd: command,
-      AttachStdin: false,
-      AttachStdout: true,
-      AttachStderr: true,
-      Tty: false,
-    });
-
-    const stream = await exec.start({ hijack: false, stdin: false });
-    const stdoutChunks: Buffer[] = [];
-    const stderrChunks: Buffer[] = [];
-    const stdoutStream = new PassThrough();
-    const stderrStream = new PassThrough();
-
-    stdoutStream.on('data', (chunk: Buffer) => {
-      stdoutChunks.push(chunk);
-    });
-    stderrStream.on('data', (chunk: Buffer) => {
-      stderrChunks.push(chunk);
-    });
-
-    client.modem.demuxStream(stream, stdoutStream, stderrStream);
-
-    await new Promise<void>((resolve, reject) => {
-      stream.on('error', reject);
-      stream.on('end', resolve);
-    });
-
-    const info = await exec.inspect();
-    const exitCode = typeof info.ExitCode === 'number' ? info.ExitCode : 1;
+    const result = await docker.execSimple(containerId, command);
     return {
-      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
-      stderr: Buffer.concat(stderrChunks).toString('utf8'),
-      exitCode,
+      stdout: result.stdout,
+      stderr: result.stderr,
+      exitCode: result.exitCode,
       startFailed: false,
     };
   } catch (error) {
diff --git a/src/pipeline/docker.ts b/src/pipeline/docker.ts
index acbe4f0..16dae8a 100644
--- a/src/pipeline/docker.ts
+++ b/src/pipeline/docker.ts
@@ -7,6 +7,7 @@ import { createRequire } from 'node:module';
 import { homedir } from 'node:os';
 import { join } from 'node:path';
 import type { Readable } from 'node:stream';
+import { PassThrough } from 'node:stream';
 import { getDataDir, getPolicy, SHARED_NETWORK_NAME, DOCKER_LABELS } from '../config/index.js';
 import { sleep } from '../lib/sleep.js';
 import { containerName, stripContainerPrefix } from './helpers.js';
@@ -45,6 +46,8 @@ export interface RunContainerOptions {
   secretFiles?: SecretFileMount[];
   /** Docker restart policy (default: on-failure with MaximumRetryCount: 5). */
   restartPolicy?: { Name: string; MaximumRetryCount?: number };
+  /** Additional volume or bind mounts (e.g. `["vol:/data"]`). */
+  extraBinds?: string[];
 }

 export interface RunComposeServiceOptions {
@@ -444,7 +447,7 @@ export class Docker {
           }
         : undefined;
     const volumeBinds = await this.getProjectVolumeBinds(projectName);
-    const binds = [...secretBinds, ...volumeBinds];
+    const binds = [...secretBinds, ...volumeBinds, ...(options.extraBinds ?? [])];

     const container = await this.client.createContainer({
       Image: options.imageTag,
@@ -474,7 +477,10 @@ export class Docker {

     await container.start();

-    await this.connectContainerToSharedNetwork(container.id, projectName);
+    if (networkMode !== SHARED_NETWORK_NAME) {
+      await this.ensureSharedNetworkAttachment(container.id, projectName);
+    }
+
     return container.id;
   }

@@ -487,6 +493,16 @@ export class Docker {
     const volumeBinds = await this.getProjectVolumeBinds(projectName);
     const binds = [...secretBinds, ...volumeBinds];
     const networkMode = opts.network ?? opts.networks?.[0] ?? this.networkName;
+    const networkingConfig =
+      networkMode === SHARED_NETWORK_NAME
+        ? {
+            EndpointsConfig: {
+              [SHARED_NETWORK_NAME]: {
+                Aliases: [projectName],
+              },
+            },
+          }
+        : undefined;

     if (typeof opts.command === 'string' && /[;&|`$(){}]/.test(opts.command)) {
       throw new Error('Command contains disallowed shell metacharacters');
@@ -534,6 +550,7 @@ export class Docker {
       Cmd: command,
       Entrypoint: opts.entrypoint,
       Healthcheck: healthcheck,
+      NetworkingConfig: networkingConfig,
       HostConfig: {
         PortBindings: {
           [`${String(cPort)}/tcp`]: [{ HostPort: String(opts.port) }],
@@ -548,7 +565,9 @@ export class Docker {

     await container.start();

-    await this.connectContainerToSharedNetwork(container.id, projectName);
+    if (networkMode !== SHARED_NETWORK_NAME) {
+      await this.ensureSharedNetworkAttachment(container.id, projectName);
+    }

     const additionalNetworks =
       opts.networks
@@ -577,7 +596,18 @@ export class Docker {
     return container.id;
   }

-  private async connectContainerToSharedNetwork(containerId: string, alias: string): Promise<void> {
+  /**
+   * Create and start an infrastructure container (e.g. Traefik).
+   * Unlike runContainer, this accepts raw Dockerode options for non-project
+   * containers that don't follow the standard port/Traefik-label pattern.
+   */
+  async runInfraContainer(options: Dockerode.ContainerCreateOptions): Promise<string> {
+    const container = await this.client.createContainer(options);
+    await container.start();
+    return container.id;
+  }
+
+  public async ensureSharedNetworkAttachment(containerId: string, alias: string): Promise<void> {
     const network = this.client.getNetwork(SHARED_NETWORK_NAME);

     try {
@@ -587,36 +617,11 @@ export class Docker {
       });
     } catch (error) {
       const msg = error instanceof Error ? error.message : String(error);
-      if (!msg.includes('already exists') && !msg.includes('already connected')) {
-        throw error;
-      }
-
-      const networkInfo = (await network.inspect()) as {
-        Containers?: Record<string, { Aliases?: string[] | null }>;
-      };
-      const containerEndpoint = networkInfo.Containers?.[containerId];
-      const currentAliases: string[] = containerEndpoint?.Aliases ?? [];
-      if (currentAliases.includes(alias)) {
+      if (msg.includes('already exists') || msg.includes('already connected')) {
         return;
       }

-      try {
-        await network.disconnect({ Container: containerId, Force: false });
-      } catch (disconnectError) {
-        const disconnectMsg =
-          disconnectError instanceof Error ? disconnectError.message : String(disconnectError);
-        if (
-          !disconnectMsg.includes('is not connected') &&
-          !isDockerNotFoundError(disconnectError)
-        ) {
-          throw disconnectError;
-        }
-      }
-
-      await network.connect({
-        Container: containerId,
-        EndpointConfig: { Aliases: [alias] },
-      });
+      throw error;
     }
   }

@@ -767,24 +772,31 @@ export class Docker {
   }

   async safeRemoveContainer(containerId: string): Promise<void> {
-    try {
-      const container = this.client.getContainer(containerId);
-      const info = await container.inspect();
-      const networks = info.NetworkSettings.Networks;
-      for (const net of Object.keys(networks)) {
-        try {
-          await this.disconnectContainerFromNetwork(containerId, net);
-        } catch (disconnectErr) {
-          log.warn(
-            { containerId, network: net, err: disconnectErr },
-            'Failed to disconnect container from network before removal',
-          );
+    await this.removeContainer(containerId);
+
+    const maxAttempts = 5;
+    const intervalMs = 200;
+    for (let attempt = 0; attempt < maxAttempts; attempt++) {
+      try {
+        const container = this.client.getContainer(containerId);
+        await container.inspect();
+        await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
+      } catch (error) {
+        const msg = error instanceof Error ? error.message : String(error);
+        if (
+          isDockerNotFoundError(error) ||
+          msg.includes('ECONNREFUSED') ||
+          msg.includes('ENOENT')
+        ) {
+          return;
         }
+
+        log.debug({ containerId, err: error }, 'Unexpected error during removal polling');
+        return;
       }
-    } catch (inspectErr) {
-      log.debug({ containerId, err: inspectErr }, 'Container inspect failed during safe removal');
     }
-    await this.removeContainer(containerId);
+
+    log.warn({ containerId }, 'Container sandbox cleanup polling timed out — proceeding anyway');
   }

   async tagImage(sourceTag: string, repo: string, newTag: string): Promise<void> {
@@ -806,6 +818,106 @@ export class Docker {
     }
   }

+  /** Inspect a container and return full metadata. */
+  async inspectContainer(containerId: string): Promise<Dockerode.ContainerInspectInfo> {
+    try {
+      const container = this.client.getContainer(containerId);
+      return await container.inspect();
+    } catch (error) {
+      if (isDockerNotFoundError(error)) {
+        throw new ContainerNotFoundError(containerId);
+      }
+      throw error;
+    }
+  }
+
+  /** Connect a container to a network with optional aliases. Silently succeeds if already connected. */
+  async connectContainerToNetwork(
+    containerId: string,
+    networkName: string,
+    aliases?: string[],
+  ): Promise<void> {
+    try {
+      const network = this.client.getNetwork(networkName);
+      await network.connect({
+        Container: containerId,
+        EndpointConfig: aliases ? { Aliases: aliases } : undefined,
+      });
+    } catch (error) {
+      const msg = error instanceof Error ? error.message : String(error);
+      if (msg.includes('already exists') || msg.includes('already connected')) {
+        return;
+      }
+      throw error;
+    }
+  }
+
+  /** Restart a running container. */
+  async restartContainer(containerId: string): Promise<void> {
+    try {
+      const container = this.client.getContainer(containerId);
+      await container.restart();
+    } catch (error) {
+      if (isDockerNotFoundError(error)) {
+        throw new ContainerNotFoundError(containerId);
+      }
+      throw error;
+    }
+  }
+
+  /** Execute a non-interactive command in a container and return structured output. */
+  async execSimple(
+    containerId: string,
+    cmd: string[],
+  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
+    const container = this.client.getContainer(containerId);
+    const exec = await container.exec({
+      Cmd: cmd,
+      AttachStdout: true,
+      AttachStderr: true,
+    });
+
+    const stream = await exec.start({ hijack: false, stdin: false });
+    const stdoutChunks: Buffer[] = [];
+    const stderrChunks: Buffer[] = [];
+    const stdoutStream = new PassThrough();
+    const stderrStream = new PassThrough();
+
+    stdoutStream.on('data', (chunk: Buffer) => {
+      stdoutChunks.push(chunk);
+    });
+    stderrStream.on('data', (chunk: Buffer) => {
+      stderrChunks.push(chunk);
+    });
+
+    this.client.modem.demuxStream(stream, stdoutStream, stderrStream);
+
+    await new Promise<void>((resolve, reject) => {
+      stream.on('error', reject);
+      stream.on('end', resolve);
+    });
+
+    const info = await exec.inspect();
+    return {
+      exitCode: info.ExitCode ?? 0,
+      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
+      stderr: Buffer.concat(stderrChunks).toString('utf8'),
+    };
+  }
+
+  /** Inspect a Docker network and return its metadata. */
+  async getNetworkInfo(networkName: string): Promise<Dockerode.NetworkInspectInfo> {
+    try {
+      const network = this.client.getNetwork(networkName);
+      return await network.inspect();
+    } catch (error) {
+      if (isDockerNotFoundError(error)) {
+        throw new Error(`Network not found: ${networkName}`);
+      }
+      throw error;
+    }
+  }
+
   async ensureProjectNetwork(projectName: string): Promise<string> {
     const networkName = containerName(projectName);

@@ -1025,6 +1137,13 @@ export class Docker {
     return this.networkName;
   }

+  /**
+   * @deprecated Use specific docker.ts methods instead.
+   * This method will be removed once all callers are migrated (PR2/PR3).
+   *
+   * Available methods: inspectContainer, execSimple, connectContainerToNetwork,
+   * restartContainer, getNetworkInfo, runContainer, safeRemoveContainer, etc.
+   */
   getClient(): Dockerode {
     return this.client;
   }
diff --git a/src/pipeline/recover.ts b/src/pipeline/recover.ts
index a5c855c..76b6ce4 100644
--- a/src/pipeline/recover.ts
+++ b/src/pipeline/recover.ts
@@ -36,7 +36,7 @@ async function containerExists(
   nameOrId: string,
 ): Promise<{ exists: boolean; running: boolean }> {
   try {
-    const info = await ctx.docker.getClient().getContainer(nameOrId).inspect();
+    const info = await ctx.docker.inspectContainer(nameOrId);
     return { exists: true, running: info.State.Running };
   } catch {
     return { exists: false, running: false };
@@ -45,6 +45,7 @@ async function containerExists(

 async function imageExists(ctx: AppContext, tag: string): Promise<boolean> {
   try {
+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no image wrapper yet
     await ctx.docker.getClient().getImage(tag).inspect();
     return true;
   } catch {
@@ -54,6 +55,7 @@ async function imageExists(ctx: AppContext, tag: string): Promise<boolean> {

 async function volumeExists(ctx: AppContext, name: string): Promise<boolean> {
   try {
+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no volume wrapper yet
     await ctx.docker.getClient().getVolume(name).inspect();
     return true;
   } catch {
@@ -66,6 +68,7 @@ async function ensureNetwork(
   name: string,
 ): Promise<RecoverItemResult<NetworkStatus>> {
   try {
+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no network wrapper yet
     const client = ctx.docker.getClient();
     try {
       await client.getNetwork(name).inspect();
@@ -124,6 +127,7 @@ async function recoverService(
     // Ensure volume (preserve existing data!)
     const volExists = await volumeExists(ctx, vName);
     if (!volExists) {
+      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no volume wrapper yet
       await ctx.docker.getClient().createVolume({
         Name: vName,
         Labels: {
@@ -140,73 +144,39 @@ async function recoverService(
       await ctx.docker.pullImage(service.image);
     }

-    // Parse stored env vars
-    const envVars: string[] = service.env_vars ? (JSON.parse(service.env_vars) as string[]) : [];
+    const rawEnvVars: string[] = service.env_vars ? (JSON.parse(service.env_vars) as string[]) : [];
+    const envVars: Record<string, string> = {};
+    for (const entry of rawEnvVars) {
+      const eqIdx = entry.indexOf('=');
+      if (eqIdx > 0) {
+        envVars[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
+      }
+    }

     // Get template config
     const template = SERVICE_TEMPLATES[service.type];
     const containerPort = getServiceContainerPort(service);
     const dataMountPath = getDataMountPath(service.type);

-    // Create container
-    const client = ctx.docker.getClient();
-    const newContainer = await client.createContainer({
-      Image: service.image,
+    await ctx.docker.safeRemoveContainer(cName);
+
+    const containerId = await ctx.docker.runContainer({
+      imageTag: service.image,
       name: cName,
-      Env: envVars,
-      ...(template?.cmd ? { Cmd: template.cmd } : {}),
-      ...(template?.healthcheck
-        ? {
-            Healthcheck: {
-              Test: template.healthcheck.test,
-              Interval: template.healthcheck.interval * 1_000_000_000,
-              Timeout: template.healthcheck.timeout * 1_000_000_000,
-              Retries: template.healthcheck.retries,
-              StartPeriod: template.healthcheck.startPeriod * 1_000_000_000,
-            },
-          }
-        : {}),
-      Labels: {
-        [DOCKER_LABELS.MANAGED]: 'true',
+      port: service.port,
+      containerPort,
+      envVars,
+      cmd: template?.cmd,
+      traefikLabels: {
         [DOCKER_LABELS.ROLE]: 'service',
         [DOCKER_LABELS.SERVICE]: service.name,
       },
-      ExposedPorts: {
-        [`${String(containerPort)}/tcp`]: {},
-      },
-      NetworkingConfig: {
-        EndpointsConfig: {
-          [SHARED_NETWORK_NAME]: { Aliases: [service.name] },
-        },
-      },
-      HostConfig: {
-        NetworkMode: ctx.docker.getNetworkName(),
-        RestartPolicy: { Name: 'unless-stopped' },
-        Binds: [`${vName}:${dataMountPath}`],
-        PortBindings: {
-          [`${String(containerPort)}/tcp`]: [{ HostPort: String(service.port) }],
-        },
-        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
-      },
+      network: SHARED_NETWORK_NAME,
+      restartPolicy: { Name: 'unless-stopped' },
+      extraBinds: [`${vName}:${dataMountPath}`],
     });

-    await newContainer.start();
-
-    // Connect to shared network if different from primary
-    const primaryNetwork = ctx.docker.getNetworkName();
-    if (primaryNetwork !== SHARED_NETWORK_NAME) {
-      try {
-        const sharedNet = client.getNetwork(SHARED_NETWORK_NAME);
-        await sharedNet.connect({
-          Container: newContainer.id,
-          EndpointConfig: { Aliases: [service.name] },
-        });
-      } catch {
-        // best-effort — may already be connected via NetworkingConfig
-      }
-    }
-
-    ctx.db.updateService(service.id, { status: 'running', containerId: newContainer.id });
+    ctx.db.updateService(service.id, { status: 'running', containerId });

     log.info({ service: service.name }, 'Service recovered');
     return { name: service.name, status: 'recreated' };
diff --git a/src/pipeline/service-adapters/shared.ts b/src/pipeline/service-adapters/shared.ts
index c11e21f..3ab53bf 100644
--- a/src/pipeline/service-adapters/shared.ts
+++ b/src/pipeline/service-adapters/shared.ts
@@ -1,5 +1,3 @@
-import { PassThrough } from 'node:stream';
-
 import type { ServiceRow } from '../../db/index.js';
 import type { Docker } from '../docker.js';
 import type { ContainerExecResult, ServiceCredentials } from './types.js';
@@ -19,90 +17,54 @@ export async function execInServiceContainer(
   command: string[],
   options?: ExecOptions,
 ): Promise<ContainerExecResult> {
-  const client = docker.getClient();
   const containerId = service.container_id ?? service.container_name;
-  const container = client.getContainer(containerId);
-  const exec = await container.exec({
-    Cmd: command,
-    AttachStdin: false,
-    AttachStdout: true,
-    AttachStderr: true,
-    Tty: false,
-  });
-
   const timeoutMs = options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
   const maxBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

-  const stream = await exec.start({ hijack: false, stdin: false });
-  const stdoutChunks: Buffer[] = [];
-  const stderrChunks: Buffer[] = [];
-  const state = { stdoutSize: 0, stderrSize: 0, truncated: false, timedOut: false };
-  const stdoutStream = new PassThrough();
-  const stderrStream = new PassThrough();
-
-  stdoutStream.on('data', (chunk: Buffer) => {
-    if (state.stdoutSize < maxBytes) {
-      const remaining = maxBytes - state.stdoutSize;
-      stdoutChunks.push(remaining >= chunk.length ? chunk : chunk.subarray(0, remaining));
-    } else {
-      state.truncated = true;
-    }
-    state.stdoutSize += chunk.length;
-  });
-  stderrStream.on('data', (chunk: Buffer) => {
-    if (state.stderrSize < maxBytes) {
-      const remaining = maxBytes - state.stderrSize;
-      stderrChunks.push(remaining >= chunk.length ? chunk : chunk.subarray(0, remaining));
-    } else {
-      state.truncated = true;
-    }
-    state.stderrSize += chunk.length;
-  });
-
-  client.modem.demuxStream(stream, stdoutStream, stderrStream);
-
-  const streamDone = new Promise<void>((resolve, reject) => {
-    stream.on('error', reject);
-    stream.on('end', resolve);
-  });
-
-  const timer = setTimeout(() => {
-    state.timedOut = true;
-    stream.destroy();
-  }, timeoutMs);
+  let execResult: { exitCode: number; stdout: string; stderr: string };
+  let timedOut = false;

   try {
-    await streamDone;
-  } catch {
-    if (!state.timedOut) throw new Error(`Exec stream error for service: ${service.id}`);
-  } finally {
-    clearTimeout(timer);
-  }
-
-  if (state.timedOut) {
-    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
-    const stderr = Buffer.concat(stderrChunks).toString('utf8');
-    return { stdout, stderr, exitCode: -1, truncated: true };
+    const timeoutPromise = new Promise<never>((_, reject) => {
+      setTimeout(() => {
+        reject(new Error('exec timeout'));
+      }, timeoutMs);
+    });
+
+    execResult = await Promise.race([docker.execSimple(containerId, command), timeoutPromise]);
+  } catch (error) {
+    if (error instanceof Error && error.message === 'exec timeout') {
+      timedOut = true;
+      execResult = { exitCode: -1, stdout: '', stderr: '' };
+    } else {
+      throw error;
+    }
   }

-  const info = await exec.inspect();
-  const exitCode = info.ExitCode;
-  if (typeof exitCode !== 'number') {
-    throw new Error(`Container command did not report an exit code for service: ${service.id}`);
+  if (timedOut) {
+    return { stdout: '', stderr: '', exitCode: -1, truncated: true };
   }

-  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
-  const stderr = Buffer.concat(stderrChunks).toString('utf8');
+  const truncated = execResult.stdout.length > maxBytes || execResult.stderr.length > maxBytes;
+  const stdout =
+    execResult.stdout.length > maxBytes ? execResult.stdout.slice(0, maxBytes) : execResult.stdout;
+  const stderr =
+    execResult.stderr.length > maxBytes ? execResult.stderr.slice(0, maxBytes) : execResult.stderr;

-  if (options?.throwOnNonZeroExit !== false && exitCode !== 0) {
+  if (options?.throwOnNonZeroExit !== false && execResult.exitCode !== 0) {
     const commandText = command.join(' ');
     const output = stderr.trim() || stdout.trim();
     throw new Error(
-      `Container command failed (${commandText}) with exit code ${String(exitCode)}${output ? `: ${output}` : ''}`,
+      `Container command failed (${commandText}) with exit code ${String(execResult.exitCode)}${output ? `: ${output}` : ''}`,
     );
   }

-  return { stdout, stderr, exitCode, ...(state.truncated ? { truncated: true } : {}) };
+  return {
+    stdout,
+    stderr,
+    exitCode: execResult.exitCode,
+    ...(truncated ? { truncated: true } : {}),
+  };
 }

 export function parseServiceCredentials(service: ServiceRow): ServiceCredentials {
diff --git a/src/pipeline/service-manager.ts b/src/pipeline/service-manager.ts
index ff96b3f..cc89325 100644
--- a/src/pipeline/service-manager.ts
+++ b/src/pipeline/service-manager.ts
@@ -222,6 +222,7 @@ export class ServiceManager {
    */
   async reconcileServiceNetworks(): Promise<void> {
     const services = this.db.listServices();
+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
     const client = this.docker.getClient();

     let reconciled = 0;
@@ -257,28 +258,12 @@ export class ServiceManager {
         const hasAlias = aliases.includes(service.name);

         if (!sharedNetwork) {
-          try {
-            await client.getNetwork(SHARED_NETWORK_NAME).connect({
-              Container: info.Id,
-              EndpointConfig: { Aliases: [service.name] },
-            });
-            migrated += 1;
-            log.info(
-              { serviceId: service.id, serviceName: service.name, containerId: info.Id },
-              'Service network reconciled (migrated to shared network)',
-            );
-          } catch (err) {
-            const msg = err instanceof Error ? err.message : String(err);
-            if (msg.includes('already exists') || msg.includes('already connected')) {
-              alreadyConnected += 1;
-              log.info(
-                { serviceId: service.id, serviceName: service.name, containerId: info.Id },
-                'Service already connected to shared network',
-              );
-              continue;
-            }
-            throw err;
-          }
+          await this.docker.connectContainerToNetwork(info.Id, SHARED_NETWORK_NAME, [service.name]);
+          migrated += 1;
+          log.info(
+            { serviceId: service.id, serviceName: service.name, containerId: info.Id },
+            'Service network reconciled (migrated to shared network)',
+          );
           continue;
         }

@@ -291,40 +276,14 @@ export class ServiceManager {
           continue;
         }

-        try {
-          await client.getNetwork(SHARED_NETWORK_NAME).disconnect({
-            Container: info.Id,
-            Force: false,
-          });
-        } catch (err) {
-          const msg = err instanceof Error ? err.message : String(err);
-          if (!msg.includes('is not connected') && !isDockerNotFoundError(err)) {
-            throw err;
-          }
-        }
+        await this.docker.disconnectContainerFromNetwork(info.Id, SHARED_NETWORK_NAME);

-        try {
-          await client.getNetwork(SHARED_NETWORK_NAME).connect({
-            Container: info.Id,
-            EndpointConfig: { Aliases: [service.name] },
-          });
-          migrated += 1;
-          log.info(
-            { serviceId: service.id, serviceName: service.name, containerId: info.Id },
-            'Service network reconciled (alias updated on shared network)',
-          );
-        } catch (err) {
-          const msg = err instanceof Error ? err.message : String(err);
-          if (msg.includes('already exists') || msg.includes('already connected')) {
-            alreadyConnected += 1;
-            log.info(
-              { serviceId: service.id, serviceName: service.name, containerId: info.Id },
-              'Service already connected to shared network',
-            );
-            continue;
-          }
-          throw err;
-        }
+        await this.docker.connectContainerToNetwork(info.Id, SHARED_NETWORK_NAME, [service.name]);
+        migrated += 1;
+        log.info(
+          { serviceId: service.id, serviceName: service.name, containerId: info.Id },
+          'Service network reconciled (alias updated on shared network)',
+        );
       } catch (err) {
         if (isDockerNotFoundError(err)) {
           log.warn(
@@ -456,6 +415,7 @@ export class ServiceManager {

     await this.docker.pullImage(image);

+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
     const client = this.docker.getClient();
     await client.createVolume({
       Name: volumeName,
@@ -466,6 +426,9 @@ export class ServiceManager {
       },
     });

+    // Raw createContainer: incompatible with docker.runContainer() — service containers
+    // need different labels (ROLE/SERVICE vs PROJECT), custom healthcheck support,
+    // explicit volume binds, and 'unless-stopped' restart policy. Consolidation deferred.
     const container = await client.createContainer({
       Image: image,
       name: containerName,
@@ -515,16 +478,8 @@ export class ServiceManager {

     for (const networkName of additionalNetworks) {
       try {
-        const client = this.docker.getClient();
-        await client.getNetwork(networkName).connect({
-          Container: container.id,
-          EndpointConfig: { Aliases: [opts.name] },
-        });
+        await this.docker.connectContainerToNetwork(container.id, networkName, [opts.name]);
       } catch (err) {
-        const msg = err instanceof Error ? err.message : String(err);
-        if (msg.includes('already exists') || msg.includes('already connected')) {
-          continue;
-        }
         log.warn(
           { err, networkName, containerName },
           'Failed to connect service to additional network',
@@ -617,6 +572,7 @@ export class ServiceManager {
     }

     const volumeName = this.getVolumeName(service.name);
+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
     const client = this.docker.getClient();
     try {
       await client.getVolume(volumeName).remove();
@@ -683,7 +639,10 @@ export class ServiceManager {

     await this.docker.pullImage('alpine');

+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
     const client = this.docker.getClient();
+    // Raw createContainer: ephemeral backup container (AutoRemove, no port/network/labels)
+    // is incompatible with docker.runContainer(). Consolidation deferred.
     const container = await client.createContainer({
       Image: 'alpine',
       Cmd: ['tar', 'czf', `/backup/${backupId}.tar.gz`, '-C', '/data', '.'],
@@ -727,7 +686,10 @@ export class ServiceManager {

     try {
       await this.docker.pullImage('alpine');
+      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
       const client = this.docker.getClient();
+      // Raw createContainer: ephemeral restore container (AutoRemove, no port/network/labels)
+      // is incompatible with docker.runContainer(). Consolidation deferred.
       const container = await client.createContainer({
         Image: 'alpine',
         Cmd: ['sh', '-c', `rm -rf /data/* && tar xzf /backup/${backupFilename} -C /data`],
@@ -809,6 +771,7 @@ export class ServiceManager {

     const containerId = service.container_id ?? service.container_name;
     try {
+      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
       const info = await this.docker.getClient().getContainer(containerId).inspect();
       const status: ServiceRow['status'] = info.State.Running ? 'running' : 'stopped';
       const containerIdFromDocker = info.Id;
@@ -936,6 +899,7 @@ export class ServiceManager {

     const containerRef = service.container_id ?? service.container_name;
     try {
+      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
       const info = await this.docker.getClient().getContainer(containerRef).inspect();
       const status: ServiceRow['status'] = info.State.Running ? 'running' : 'stopped';
       const healthRaw: unknown = info.State.Health?.Status;
@@ -1032,6 +996,7 @@ export class ServiceManager {
     let memoryLimitBytes: number | null = null;
     try {
       const containerId = service.container_id ?? service.container_name;
+      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
       const container = this.docker.getClient().getContainer(containerId);
       const rawStats = await container.stats({ stream: false });
       const cpuDelta =
@@ -1298,6 +1263,7 @@ export class ServiceManager {
   private async ensureServiceContainerRunning(service: ServiceRow): Promise<void> {
     const containerId = service.container_id ?? service.container_name;
     try {
+      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
       const info = await this.docker.getClient().getContainer(containerId).inspect();
       if (!info.State.Running) {
         throw new Error(`Service container is not running: ${service.id}`);
diff --git a/src/pipeline/traefik.ts b/src/pipeline/traefik.ts
index 81de3d9..5df1117 100644
--- a/src/pipeline/traefik.ts
+++ b/src/pipeline/traefik.ts
@@ -52,6 +52,7 @@ export class TraefikManager {

   async isRunning(): Promise<boolean> {
     try {
+      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
       const client = this.docker.getClient();
       const containers = await client.listContainers({
         filters: { label: [`${DOCKER_LABELS.ROLE}=traefik`] },
@@ -65,6 +66,7 @@ export class TraefikManager {

   private async hasCurrentConfig(): Promise<boolean> {
     try {
+      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
       const client = this.docker.getClient();
       const container = client.getContainer(this.containerName);
       const info = await container.inspect();
@@ -101,15 +103,7 @@ export class TraefikManager {
     networkName: string,
   ): Promise<boolean> {
     try {
-      const client = this.docker.getClient();
-      const container = client.getContainer(containerName);
-      const info = await container.inspect();
-      const connected = Object.keys(info.NetworkSettings.Networks);
-      if (connected.includes(networkName)) {
-        return true;
-      }
-      const network = client.getNetwork(networkName);
-      await network.connect({ Container: container.id });
+      await this.docker.connectContainerToNetwork(containerName, networkName);
       log.info({ containerName, networkName }, 'Traefik connected to network');
       return true;
     } catch (err) {
@@ -119,6 +113,7 @@ export class TraefikManager {
   }

   private async tryAdoptExistingTraefik(): Promise<boolean> {
+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
     const client = this.docker.getClient();
     const containers = await client.listContainers({
       filters: { label: [`${DOCKER_LABELS.ROLE}=traefik`], status: ['running'] },
@@ -162,6 +157,7 @@ export class TraefikManager {
   }

   private async ensureNetworkByName(name: string): Promise<void> {
+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
     const client = this.docker.getClient();

     try {
@@ -202,6 +198,7 @@ export class TraefikManager {
       return;
     }

+    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
     const client = this.docker.getClient();

     try {
@@ -239,7 +236,7 @@ export class TraefikManager {
     const httpPortStr = String(this.httpPort);
     const dashboardPortStr = String(this.dashboardPort);

-    const container = await client.createContainer({
+    await this.docker.runInfraContainer({
       Image: TRAEFIK_IMAGE,
       name: this.containerName,
       Cmd: [
@@ -271,7 +268,6 @@ export class TraefikManager {
         [DOCKER_LABELS.ROLE]: 'traefik',
       },
     });
-    await container.start();

     await this.ensureMultiNetwork();
   }
@@ -621,9 +617,7 @@ export async function connectToTraefikNetwork(
   networkName: string,
 ): Promise<void> {
   try {
-    const client = docker.getClient();
-    const network = client.getNetwork(networkName);
-    await network.connect({ Container: containerId });
+    await docker.connectContainerToNetwork(containerId, networkName);
     log.debug({ containerId, networkName }, 'Container connected to Traefik network');
   } catch (error) {
     log.warn({ error, containerId, networkName }, 'Failed to connect container to Traefik network');
diff --git a/test/pipeline/docker-methods.test.ts b/test/pipeline/docker-methods.test.ts
new file mode 100644
index 0000000..d603b86
--- /dev/null
+++ b/test/pipeline/docker-methods.test.ts
@@ -0,0 +1,368 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
+import { createRequire } from 'node:module';
+import { PassThrough } from 'node:stream';
+
+import { Docker } from '../../src/pipeline/docker.js';
+
+// ---------------------------------------------------------------------------
+// Mock setup (same pattern as test/docker.test.ts)
+// ---------------------------------------------------------------------------
+
+const mockPing = vi.fn();
+const mockListContainers = vi.fn();
+const mockBuildImage = vi.fn();
+const mockCreateContainer = vi.fn();
+const mockGetImage = vi.fn();
+const mockGetContainer = vi.fn();
+const mockFollowProgress = vi.fn();
+const mockGetNetwork = vi.fn();
+const mockDemuxStream = vi.fn();
+
+const require = createRequire(import.meta.url);
+const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
+  this.ping = mockPing;
+  this.listContainers = mockListContainers;
+  this.buildImage = mockBuildImage;
+  this.createContainer = mockCreateContainer;
+  this.getImage = mockGetImage;
+  this.getContainer = mockGetContainer;
+  this.getNetwork = mockGetNetwork;
+  this.modem = {
+    followProgress: mockFollowProgress,
+    demuxStream: mockDemuxStream,
+  };
+});
+
+const dockerodePath = require.resolve('dockerode');
+require.cache[dockerodePath] = {
+  id: dockerodePath,
+  filename: dockerodePath,
+  loaded: true,
+  exports: mockDockerodeClass,
+} as unknown as NodeJS.Module;
+
+// ---------------------------------------------------------------------------
+// Helpers
+// ---------------------------------------------------------------------------
+
+const resetMocks = () => {
+  mockPing.mockReset().mockResolvedValue('OK');
+  mockListContainers.mockReset().mockResolvedValue([]);
+  mockBuildImage.mockReset();
+  mockCreateContainer.mockReset();
+  mockGetImage.mockReset();
+  mockGetContainer.mockReset();
+  mockFollowProgress.mockReset();
+  mockGetNetwork.mockReset();
+  mockDemuxStream.mockReset();
+};
+
+/** Creates a Docker "not found" error that matches isDockerNotFoundError. */
+const notFoundError = (msg: string) => new Error(`No such container: ${msg}`);
+const networkNotFoundError = (msg: string) => new Error(`No such network: ${msg}`);
+
+// ---------------------------------------------------------------------------
+// Tests: inspectContainer
+// ---------------------------------------------------------------------------
+
+describe('inspectContainer', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns container inspect info on success', async () => {
+    const inspectData = {
+      Id: 'abc123',
+      State: { Running: true, Status: 'running' },
+      Config: { Image: 'myapp:latest' },
+    };
+    mockGetContainer.mockReturnValueOnce({
+      inspect: vi.fn().mockResolvedValueOnce(inspectData),
+    });
+
+    const docker = new Docker();
+    const result = await docker.inspectContainer('abc123');
+
+    expect(result).toEqual(inspectData);
+    expect(mockGetContainer).toHaveBeenCalledWith('abc123');
+  });
+
+  it('throws ContainerNotFoundError when container does not exist', async () => {
+    mockGetContainer.mockReturnValueOnce({
+      inspect: vi.fn().mockRejectedValueOnce(notFoundError('missing-id')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.inspectContainer('missing-id')).rejects.toMatchObject({
+      name: 'ContainerNotFoundError',
+    });
+  });
+
+  it('re-throws non-404 errors as-is', async () => {
+    mockGetContainer.mockReturnValueOnce({
+      inspect: vi.fn().mockRejectedValueOnce(new Error('permission denied')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.inspectContainer('denied')).rejects.toThrow('permission denied');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: connectContainerToNetwork
+// ---------------------------------------------------------------------------
+
+describe('connectContainerToNetwork', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('connects container to network successfully', async () => {
+    const connectFn = vi.fn().mockResolvedValueOnce(undefined);
+    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });
+
+    const docker = new Docker();
+    await docker.connectContainerToNetwork('c1', 'openlander');
+
+    expect(mockGetNetwork).toHaveBeenCalledWith('openlander');
+    expect(connectFn).toHaveBeenCalledWith({
+      Container: 'c1',
+      EndpointConfig: undefined,
+    });
+  });
+
+  it('passes aliases in EndpointConfig when provided', async () => {
+    const connectFn = vi.fn().mockResolvedValueOnce(undefined);
+    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });
+
+    const docker = new Docker();
+    await docker.connectContainerToNetwork('c1', 'openlander', ['myapp', 'api']);
+
+    expect(connectFn).toHaveBeenCalledWith({
+      Container: 'c1',
+      EndpointConfig: { Aliases: ['myapp', 'api'] },
+    });
+  });
+
+  it('silently returns when container is already connected (already exists)', async () => {
+    const connectFn = vi
+      .fn()
+      .mockRejectedValueOnce(
+        new Error('endpoint with name c1 already exists in network openlander'),
+      );
+    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });
+
+    const docker = new Docker();
+    await expect(docker.connectContainerToNetwork('c1', 'openlander')).resolves.toBeUndefined();
+  });
+
+  it('silently returns when "already connected" message', async () => {
+    const connectFn = vi
+      .fn()
+      .mockRejectedValueOnce(new Error('container already connected to network'));
+    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });
+
+    const docker = new Docker();
+    await expect(docker.connectContainerToNetwork('c1', 'net1')).resolves.toBeUndefined();
+  });
+
+  it('re-throws unexpected errors', async () => {
+    const connectFn = vi.fn().mockRejectedValueOnce(new Error('network driver failed'));
+    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });
+
+    const docker = new Docker();
+    await expect(docker.connectContainerToNetwork('c1', 'net1')).rejects.toThrow(
+      'network driver failed',
+    );
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: restartContainer
+// ---------------------------------------------------------------------------
+
+describe('restartContainer', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('restarts container successfully', async () => {
+    const restartFn = vi.fn().mockResolvedValueOnce(undefined);
+    mockGetContainer.mockReturnValueOnce({ restart: restartFn });
+
+    const docker = new Docker();
+    await docker.restartContainer('c1');
+
+    expect(mockGetContainer).toHaveBeenCalledWith('c1');
+    expect(restartFn).toHaveBeenCalledTimes(1);
+  });
+
+  it('throws ContainerNotFoundError when container does not exist', async () => {
+    mockGetContainer.mockReturnValueOnce({
+      restart: vi.fn().mockRejectedValueOnce(notFoundError('gone')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.restartContainer('gone')).rejects.toMatchObject({
+      name: 'ContainerNotFoundError',
+    });
+  });
+
+  it('re-throws non-404 errors as-is', async () => {
+    mockGetContainer.mockReturnValueOnce({
+      restart: vi.fn().mockRejectedValueOnce(new Error('daemon busy')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.restartContainer('busy')).rejects.toThrow('daemon busy');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: execSimple
+// ---------------------------------------------------------------------------
+
+describe('execSimple', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns structured output with exitCode 0 on success', async () => {
+    const execStream = new PassThrough();
+    const execInspect = vi.fn().mockResolvedValueOnce({ ExitCode: 0 });
+    const execStart = vi.fn().mockResolvedValueOnce(execStream);
+    const containerExec = vi.fn().mockResolvedValueOnce({
+      start: execStart,
+      inspect: execInspect,
+    });
+
+    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
+
+    mockDemuxStream.mockImplementationOnce(
+      (_stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
+        stdout.write(Buffer.from('hello world'));
+        stdout.end();
+        stderr.end();
+      },
+    );
+
+    // End the exec stream after a tick to let the promise resolve
+    setTimeout(() => execStream.emit('end'), 5);
+
+    const docker = new Docker();
+    const result = await docker.execSimple('c1', ['echo', 'hello']);
+
+    expect(result.exitCode).toBe(0);
+    expect(result.stdout).toBe('hello world');
+    expect(result.stderr).toBe('');
+
+    expect(containerExec).toHaveBeenCalledWith({
+      Cmd: ['echo', 'hello'],
+      AttachStdout: true,
+      AttachStderr: true,
+    });
+    expect(execStart).toHaveBeenCalledWith({ hijack: false, stdin: false });
+  });
+
+  it('returns non-zero exit code with stderr on failure', async () => {
+    const execStream = new PassThrough();
+    const execInspect = vi.fn().mockResolvedValueOnce({ ExitCode: 1 });
+    const execStart = vi.fn().mockResolvedValueOnce(execStream);
+    const containerExec = vi.fn().mockResolvedValueOnce({
+      start: execStart,
+      inspect: execInspect,
+    });
+
+    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
+
+    mockDemuxStream.mockImplementationOnce(
+      (_stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
+        stderr.write(Buffer.from('command not found'));
+        stdout.end();
+        stderr.end();
+      },
+    );
+
+    setTimeout(() => execStream.emit('end'), 5);
+
+    const docker = new Docker();
+    const result = await docker.execSimple('c1', ['bad-cmd']);
+
+    expect(result.exitCode).toBe(1);
+    expect(result.stdout).toBe('');
+    expect(result.stderr).toBe('command not found');
+  });
+
+  it('returns both stdout and stderr when both are populated', async () => {
+    const execStream = new PassThrough();
+    const execInspect = vi.fn().mockResolvedValueOnce({ ExitCode: 2 });
+    const execStart = vi.fn().mockResolvedValueOnce(execStream);
+    const containerExec = vi.fn().mockResolvedValueOnce({
+      start: execStart,
+      inspect: execInspect,
+    });
+
+    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
+
+    mockDemuxStream.mockImplementationOnce(
+      (_stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
+        stdout.write(Buffer.from('partial output'));
+        stderr.write(Buffer.from('warning: something wrong'));
+        stdout.end();
+        stderr.end();
+      },
+    );
+
+    setTimeout(() => execStream.emit('end'), 5);
+
+    const docker = new Docker();
+    const result = await docker.execSimple('c1', ['ls', '-la']);
+
+    expect(result.exitCode).toBe(2);
+    expect(result.stdout).toBe('partial output');
+    expect(result.stderr).toBe('warning: something wrong');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: getNetworkInfo
+// ---------------------------------------------------------------------------
+
+describe('getNetworkInfo', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns network inspect info on success', async () => {
+    const networkData = {
+      Name: 'openlander',
+      Id: 'net-abc123',
+      Driver: 'bridge',
+      Containers: { c1: { Name: 'myapp' } },
+    };
+    mockGetNetwork.mockReturnValueOnce({
+      inspect: vi.fn().mockResolvedValueOnce(networkData),
+    });
+
+    const docker = new Docker();
+    const result = await docker.getNetworkInfo('openlander');
+
+    expect(result).toEqual(networkData);
+    expect(mockGetNetwork).toHaveBeenCalledWith('openlander');
+  });
+
+  it('throws "Network not found" error when network does not exist', async () => {
+    mockGetNetwork.mockReturnValueOnce({
+      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('missing-net')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.getNetworkInfo('missing-net')).rejects.toThrow(
+      'Network not found: missing-net',
+    );
+  });
+
+  it('re-throws non-404 errors as-is', async () => {
+    mockGetNetwork.mockReturnValueOnce({
+      inspect: vi.fn().mockRejectedValueOnce(new Error('driver error')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.getNetworkInfo('broken')).rejects.toThrow('driver error');
+  });
+});
diff --git a/test/pipeline/docker-sandbox.test.ts b/test/pipeline/docker-sandbox.test.ts
new file mode 100644
index 0000000..363661d
--- /dev/null
+++ b/test/pipeline/docker-sandbox.test.ts
@@ -0,0 +1,225 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
+import { createRequire } from 'node:module';
+
+const { mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
+  mockLogWarn: vi.fn(),
+  mockLogDebug: vi.fn(),
+}));
+
+vi.mock('../../src/lib/logger.js', () => ({
+  createModuleLogger: vi.fn(() => ({
+    warn: mockLogWarn,
+    debug: mockLogDebug,
+    info: vi.fn(),
+    error: vi.fn(),
+    trace: vi.fn(),
+    fatal: vi.fn(),
+    child: vi.fn().mockReturnValue({
+      warn: vi.fn(),
+      debug: vi.fn(),
+      info: vi.fn(),
+      error: vi.fn(),
+      trace: vi.fn(),
+      fatal: vi.fn(),
+    }),
+  })),
+}));
+
+const mockPing = vi.fn();
+const mockListContainers = vi.fn();
+const mockCreateContainer = vi.fn();
+const mockGetContainer = vi.fn();
+const mockGetNetwork = vi.fn();
+const mockGetImage = vi.fn();
+const mockBuildImage = vi.fn();
+const mockFollowProgress = vi.fn();
+
+const require = createRequire(import.meta.url);
+const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
+  this.ping = mockPing;
+  this.listContainers = mockListContainers;
+  this.createContainer = mockCreateContainer;
+  this.getContainer = mockGetContainer;
+  this.getNetwork = mockGetNetwork;
+  this.getImage = mockGetImage;
+  this.buildImage = mockBuildImage;
+  this.modem = { followProgress: mockFollowProgress };
+});
+
+const dockerodePath = require.resolve('dockerode');
+require.cache[dockerodePath] = {
+  id: dockerodePath,
+  filename: dockerodePath,
+  loaded: true,
+  exports: mockDockerodeClass,
+} as unknown as NodeJS.Module;
+
+import { Docker } from '../../src/pipeline/docker.js';
+
+const resetMocks = () => {
+  mockPing.mockReset().mockResolvedValue('OK');
+  mockListContainers.mockReset().mockResolvedValue([]);
+  mockCreateContainer.mockReset();
+  mockGetContainer.mockReset();
+  mockGetImage.mockReset();
+  mockBuildImage.mockReset();
+  mockFollowProgress.mockReset();
+  mockLogWarn.mockReset();
+  mockLogDebug.mockReset();
+  mockGetNetwork.mockReset().mockReturnValue({
+    connect: vi.fn().mockResolvedValue(undefined),
+    disconnect: vi.fn().mockResolvedValue(undefined),
+    inspect: vi.fn().mockResolvedValue({}),
+  });
+};
+
+describe('Docker sandbox race prevention', () => {
+  beforeEach(() => {
+    resetMocks();
+  });
+
+  afterEach(() => {
+    vi.useRealTimers();
+    vi.restoreAllMocks();
+  });
+
+  it('safeRemoveContainer resolves when container is already gone (404)', async () => {
+    const mockRemove = vi.fn().mockResolvedValue(undefined);
+    const mockInspect = vi.fn().mockRejectedValue(new Error('No such container: sandbox-test'));
+
+    mockGetContainer.mockReturnValue({
+      remove: mockRemove,
+      inspect: mockInspect,
+    });
+
+    const docker = new Docker();
+    await expect(docker.safeRemoveContainer('sandbox-test')).resolves.toBeUndefined();
+
+    expect(mockRemove).toHaveBeenCalledOnce();
+    expect(mockInspect).toHaveBeenCalledOnce();
+  });
+
+  it('safeRemoveContainer treats ECONNREFUSED as container gone', async () => {
+    const mockRemove = vi.fn().mockResolvedValue(undefined);
+    const mockInspect = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:2375'));
+
+    mockGetContainer.mockReturnValue({
+      remove: mockRemove,
+      inspect: mockInspect,
+    });
+
+    const docker = new Docker();
+    await expect(docker.safeRemoveContainer('sandbox-econnrefused')).resolves.toBeUndefined();
+
+    expect(mockRemove).toHaveBeenCalledOnce();
+    expect(mockInspect).toHaveBeenCalledOnce();
+  });
+
+  it('safeRemoveContainer timeout logs warning but does not throw', async () => {
+    vi.useFakeTimers();
+
+    const mockRemove = vi.fn().mockResolvedValue(undefined);
+    const mockInspect = vi.fn().mockResolvedValue({ State: { Running: false } });
+
+    mockGetContainer.mockReturnValue({
+      remove: mockRemove,
+      inspect: mockInspect,
+    });
+
+    const docker = new Docker();
+    const promise = docker.safeRemoveContainer('sandbox-stuck');
+
+    for (let i = 0; i < 5; i++) {
+      await vi.advanceTimersByTimeAsync(200);
+    }
+
+    await expect(promise).resolves.toBeUndefined();
+    expect(mockInspect).toHaveBeenCalledTimes(5);
+    expect(mockLogWarn).toHaveBeenCalledOnce();
+    expect(mockLogWarn).toHaveBeenCalledWith(
+      expect.objectContaining({ containerId: 'sandbox-stuck' }),
+      expect.stringContaining('timed out'),
+    );
+  });
+
+  it('runContainer skips post-start network attach when NetworkMode is shared', async () => {
+    const container = { id: 'ctr-shared-net', start: vi.fn().mockResolvedValue(undefined) };
+    mockCreateContainer.mockResolvedValueOnce(container);
+
+    const connect = vi.fn().mockResolvedValue(undefined);
+    mockGetNetwork.mockReturnValue({
+      connect,
+      disconnect: vi.fn().mockResolvedValue(undefined),
+      inspect: vi.fn().mockResolvedValue({}),
+    });
+
+    const docker = new Docker('/var/run/docker.sock', 'openlander');
+    await docker.runContainer({
+      imageTag: 'app:v1',
+      name: 'ol-myapp',
+      port: 10001,
+      containerPort: 3000,
+      envVars: { NODE_ENV: 'production' },
+      traefikLabels: {},
+    });
+
+    expect(container.start).toHaveBeenCalledOnce();
+    expect(connect).not.toHaveBeenCalled();
+  });
+
+  it('ensureSharedNetworkAttachment silently returns on already-connected error', async () => {
+    const connect = vi
+      .fn()
+      .mockRejectedValueOnce(
+        new Error('endpoint with name already connected to network openlander'),
+      );
+    const disconnect = vi.fn().mockResolvedValue(undefined);
+
+    mockGetNetwork.mockReturnValue({
+      connect,
+      disconnect,
+      inspect: vi.fn().mockResolvedValue({}),
+    });
+
+    const docker = new Docker('/var/run/docker.sock', 'openlander');
+    await expect(
+      docker.ensureSharedNetworkAttachment('ctr-already', 'myapp'),
+    ).resolves.toBeUndefined();
+
+    expect(connect).toHaveBeenCalledOnce();
+    expect(connect).toHaveBeenCalledWith({
+      Container: 'ctr-already',
+      EndpointConfig: { Aliases: ['myapp'] },
+    });
+    expect(disconnect).not.toHaveBeenCalled();
+  });
+
+  it('runContainer calls ensureSharedNetworkAttachment when NetworkMode is not shared', async () => {
+    const container = { id: 'ctr-custom-net', start: vi.fn().mockResolvedValue(undefined) };
+    mockCreateContainer.mockResolvedValueOnce(container);
+
+    const connect = vi.fn().mockResolvedValue(undefined);
+    mockGetNetwork.mockReturnValue({
+      connect,
+      disconnect: vi.fn().mockResolvedValue(undefined),
+      inspect: vi.fn().mockResolvedValue({}),
+    });
+
+    const docker = new Docker('/var/run/docker.sock', 'traefik-web');
+    await docker.runContainer({
+      imageTag: 'worker:v1',
+      name: 'ol-worker',
+      port: 10002,
+      containerPort: 3000,
+      envVars: { NODE_ENV: 'production' },
+      traefikLabels: {},
+    });
+
+    expect(container.start).toHaveBeenCalledOnce();
+    expect(connect).toHaveBeenCalledOnce();
+    expect(connect).toHaveBeenCalledWith({
+      Container: 'ctr-custom-net',
+      EndpointConfig: { Aliases: ['worker'] },
+    });
+  });
+});

exec
/bin/bash -lc "sed -n '1,240p' .sisyphus/plans/docker-layer-consolidation.md" in /home/lee/OpenLander
 succeeded in 0ms:
# Docker Layer Consolidation + Sandbox Bug Fix (PR 1/3)

## TL;DR

> **Quick Summary**: Fix "network sandbox not found" race condition by eliminating dual network attachment path, then consolidate all write-path raw dockerode calls into docker.ts as a proper abstraction layer.
>
> **Deliverables**:
> - Sandbox bug fixed (single-path network attachment + removal polling)
> - 5 new docker.ts methods (inspectContainer, connectContainerToNetwork, restartContainer, execSimple, getNetworkInfo)
> - 5 files migrated from raw dockerode to docker.ts (service-manager, recover, traefik, connectivity-check, service-adapters/shared)
> - `getClient()` marked @deprecated
> - Tests for all new methods + sandbox race prevention
>
> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 (bug fix) → Task 2 (new methods) → Tasks 3-7 (migrations, parallel) → F1-F4 (verification)

---

## Context

### Original Request
사용자가 Aaron 제보 "network sandbox for container X not found" 버그 수정 요청. 조사 중 Docker 로직이 24개 파일에 산재, 13개 파일이 docker.ts를 바이패스하는 구조적 문제 발견. 반복되는 Docker 관련 버그 방지를 위해 전체 정리 결정.

### Interview Summary
**Key Discussions**:
- 버그 원인: `runContainer()`의 이중 네트워크 연결 (createContainer NetworkingConfig + post-start connectContainerToSharedNetwork), disconnect→reconnect 수리 경로, safeRemoveContainer의 cleanup 대기 없음
- 24개 파일이 `getClient()`로 raw dockerode 호출 (63개 인스턴스)
- Metis 리뷰: 3 PR 분리 권장 (PR1: bug fix + write-path, PR2: read-path, PR3: special cases)
- Oracle 리뷰: creation-time network attachment, bounded polling, thin helper

**Research Findings**:
- `safeRemoveContainer`: 21 call sites across 10 files
- `connectContainerToSharedNetwork`: private, docker.ts 내부만 (line 477, 551)
- service-manager.ts: 가장 heavy (10개 getClient 호출)
- compose.ts:670: raw force-remove without network disconnect (E7)
- recover.ts: dual network path + raw createVolume

### Metis Review
**Identified Gaps** (addressed):
- 범위 과소 추정 (13→24파일) → 3 PR 분리로 해결
- deploy-core.ts:966 raw createContainer 누락 → special case로 defer
- streaming exec (terminal-routes.ts) 누락 → PR3로 defer
- docker-events.ts 누락 → PR3로 defer
- 에러 메시지 포맷 호환성 (E5) → typed error 미도입, 기존 포맷 유지

---

## Work Objectives

### Core Objective
Docker "network sandbox not found" 레이스 컨디션 수정 + write-path raw dockerode 호출을 docker.ts 추상화 레이어로 통합하여 향후 Docker 관련 버그 재발 방지.

### Concrete Deliverables
- `src/pipeline/docker.ts` — 5개 신규 메서드 + 버그 수정 + @deprecated getClient()
- `src/pipeline/service-manager.ts` — 10개 raw 호출 → docker.ts 경유
- `src/pipeline/recover.ts` — 3개 raw 호출 → docker.ts 경유
- `src/pipeline/traefik.ts` — 4개 raw 호출 → docker.ts 경유
- `src/pipeline/deploy/connectivity-check.ts` — 1개 raw exec → docker.execSimple()
- `src/pipeline/service-adapters/shared.ts` — 1개 raw exec → docker.execSimple()
- `test/pipeline/docker-sandbox.test.ts` — sandbox 레이스 방지 테스트
- `test/pipeline/docker-methods.test.ts` — 신규 메서드 테스트

### Definition of Done
- [ ] `grep -rn "\.createContainer(" src/ --include="*.ts" | grep -v docker.ts` → deploy-core.ts:966만 남음
- [ ] `grep -rn "network\.connect(" src/ --include="*.ts" | grep -v docker.ts` → 0건
- [ ] `npm run typecheck` PASS
- [ ] `npm test` — 기존 테스트 전부 PASS (pre-existing 3건 제외)
- [ ] 신규 테스트 전부 PASS

### Must Have
- 네트워크 연결 단일 경로 (creation-time when shared, post-start when non-shared)
- disconnect→reconnect 수리 경로 삭제
- safeRemoveContainer 제거 후 cleanup 폴링 (5×200ms, warn on timeout)
- getClient() @deprecated JSDoc
- 기존 에러 메시지 포맷 호환 (callers의 string-match 패턴 유지)

### Must NOT Have (Guardrails)
- getClient() 제거 (24파일 의존, 이번 PR에서는 deprecate만)
- typed error 도입 (에러 포맷 변경 = caller 전부 수정 필요, scope explosion)
- streaming exec API (terminal-routes.ts, PR3)
- docker-events.ts 변경 (fundamentally different pattern, PR3)
- deploy-core.ts:966 변경 (special case: transient container for image commit, PR3)
- recover.ts createVolume 변경 (PR3)
- read-path 파일 변경 (14파일, PR2)
- lifecycle.ts 아키텍처 변경 (현재 동작 유지)
- compose.ts 아키텍처 변경 (raw remove L670만 safeRemoveContainer로 교체)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Vitest)
- **Automated tests**: YES (tests-after)
- **Framework**: Vitest

### QA Policy
Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend**: Use Bash — run tests, grep assertions, typecheck

---

## Execution Strategy

### Parallel Execution Waves

```

Wave 1 (Foundation — bug fix + new methods):
├── Task 1: Fix sandbox bug in docker.ts [deep]
├── Task 2: Add new docker.ts methods [unspecified-high]
└── Task 3: compose.ts:670 raw remove → safeRemoveContainer [quick]

Wave 2 (Write-path migration — MAX PARALLEL):
├── Task 4: Migrate service-manager.ts (depends: 1, 2) [unspecified-high]
├── Task 5: Migrate recover.ts (depends: 1, 2) [unspecified-high]
├── Task 6: Migrate traefik.ts (depends: 1, 2) [unspecified-high]
├── Task 7: Migrate connectivity-check.ts + service-adapters/shared.ts (depends: 2) [quick]
└── Task 8: Deprecate getClient() + update AGENTS.md (depends: 1) [quick]

Wave 3 (Tests):
├── Task 9: Sandbox race prevention tests (depends: 1) [unspecified-high]
└── Task 10: New methods + migration regression tests (depends: 2-7) [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 4 → Task 9 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Wave 2)

```

### Dependency Matrix

| Task | Blocked By | Blocks |
|------|-----------|--------|
| 1 | - | 3, 4, 5, 6, 8, 9 |
| 2 | - | 4, 5, 6, 7, 10 |
| 3 | - | 10 |
| 4 | 1, 2 | 10 |
| 5 | 1, 2 | 10 |
| 6 | 1, 2 | 10 |
| 7 | 2 | 10 |
| 8 | 1 | 10 |
| 9 | 1 | F1-F4 |
| 10 | 2-7 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 → `deep`, T2 → `unspecified-high`, T3 → `quick`
- **Wave 2**: 5 tasks — T4-T6 → `unspecified-high`, T7-T8 → `quick`
- **Wave 3**: 2 tasks — T9-T10 → `unspecified-high`
- **FINAL**: 4 tasks — F1 → `oracle`, F2-F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Fix sandbox bug — dual network path + removal polling

  **What to do**:
  - In `runContainer()` (docker.ts:428-478): When `networkMode === SHARED_NETWORK_NAME`, rely ONLY on `createContainer`'s `NetworkingConfig.EndpointsConfig` for network attachment. Remove the `connectContainerToSharedNetwork()` call at line 477.
  - When `networkMode !== SHARED_NETWORK_NAME`, keep a single post-start `network.connect()` call (connect-if-missing only). No disconnect→reconnect.
  - Apply same fix to `runComposeService()` (docker.ts:481-577): remove line 551 `connectContainerToSharedNetwork()` when primary network is shared.
  - Refactor `connectContainerToSharedNetwork()` into a public `ensureSharedNetworkAttachment(containerId, alias)` that ONLY connects if the container is not already on the shared network. DELETE the disconnect→reconnect repair path (lines 596-620).
  - In `safeRemoveContainer()` (docker.ts:769-788): Remove the pre-disconnect loop (lines 774-783). Replace with: force remove → poll `container.inspect()` until 404 (5 attempts × 200ms = 1s max). On timeout: log.warn + continue (don't throw). Handle ECONNREFUSED as "container gone".

  **Must NOT do**:
  - Do not change `removeContainer()` — it stays as simple force remove
  - Do not introduce typed errors (keep existing error message format for callers)
  - Do not change any callers of `safeRemoveContainer` — 21 call sites must work identically

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Race condition fix requiring precise understanding of Docker daemon behavior + network sandbox lifecycle
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3, 4, 5, 6, 8, 9
  - **Blocked By**: None

  **References**:
  - `src/pipeline/docker.ts:428-478` — `runContainer()` method with dual network path
  - `src/pipeline/docker.ts:481-577` — `runComposeService()` with same pattern
  - `src/pipeline/docker.ts:580-621` — `connectContainerToSharedNetwork()` with disconnect→reconnect repair path
  - `src/pipeline/docker.ts:769-788` — `safeRemoveContainer()` with pre-disconnect
  - `src/pipeline/docker.ts:796-807` — `disconnectContainerFromNetwork()` used by safeRemoveContainer
  - `src/pipeline/build-recovery.ts:75` — `/network sandbox/i` pattern detection (confirms this is a known error class)

  **Acceptance Criteria**:
  - [ ] `runContainer()` body does NOT contain `connectContainerToSharedNetwork` call
  - [ ] `runComposeService()` body does NOT contain `connectContainerToSharedNetwork` call
  - [ ] `ensureSharedNetworkAttachment()` exists as public method, has NO disconnect call
  - [ ] `safeRemoveContainer()` has NO `disconnectContainerFromNetwork` calls, HAS polling loop
  - [ ] `npm run typecheck` PASS
  - [ ] `npm test` — existing tests pass

  **QA Scenarios (MANDATORY)**:
```

Scenario: safeRemoveContainer polling completes on first check
Tool: Bash
Steps: 1. Run: npx vitest run test/pipeline/docker-sandbox.test.ts 2. Verify test "safeRemoveContainer polls until container is gone" passes
Expected Result: Test passes — polling exits after inspect returns 404
Evidence: .sisyphus/evidence/task-1-removal-polling.txt

Scenario: No dual network path in runContainer
Tool: Bash
Steps: 1. Run: grep -n "connectContainerToSharedNetwork" src/pipeline/docker.ts 2. Verify output does NOT include any line inside runContainer or runComposeService method bodies
Expected Result: connectContainerToSharedNetwork only appears as method definition
Evidence: .sisyphus/evidence/task-1-no-dual-path.txt

```

**Commit**: YES
- Message: `fix(pipeline): eliminate dual network attachment path + add removal polling`
- Files: `src/pipeline/docker.ts`
- Pre-commit: `npm run typecheck && npx vitest run test/pipeline/`

- [x] 2. Add new docker.ts methods for write-path migration

**What to do**:
- Add `inspectContainer(containerId: string)` — wraps `client.getContainer(id).inspect()`, throws `ContainerNotFoundError` on 404
- Add `connectContainerToNetwork(containerId: string, networkName: string, aliases?: string[])` — wraps `network.connect()`, handles "already connected" silently
- Add `restartContainer(containerId: string)` — wraps `container.restart()`, throws `ContainerNotFoundError` on 404
- Add `execSimple(containerId: string, cmd: string[])` — wraps `container.exec()` + `exec.start()`, returns `{ exitCode: number, stdout: string, stderr: string }`. Does NOT support TTY/streaming.
- Add `getNetworkInfo(networkName: string)` — wraps `client.getNetwork(name).inspect()`, returns network info object


codex
I have the main diff. Next I’m checking the exact implementations around `docker.ts`, the `service-manager` migration points, and the tests to see whether the new abstractions preserve prior behavior.
exec
/bin/bash -lc "sed -n '420,940p' src/pipeline/docker.ts" in /home/lee/OpenLander
succeeded in 0ms:
        if (event.stream) buildLog += event.stream;
        if (event.error) {
          buildError += event.error + '\n';
          buildLog += `ERROR: ${event.error}\n`;
        }
        opts.onProgress?.(event);
      },
    );
  });
}

/** Create and start a container. */
async runContainer(options: RunContainerOptions): Promise<string> {
  const envArray = Object.entries(options.envVars).map(([k, v]) => `${k}=${v}`);
  const cPort = options.containerPort ?? options.port;
  const extraHosts = await this.resolveExtraHosts();
  const secretBinds = this.writeSecretFiles(options.name, options.secretFiles ?? []);
  const projectName = stripContainerPrefix(options.name);
  const networkMode = options.network ?? this.networkName;
  const networkingConfig =
    networkMode === SHARED_NETWORK_NAME
      ? {
          EndpointsConfig: {
            [SHARED_NETWORK_NAME]: {
              Aliases: [projectName],
            },
          },
        }
      : undefined;
  const volumeBinds = await this.getProjectVolumeBinds(projectName);
  const binds = [...secretBinds, ...volumeBinds, ...(options.extraBinds ?? [])];

  const container = await this.client.createContainer({
    Image: options.imageTag,
    name: options.name,
    Env: envArray,
    Labels: {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.PROJECT]: stripContainerPrefix(options.name),
      ...options.traefikLabels,
    },
    ExposedPorts: {
      [`${String(cPort)}/tcp`]: {},
    },
    Cmd: options.cmd,
    NetworkingConfig: networkingConfig,
    HostConfig: {
      PortBindings: {
        [`${String(cPort)}/tcp`]: [{ HostPort: String(options.port) }],
      },
      Binds: binds.length > 0 ? binds : undefined,
      NetworkMode: networkMode,
      RestartPolicy: options.restartPolicy ?? { Name: 'on-failure', MaximumRetryCount: 5 },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
    },
  });

  await container.start();

  if (networkMode !== SHARED_NETWORK_NAME) {
    await this.ensureSharedNetworkAttachment(container.id, projectName);
  }

  return container.id;
}

async runComposeService(opts: RunComposeServiceOptions): Promise<string> {
  const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
  const cPort = opts.containerPort ?? opts.port;
  const extraHosts = await this.resolveExtraHosts();
  const secretBinds = this.writeSecretFiles(opts.name, opts.secretFiles ?? []);
  const projectName = stripContainerPrefix(opts.name);
  const volumeBinds = await this.getProjectVolumeBinds(projectName);
  const binds = [...secretBinds, ...volumeBinds];
  const networkMode = opts.network ?? opts.networks?.[0] ?? this.networkName;
  const networkingConfig =
    networkMode === SHARED_NETWORK_NAME
      ? {
          EndpointsConfig: {
            [SHARED_NETWORK_NAME]: {
              Aliases: [projectName],
            },
          },
        }
      : undefined;

  if (typeof opts.command === 'string' && /[;&|`$(){}]/.test(opts.command)) {
    throw new Error('Command contains disallowed shell metacharacters');
  }

  const command = typeof opts.command === 'string' ? ['sh', '-c', opts.command] : opts.command;
  const restartPolicyName =
    opts.restart === 'no' ||
    opts.restart === 'always' ||
    opts.restart === 'on-failure' ||
    opts.restart === 'unless-stopped'
      ? opts.restart
      : 'unless-stopped';
  const healthcheck = opts.healthcheck
    ? {
        Test:
          typeof opts.healthcheck.test === 'string'
            ? ['CMD-SHELL', opts.healthcheck.test]
            : opts.healthcheck.test,
        ...(opts.healthcheck.interval !== undefined
          ? { Interval: opts.healthcheck.interval * 1_000_000_000 }
          : {}),
        ...(opts.healthcheck.timeout !== undefined
          ? { Timeout: opts.healthcheck.timeout * 1_000_000_000 }
          : {}),
        ...(opts.healthcheck.retries !== undefined ? { Retries: opts.healthcheck.retries } : {}),
        ...(opts.healthcheck.start_period !== undefined
          ? { StartPeriod: opts.healthcheck.start_period * 1_000_000_000 }
          : {}),
      }
    : undefined;

  const container = await this.client.createContainer({
    Image: opts.imageTag,
    name: opts.name,
    Env: envArray,
    Labels: {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.PROJECT]: stripContainerPrefix(opts.name),
      ...opts.traefikLabels,
    },
    ExposedPorts: {
      [`${String(cPort)}/tcp`]: {},
    },
    Cmd: command,
    Entrypoint: opts.entrypoint,
    Healthcheck: healthcheck,
    NetworkingConfig: networkingConfig,
    HostConfig: {
      PortBindings: {
        [`${String(cPort)}/tcp`]: [{ HostPort: String(opts.port) }],
      },
      Binds: binds.length > 0 ? binds : undefined,
      NetworkMode: networkMode,
      RestartPolicy: { Name: restartPolicyName },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
    },
  });

  await container.start();

  if (networkMode !== SHARED_NETWORK_NAME) {
    await this.ensureSharedNetworkAttachment(container.id, projectName);
  }

  const additionalNetworks =
    opts.networks
      ?.slice(1)
      .filter((networkName, index, arr) => arr.indexOf(networkName) === index) ?? [];
  try {
    for (const networkName of additionalNetworks) {
      await this.client.getNetwork(networkName).connect({ Container: container.id });
    }
  } catch (error) {
    try {
      await container.stop();
    } catch {
      /* best-effort */
    }

    try {
      await container.remove({ force: true });
    } catch {
      /* best-effort */
    }

    throw error;
  }

  return container.id;
}

/**
 * Create and start an infrastructure container (e.g. Traefik).
 * Unlike runContainer, this accepts raw Dockerode options for non-project
 * containers that don't follow the standard port/Traefik-label pattern.
 */
async runInfraContainer(options: Dockerode.ContainerCreateOptions): Promise<string> {
  const container = await this.client.createContainer(options);
  await container.start();
  return container.id;
}

public async ensureSharedNetworkAttachment(containerId: string, alias: string): Promise<void> {
  const network = this.client.getNetwork(SHARED_NETWORK_NAME);

  try {
    await network.connect({
      Container: containerId,
      EndpointConfig: { Aliases: [alias] },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('already exists') || msg.includes('already connected')) {
      return;
    }

    throw error;
  }
}

private writeSecretFiles(containerName: string, files: SecretFileMount[]): string[] {
  if (files.length === 0) return [];

  const secretsDir = join(getDataDir(), 'container-secrets', containerName);
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });

  const binds: string[] = [];
  for (const file of files) {
    const hostPath = join(secretsDir, file.filename);
    writeFileSync(hostPath, file.content, { mode: 0o600 });
    binds.push(`${hostPath}:${file.mountPath}:ro`);
  }
  return binds;
}

private async getProjectVolumeBinds(projectName: string): Promise<string[]> {
  try {
    const result = await this.client.listVolumes({
      filters: {
        label: [
          `${DOCKER_LABELS.MANAGED}=true`,
          `${DOCKER_LABELS.ROLE}=volume`,
          `${DOCKER_LABELS.PROJECT}=${projectName}`,
        ],
      },
    });
    const volumes = Array.isArray(result.Volumes) ? result.Volumes : [];
    const volumeBinds: string[] = [];
    for (const vol of volumes) {
      const name = vol.Name;
      const labels = vol.Labels as Record<string, string> | undefined;
      if (!labels) continue;
      const mountPath = labels[DOCKER_LABELS.MOUNT_PATH];
      if (typeof mountPath === 'string' && mountPath.startsWith('/')) {
        volumeBinds.push(`${name}:${mountPath}:rw`);
      }
    }
    return volumeBinds;
  } catch {
    return [];
  }
}

cleanupSecretFiles(containerName: string): void {
  const secretsDir = join(getDataDir(), 'container-secrets', containerName);
  try {
    rmSync(secretsDir, { recursive: true, force: true });
  } catch (_) {
    /* best-effort */
  }
}

private async resolveExtraHosts(): Promise<string[]> {
  try {
    const info = (await this.client.info()) as {
      OperatingSystem?: string;
    };

    if (info.OperatingSystem?.includes('Docker Desktop')) {
      return [];
    }
  } catch {
    return [];
  }

  // Prefer concrete gateway IP — host-gateway relies on daemon resolution
  // which fails on some configurations (Podman, misconfigured daemons, WSL)
  try {
    const network = (await this.client.getNetwork(this.networkName).inspect()) as {
      IPAM?: { Config?: Array<{ Gateway?: string }> };
    };
    const gateway = network.IPAM?.Config?.[0]?.Gateway;
    if (gateway && /^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
      return [`host.docker.internal:${gateway}`];
    }
  } catch (_) {
    /* network inspect may fail */
  }

  return [];
}

/** Get the first EXPOSE port from a Docker image. Returns undefined if none found. */
async getImageExposedPort(imageTag: string): Promise<number | undefined> {
  try {
    const image = this.client.getImage(imageTag);
    const info = await image.inspect();
    const keys = Object.keys(info.Config.ExposedPorts);
    const first = keys[0]; // e.g. "80/tcp"
    if (!first) return undefined;
    const portStr = first.split('/')[0];
    if (!portStr) return undefined;
    const port = parseInt(portStr, 10);
    return isNaN(port) ? undefined : port;
  } catch (_err) {
    return undefined;
  }
}

/** Stop a running container. */
async stopContainer(containerId: string): Promise<void> {
  try {
    const container = this.client.getContainer(containerId);
    await container.stop();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isDockerNotFoundError(error)) {
      throw new ContainerNotFoundError(containerId);
    }
    // Already stopped is not an error
    if (!msg.includes('is not running')) {
      throw error;
    }
  }
}

/** Start a stopped container. */
async startContainer(containerId: string): Promise<void> {
  try {
    const container = this.client.getContainer(containerId);
    await container.start();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isDockerNotFoundError(error)) {
      throw new ContainerNotFoundError(containerId);
    }
    // Already running is not an error
    if (!msg.includes('is already running') && !msg.includes('already started')) {
      throw error;
    }
  }
}

/** Remove a container (force removes even if running). */
async removeContainer(containerId: string): Promise<void> {
  try {
    const container = this.client.getContainer(containerId);
    await container.remove({ force: true });
  } catch (error) {
    if (isDockerNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

async safeRemoveContainer(containerId: string): Promise<void> {
  await this.removeContainer(containerId);

  const maxAttempts = 5;
  const intervalMs = 200;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const container = this.client.getContainer(containerId);
      await container.inspect();
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        isDockerNotFoundError(error) ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOENT')
      ) {
        return;
      }

      log.debug({ containerId, err: error }, 'Unexpected error during removal polling');
      return;
    }
  }

  log.warn({ containerId }, 'Container sandbox cleanup polling timed out — proceeding anyway');
}

async tagImage(sourceTag: string, repo: string, newTag: string): Promise<void> {
  const image = this.client.getImage(sourceTag);
  await image.tag({ repo, tag: newTag });
}

/** Disconnect a container from a network before removal to avoid sandbox cleanup races. */
async disconnectContainerFromNetwork(containerId: string, networkName: string): Promise<void> {
  try {
    const network = this.client.getNetwork(networkName);
    await network.disconnect({ Container: containerId, Force: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('is not connected') || isDockerNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

/** Inspect a container and return full metadata. */
async inspectContainer(containerId: string): Promise<Dockerode.ContainerInspectInfo> {
  try {
    const container = this.client.getContainer(containerId);
    return await container.inspect();
  } catch (error) {
    if (isDockerNotFoundError(error)) {
      throw new ContainerNotFoundError(containerId);
    }
    throw error;
  }
}

/** Connect a container to a network with optional aliases. Silently succeeds if already connected. */
async connectContainerToNetwork(
  containerId: string,
  networkName: string,
  aliases?: string[],
): Promise<void> {
  try {
    const network = this.client.getNetwork(networkName);
    await network.connect({
      Container: containerId,
      EndpointConfig: aliases ? { Aliases: aliases } : undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('already exists') || msg.includes('already connected')) {
      return;
    }
    throw error;
  }
}

/** Restart a running container. */
async restartContainer(containerId: string): Promise<void> {
  try {
    const container = this.client.getContainer(containerId);
    await container.restart();
  } catch (error) {
    if (isDockerNotFoundError(error)) {
      throw new ContainerNotFoundError(containerId);
    }
    throw error;
  }
}

/** Execute a non-interactive command in a container and return structured output. */
async execSimple(
  containerId: string,
  cmd: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const container = this.client.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: false, stdin: false });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();

  stdoutStream.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  stderrStream.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  this.client.modem.demuxStream(stream, stdoutStream, stderrStream);

  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  const info = await exec.inspect();
  return {
    exitCode: info.ExitCode ?? 0,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
}

/** Inspect a Docker network and return its metadata. */
async getNetworkInfo(networkName: string): Promise<Dockerode.NetworkInspectInfo> {
  try {
    const network = this.client.getNetwork(networkName);
    return await network.inspect();
  } catch (error) {
    if (isDockerNotFoundError(error)) {
      throw new Error(`Network not found: ${networkName}`);
    }
    throw error;
  }
}

async ensureProjectNetwork(projectName: string): Promise<string> {
  const networkName = containerName(projectName);

  try {
    await this.client.getNetwork(networkName).inspect();
    return networkName;
  } catch (error) {
    if (!isDockerNotFoundError(error)) {
      throw error;
    }
  }

  try {
    await this.client.createNetwork({ Name: networkName, Driver: 'bridge' });
    return networkName;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('already exists')) {
      return networkName;
    }

exec
/bin/bash -lc "sed -n '1,260p' src/pipeline/service-manager.ts" in /home/lee/OpenLander
succeeded in 0ms:
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { nanoid } from 'nanoid';

import { DOCKER_LABELS, getDataDir, SHARED_NETWORK_NAME } from '../config/index.js';
import type { Database, ServiceRow } from '../db/index.js';
import { createModuleLogger } from '../lib/logger.js';
import { sleep } from '../lib/sleep.js';
import { serviceContainerName, serviceVolumeName } from './helpers.js';
import {
getServiceAdapter,
type BuiltInServiceType,
type CreateDatabaseResult,
type CreateUserResult,
type ListedDatabase,
type ListedUser,
} from './service-adapters/index.js';
import { MinioAdapter } from './service-adapters/minio-adapter.js';
import {
assertSafeDatabaseName,
assertSafeUserName,
execInServiceContainer,
type ExecOptions,
} from './service-adapters/shared.js';
import type { ContainerExecResult } from './service-adapters/types.js';
import type { Docker } from './docker.js';
import { allocatePort } from './port.js';
import { isDockerNotFoundError } from '../errors.js';

const log = createModuleLogger('service-manager');
const SERVICE_CARD_SUMMARY_CACHE_TTL_MS = 15_000;

type ServiceCardSummary = ServiceRow & {
summary: {
  healthStatus: string | null;
  uptimeSeconds: number | null;
  restartCount: number | null;
};
};

export const AVAILABLE_VERSIONS: Record<string, string[]> = {
postgresql: ['17-alpine', '16-alpine', '15-alpine', '14-alpine'],
mysql: ['9', '8'],
redis: ['8-alpine', '7-alpine'],
mongodb: ['8', '7'],
minio: ['RELEASE.2024-11-07T00-52-20Z', 'latest'],
rabbitmq: ['4.0-management-alpine', '3.13-management-alpine'],
};

export interface ServiceTemplate {
type: string;
image: string;
port: number;
cmd?: string[];
healthcheck?: {
  test: string[];
  interval: number;
  timeout: number;
  retries: number;
  startPeriod: number;
};
env: (creds: { user: string; password: string; database: string }) => string[];
}

export const SERVICE_TEMPLATES: Record<string, ServiceTemplate> = {
postgresql: {
  type: 'postgresql',
  image: 'postgres:16-alpine',
  port: 5432,
  env: (c) => [
    `POSTGRES_USER=${c.user}`,
    `POSTGRES_PASSWORD=${c.password}`,
    `POSTGRES_DB=${c.database}`,
  ],
},
mysql: {
  type: 'mysql',
  image: 'mysql:8',
  port: 3306,
  env: (c) => [
    `MYSQL_ROOT_PASSWORD=${c.password}`,
    `MYSQL_DATABASE=${c.database}`,
    `MYSQL_USER=${c.user}`,
    `MYSQL_PASSWORD=${c.password}`,
  ],
},
redis: {
  type: 'redis',
  image: 'redis:7-alpine',
  port: 6379,
  env: () => [],
},
mongodb: {
  type: 'mongodb',
  image: 'mongo:7',
  port: 27017,
  env: (c) => [
    `MONGO_INITDB_ROOT_USERNAME=${c.user}`,
    `MONGO_INITDB_ROOT_PASSWORD=${c.password}`,
  ],
},
minio: {
  type: 'minio',
  image: 'minio/minio:RELEASE.2024-11-07T00-52-20Z',
  port: 9000,
  cmd: ['server', '/data', '--console-address', ':9001'],
  healthcheck: {
    test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live'],
    interval: 30,
    timeout: 10,
    retries: 3,
    startPeriod: 10,
  },
  env: (c) => [`MINIO_ROOT_USER=${c.user}`, `MINIO_ROOT_PASSWORD=${c.password}`],
},
rabbitmq: {
  type: 'rabbitmq',
  image: 'rabbitmq:4.0-management-alpine',
  port: 5672,
  healthcheck: {
    test: ['CMD', 'rabbitmq-diagnostics', 'check_running'],
    interval: 30,
    timeout: 10,
    retries: 3,
    startPeriod: 30,
  },
  env: (c) => [`RABBITMQ_DEFAULT_USER=${c.user}`, `RABBITMQ_DEFAULT_PASS=${c.password}`],
},
};

/**
* Standard env var key for each built-in service type.
* First service of a type gets the standard key; subsequent ones are prefixed.
*/
const DEFAULT_ENV_KEYS: Record<string, string> = {
postgresql: 'DATABASE_URL',
mysql: 'DATABASE_URL',
redis: 'REDIS_URL',
mongodb: 'MONGODB_URL',
minio: 'S3_ENDPOINT',
rabbitmq: 'RABBITMQ_URL',
};

export class ServiceManager {
private serviceCardSummaryCache: { expiresAt: number; data: ServiceCardSummary[] } | null = null;
private serviceCardSummaryInFlight: Promise<ServiceCardSummary[]> | null = null;
private serviceCardSummaryEpoch = 0;

constructor(
  private readonly docker: Docker,
  private readonly db: Database,
  private readonly dataDir: string = getDataDir(),
) {}

private invalidateServiceCardSummaryCache(): void {
  this.serviceCardSummaryCache = null;
  this.serviceCardSummaryEpoch += 1;
}

/**
 * Compute suggested env var(s) for a newly created service so the agent
 * can auto-link it to a project via set_env_vars.
 *
 * Rules:
 *  - First service of a type → standard key (DATABASE_URL, REDIS_URL, …)
 *  - Subsequent services of the same type → prefixed key (e.g. MYDB_DATABASE_URL)
 */
getSuggestedEnv(service: ServiceRow): Array<{ key: string; value: string }> {
  const baseKey = DEFAULT_ENV_KEYS[service.type];
  if (!baseKey) {
    return [];
  }

  const credentials = service.credentials ? this.tryParseCredentials(service.credentials) : null;
  const connectionString = (credentials?.['connectionString'] as string | undefined) ?? null;
  if (!connectionString) {
    return [];
  }

  const existing = this.db
    .listServices()
    .filter((s) => s.type === service.type && s.id !== service.id);

  if (service.type === 'minio') {
    const user = (credentials?.['user'] as string | undefined) ?? '';
    const password = (credentials?.['password'] as string | undefined) ?? '';
    const prefix =
      existing.length === 0 ? '' : `${service.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;
    return [
      { key: `${prefix}S3_ENDPOINT`, value: connectionString },
      { key: `${prefix}AWS_ACCESS_KEY_ID`, value: user },
      { key: `${prefix}AWS_SECRET_ACCESS_KEY`, value: password },
    ];
  }

  const key =
    existing.length === 0
      ? baseKey
      : `${service.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${baseKey}`;

  return [{ key, value: connectionString }];
}

private tryParseCredentials(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reconcile all existing services to the shared network with aliases.
 * Called at startup to ensure DNS resolution works for pre-existing services.
 * Idempotent: skips services already connected with correct alias.
 */
async reconcileServiceNetworks(): Promise<void> {
  const services = this.db.listServices();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
  const client = this.docker.getClient();

  let reconciled = 0;
  let migrated = 0;
  let alreadyConnected = 0;

  for (const service of services) {
    const containerRef = service.container_id ?? service.container_name;
    if (!containerRef) {
      continue;
    }

    reconciled += 1;

    try {
      const container = client.getContainer(containerRef);
      const info = await container.inspect();

      if (!info.State.Running) {
        log.warn(
          { serviceId: service.id, serviceName: service.name, containerRef },
          'Service container is stopped — skipping shared network reconciliation',
        );
        continue;
      }

      const networks = info.NetworkSettings.Networks;
      const sharedNetwork = networks[SHARED_NETWORK_NAME];
      const aliasesRaw: unknown = sharedNetwork?.Aliases;
      const aliases: string[] = Array.isArray(aliasesRaw)
        ? aliasesRaw.filter((alias): alias is string => typeof alias === 'string')
        : [];
      const hasAlias = aliases.includes(service.name);

      if (!sharedNetwork) {

exec
/bin/bash -lc "sed -n '1,260p' src/pipeline/traefik.ts" in /home/lee/OpenLander
succeeded in 0ms:
import { networkInterfaces, platform } from 'node:os';

import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('traefik');

import type { Docker } from './docker.js';
import { DOCKER_LABELS, getDataDir, getPolicy, SHARED_NETWORK_NAME } from '../config/index.js';
import { containerName as projectContainerName } from './helpers.js';
import { join } from 'node:path';
import { isDockerNotFoundError } from '../errors.js';

const TRAEFIK_IMAGE = 'traefik:v3.6';

export type TraefikEnvironment = 'production' | 'development';

export interface TraefikManagerOptions {
containerName?: string;
networkName?: string;
httpPort?: number;
dashboardPort?: number;
}

/** Get the dynamic config directory for the current environment. */
export function getDynamicConfigDir(): string {
return join(getDataDir(), 'traefik', 'dynamic');
}

/**
* Traefik reverse proxy management.
*
* OpenLander uses Traefik as a Docker-label-based reverse proxy.
* Each deployed container gets Traefik labels that automatically
* configure routing without touching any config files.
*/
export class TraefikManager {
private readonly containerName: string;
private readonly networkName: string;
private readonly httpPort: number;
private readonly dashboardPort: number;

constructor(
  private readonly docker: Docker,
  private readonly openLanderPort: number = 3000,
  options?: TraefikManagerOptions,
) {
  const defaultPolicy = getPolicy('production');
  this.containerName = options?.containerName ?? 'traefik-ol';
  this.networkName = options?.networkName ?? defaultPolicy.networkName;
  this.httpPort = options?.httpPort ?? 80;
  this.dashboardPort = options?.dashboardPort ?? 8080;
}

async isRunning(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
    const client = this.docker.getClient();
    const containers = await client.listContainers({
      filters: { label: [`${DOCKER_LABELS.ROLE}=traefik`] },
    });
    return containers.length > 0;
  } catch (err) {
    log.warn({ err }, 'Failed to check Traefik running status');
    return false;
  }
}

private async hasCurrentConfig(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
    const client = this.docker.getClient();
    const container = client.getContainer(this.containerName);
    const info = await container.inspect();
    const cmd: string[] = (info.Config.Cmd as string[] | null) ?? [];
    const hasHttpProvider = cmd.some((arg: string) => arg.includes('providers.http.endpoint'));
    const hasCorrectNetwork = cmd.some(
      (arg: string) => arg === `--providers.docker.network=${this.networkName}`,
    );
    return hasHttpProvider && hasCorrectNetwork;
  } catch (_err) {
    return false;
  }
}

async ensureNetwork(): Promise<void> {
  await this.ensureNetworkByName(this.networkName);
}

async ensureAllNetworks(): Promise<void> {
  await this.ensureNetworkByName(SHARED_NETWORK_NAME);
}

/**
 * Connect the Traefik container to an additional Docker network.
 * Used to join the dev network so Traefik can route to dev containers.
 * No-op if already connected.
 */
async connectToNetwork(networkName: string): Promise<void> {
  await this.connectContainerToNetworkByName(this.containerName, networkName);
}

private async connectContainerToNetworkByName(
  containerName: string,
  networkName: string,
): Promise<boolean> {
  try {
    await this.docker.connectContainerToNetwork(containerName, networkName);
    log.info({ containerName, networkName }, 'Traefik connected to network');
    return true;
  } catch (err) {
    log.warn({ err, containerName, networkName }, 'Failed to connect Traefik to network');
    return false;
  }
}

private async tryAdoptExistingTraefik(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
  const client = this.docker.getClient();
  const containers = await client.listContainers({
    filters: { label: [`${DOCKER_LABELS.ROLE}=traefik`], status: ['running'] },
  });

  const candidate = containers.find((c) => {
    const name = (c.Names[0] ?? '').replace(/^\//, '');
    return name !== this.containerName;
  });

  if (!candidate) {
    return false;
  }

  const candidateName = (candidate.Names[0] ?? '').replace(/^\//, '');
  log.info(
    { existingContainer: candidateName, managedContainer: this.containerName },
    'Found legacy OpenLander Traefik — adopting',
  );

  const connected = await this.connectContainerToNetworkByName(
    candidateName,
    SHARED_NETWORK_NAME,
  );
  if (!connected) {
    log.warn(
      'Failed to connect adopted Traefik to shared network — falling back to new container',
    );
    return false;
  }

  try {
    const stale = client.getContainer(this.containerName);
    await stale.remove({ force: true });
    log.debug({ containerName: this.containerName }, 'Removed stale managed Traefik container');
  } catch {
    // Container doesn't exist — expected
  }

  return true;
}

private async ensureNetworkByName(name: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
  const client = this.docker.getClient();

  try {
    await client.getNetwork(name).inspect();
    return;
  } catch (error) {
    if (!isDockerNotFoundError(error)) {
      throw error;
    }
  }

  try {
    await client.createNetwork({
      Name: name,
      Driver: 'bridge',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('already exists')) {
      return;
    }
    throw error;
  }
}

async start(): Promise<void> {
  if (await this.isRunning()) {
    if (await this.hasCurrentConfig()) {
      await this.ensureMultiNetwork();
      return;
    }
    log.info('Traefik config outdated (missing HTTP Provider) — recreating container');
  }

  await this.ensureAllNetworks();

  if (await this.tryAdoptExistingTraefik()) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
  const client = this.docker.getClient();

  try {
    const existing = await client.listContainers({
      all: true,
      filters: { label: [`${DOCKER_LABELS.ROLE}=traefik`] },
    });
    for (const c of existing) {
      await client.getContainer(c.Id).remove({ force: true });
    }
    if (existing.length > 0) {
      log.debug(
        `Removed ${existing.length.toString()} existing Traefik container(s) before recreation`,
      );
    }
  } catch (_err) {
    // Container doesn't exist — expected on first run
  }

  try {
    const stream = await client.pull(TRAEFIK_IMAGE);
    await new Promise<void>((resolve, reject) => {
      client.modem.followProgress(stream, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  } catch (err) {
    log.debug({ err }, 'Traefik image pull failed — may already exist locally');
  }

  const httpPortStr = String(this.httpPort);
  const dashboardPortStr = String(this.dashboardPort);

  await this.docker.runInfraContainer({
    Image: TRAEFIK_IMAGE,
    name: this.containerName,
    Cmd: [
      '--api.insecure=true',
      '--providers.docker=true',
      '--providers.docker.exposedbydefault=false',
      `--providers.docker.network=${this.networkName}`,
      `--providers.http.endpoint=http://host.docker.internal:${String(this.openLanderPort)}/api/traefik/config`,
      '--providers.http.pollInterval=5s',
      '--entrypoints.web.address=:80',
    ],
    ExposedPorts: {
      '80/tcp': {},
      '8080/tcp': {},
    },
    HostConfig: {
      PortBindings: {
        '80/tcp': [{ HostPort: httpPortStr }],
        '8080/tcp': [{ HostPort: dashboardPortStr }],
      },
      Binds: ['/var/run/docker.sock:/var/run/docker.sock:ro'],

exec
/bin/bash -lc "sed -n '1,240p' src/pipeline/recover.ts" in /home/lee/OpenLander
succeeded in 0ms:
import { DOCKER_LABELS, SHARED_NETWORK_NAME } from '../config/index.js';
import type { AppContext } from '../app.js';
import type { ProjectRow, ServiceRow } from '../db/index.js';
import {
containerName as projectContainerName,
serviceContainerName,
serviceVolumeName,
} from './helpers.js';
import { SERVICE_TEMPLATES } from './service-manager.js';
import { getServiceAdapter } from './service-adapters/index.js';
import { buildTraefikLabels } from './traefik.js';
import { allocatePort } from './port.js';
import { getPolicy } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('recover');

type NetworkStatus = 'existed' | 'created' | 'error';
type ServiceStatus = 'running' | 'started' | 'recreated' | 'error';
type ProjectStatus = 'running' | 'started' | 'recreated' | 'needs_redeploy' | 'skipped' | 'error';

export interface RecoverItemResult<T extends string> {
name: string;
status: T;
error?: string;
}

export interface RecoverResult {
networks: RecoverItemResult<NetworkStatus>[];
services: RecoverItemResult<ServiceStatus>[];
projects: RecoverItemResult<ProjectStatus>[];
}

async function containerExists(
ctx: AppContext,
nameOrId: string,
): Promise<{ exists: boolean; running: boolean }> {
try {
  const info = await ctx.docker.inspectContainer(nameOrId);
  return { exists: true, running: info.State.Running };
} catch {
  return { exists: false, running: false };
}
}

async function imageExists(ctx: AppContext, tag: string): Promise<boolean> {
try {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no image wrapper yet
  await ctx.docker.getClient().getImage(tag).inspect();
  return true;
} catch {
  return false;
}
}

async function volumeExists(ctx: AppContext, name: string): Promise<boolean> {
try {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no volume wrapper yet
  await ctx.docker.getClient().getVolume(name).inspect();
  return true;
} catch {
  return false;
}
}

async function ensureNetwork(
ctx: AppContext,
name: string,
): Promise<RecoverItemResult<NetworkStatus>> {
try {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no network wrapper yet
  const client = ctx.docker.getClient();
  try {
    await client.getNetwork(name).inspect();
    return { name, status: 'existed' };
  } catch {
    // doesn't exist
  }
  await client.createNetwork({ Name: name, Driver: 'bridge' });
  return { name, status: 'created' };
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('already exists')) {
    return { name, status: 'existed' };
  }
  return { name, status: 'error', error: msg };
}
}

function getDataMountPath(type: string): string {
const adapter = getServiceAdapter(type);
return adapter ? adapter.getDataMountPath() : '/data';
}

function getServiceContainerPort(service: ServiceRow): number {
const template = SERVICE_TEMPLATES[service.type];
return template?.port ?? service.port;
}

async function recoverService(
ctx: AppContext,
service: ServiceRow,
dryRun: boolean,
): Promise<RecoverItemResult<ServiceStatus>> {
const cName = serviceContainerName(service.name);
const vName = serviceVolumeName(service.name);

try {
  // Check if container already exists
  const container = await containerExists(ctx, cName);
  if (container.exists && container.running) {
    return { name: service.name, status: 'running' };
  }
  if (container.exists && !container.running) {
    if (!dryRun) {
      await ctx.docker.startContainer(cName);
      ctx.db.updateService(service.id, { status: 'running' });
    }
    return { name: service.name, status: 'started' };
  }

  // Container doesn't exist — recreate
  if (dryRun) {
    return { name: service.name, status: 'recreated' };
  }

  // Ensure volume (preserve existing data!)
  const volExists = await volumeExists(ctx, vName);
  if (!volExists) {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no volume wrapper yet
    await ctx.docker.getClient().createVolume({
      Name: vName,
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.ROLE]: 'service',
        [DOCKER_LABELS.SERVICE]: service.name,
      },
    });
  }

  // Ensure image
  const hasImage = await imageExists(ctx, service.image);
  if (!hasImage) {
    await ctx.docker.pullImage(service.image);
  }

  const rawEnvVars: string[] = service.env_vars ? (JSON.parse(service.env_vars) as string[]) : [];
  const envVars: Record<string, string> = {};
  for (const entry of rawEnvVars) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx > 0) {
      envVars[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
    }
  }

  // Get template config
  const template = SERVICE_TEMPLATES[service.type];
  const containerPort = getServiceContainerPort(service);
  const dataMountPath = getDataMountPath(service.type);

  await ctx.docker.safeRemoveContainer(cName);

  const containerId = await ctx.docker.runContainer({
    imageTag: service.image,
    name: cName,
    port: service.port,
    containerPort,
    envVars,
    cmd: template?.cmd,
    traefikLabels: {
      [DOCKER_LABELS.ROLE]: 'service',
      [DOCKER_LABELS.SERVICE]: service.name,
    },
    network: SHARED_NETWORK_NAME,
    restartPolicy: { Name: 'unless-stopped' },
    extraBinds: [`${vName}:${dataMountPath}`],
  });

  ctx.db.updateService(service.id, { status: 'running', containerId });

  log.info({ service: service.name }, 'Service recovered');
  return { name: service.name, status: 'recreated' };
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  log.error({ service: service.name, error: msg }, 'Failed to recover service');
  return { name: service.name, status: 'error', error: msg };
}
}

async function recoverProject(
ctx: AppContext,
project: ProjectRow,
dryRun: boolean,
): Promise<RecoverItemResult<ProjectStatus>> {
const cName = projectContainerName(project.name);

try {
  // Skip stopped/archived projects
  if (project.status === 'stopped' || project.archived_at) {
    return { name: project.name, status: 'skipped' };
  }

  // Check if container already exists
  const container = await containerExists(ctx, cName);
  if (container.exists && container.running) {
    if (project.status !== 'running') {
      ctx.db.updateProject(project.id, { status: 'running' });
    }
    return { name: project.name, status: 'running' };
  }
  if (container.exists && !container.running) {
    if (!dryRun) {
      await ctx.docker.startContainer(cName);
      ctx.db.updateProject(project.id, { status: 'running' });
    }
    return { name: project.name, status: 'started' };
  }

  // Container doesn't exist — check if image is available
  if (!project.image_tag) {
    return { name: project.name, status: 'needs_redeploy' };
  }

  const hasImage = await imageExists(ctx, project.image_tag);
  if (!hasImage) {
    // Also check :latest tag
    const latestTag = `openlander/${project.name}:latest`;
    const hasLatest = await imageExists(ctx, latestTag);
    if (!hasLatest) {
      return { name: project.name, status: 'needs_redeploy' };
    }
  }

  if (dryRun) {
    return { name: project.name, status: 'recreated' };
  }

  // Get env vars and secret files for the project
  const envVars = ctx.db.getEnvVars(project.id);
  const secretFiles = ctx.env.getSecretFilesForDeploy(project.id);

exec
/bin/bash -lc "rg -n \"createContainer|getClient\\(|connectContainerToNetwork|disconnectContainerFromNetwork|execSimple|backup|restore\" src/pipeline/service-manager.ts" in /home/lee/OpenLander
succeeded in 0ms:
226:    const client = this.docker.getClient();
261:          await this.docker.connectContainerToNetwork(info.Id, SHARED_NETWORK_NAME, [service.name]);
279:        await this.docker.disconnectContainerFromNetwork(info.Id, SHARED_NETWORK_NAME);
281:        await this.docker.connectContainerToNetwork(info.Id, SHARED_NETWORK_NAME, [service.name]);
419:    const client = this.docker.getClient();
429:    // Raw createContainer: incompatible with docker.runContainer() — service containers
432:    const container = await client.createContainer({
481:        await this.docker.connectContainerToNetwork(container.id, networkName, [opts.name]);
576:    const client = this.docker.getClient();
594:  async backup(id: string): Promise<{ backupId: string; path: string; size: number }> {
597:    const backupDir = this.getBackupDir();
598:    const backupId = `${service.name}-${String(Date.now())}`;
599:    const backupPath = join(backupDir, `${backupId}.tar.gz`);
601:    mkdirSync(backupDir, { recursive: true });
603:    // Redis: flush in-memory data to disk (BGSAVE) before volume backup.
604:    // Without this, the RDB dump file may not exist or be stale, leading to empty backups.
629:              `Redis BGSAVE did not complete within 30s for service ${service.id}, proceeding with backup`,
635:          `Redis BGSAVE failed for service ${service.id}, proceeding with backup: ${error instanceof Error ? error.message : String(error)}`,
643:    const client = this.docker.getClient();
644:    // Raw createContainer: ephemeral backup container (AutoRemove, no port/network/labels)
646:    const container = await client.createContainer({
648:      Cmd: ['tar', 'czf', `/backup/${backupId}.tar.gz`, '-C', '/data', '.'],
650:        Binds: [`${volumeName}:/data:ro`, `${backupDir}:/backup`],
657:    const backupExitCode =
661:    if (backupExitCode !== 0) {
663:        `Backup failed with exit code ${String(backupExitCode)} for service: ${service.id}`,
667:    if (!existsSync(backupPath)) {
668:      throw new Error(`Backup file not found after backup: ${backupPath}`);
670:    const size = statSync(backupPath).size;
672:    return { backupId, path: backupPath, size };
675:  async restore(id: string, backupId: string): Promise<void> {
677:    const backupDir = this.getBackupDir();
678:    const backupFilename = `${backupId}.tar.gz`;
679:    const backupPath = join(backupDir, backupFilename);
680:    if (!existsSync(backupPath)) {
681:      throw new Error(`Backup not found: ${backupPath}`);
690:      const client = this.docker.getClient();
691:      // Raw createContainer: ephemeral restore container (AutoRemove, no port/network/labels)
693:      const container = await client.createContainer({
695:        Cmd: ['sh', '-c', `rm -rf /data/* && tar xzf /backup/${backupFilename} -C /data`],
697:          Binds: [`${volumeName}:/data`, `${backupDir}:/backup:ro`],
704:      const restoreExitCode =
708:      if (restoreExitCode !== 0) {
710:          `Restore failed with exit code ${String(restoreExitCode)} for service: ${service.id}`,
718:  listBackups(id: string): Array<{ backupId: string; createdAt: Date; sizeBytes: number }> {
720:    const backupDir = this.getBackupDir();
721:    if (!existsSync(backupDir)) {
726:    const entries = readdirSync(backupDir)
729:        const backupId = name.slice(0, -'.tar.gz'.length);
730:        const timestampRaw = backupId.slice(prefix.length);
732:        const stats = statSync(join(backupDir, name));
734:          backupId,
775:      const info = await this.docker.getClient().getContainer(containerId).inspect();
903:      const info = await this.docker.getClient().getContainer(containerRef).inspect();
1000:      const container = this.docker.getClient().getContainer(containerId);
1176:    return join(this.dataDir, 'backups');
1267:      const info = await this.docker.getClient().getContainer(containerId).inspect();

exec
/bin/bash -lc "sed -n '260,760p' src/pipeline/service-manager.ts" in /home/lee/OpenLander
succeeded in 0ms:
      if (!sharedNetwork) {
        await this.docker.connectContainerToNetwork(info.Id, SHARED_NETWORK_NAME, [service.name]);
        migrated += 1;
        log.info(
          { serviceId: service.id, serviceName: service.name, containerId: info.Id },
          'Service network reconciled (migrated to shared network)',
        );
        continue;
      }

      if (hasAlias) {
        alreadyConnected += 1;
        log.info(
          { serviceId: service.id, serviceName: service.name, containerId: info.Id },
          'Service already connected to shared network with alias',
        );
        continue;
      }

      await this.docker.disconnectContainerFromNetwork(info.Id, SHARED_NETWORK_NAME);

      await this.docker.connectContainerToNetwork(info.Id, SHARED_NETWORK_NAME, [service.name]);
      migrated += 1;
      log.info(
        { serviceId: service.id, serviceName: service.name, containerId: info.Id },
        'Service network reconciled (alias updated on shared network)',
      );
    } catch (err) {
      if (isDockerNotFoundError(err)) {
        log.warn(
          { err, serviceId: service.id, serviceName: service.name, containerRef },
          'Service container not found — skipping shared network reconciliation',
        );
        continue;
      }

      log.warn(
        { err, serviceId: service.id, serviceName: service.name, containerRef },
        'Failed to reconcile service shared network connection',
      );
    }
  }

  log.info(
    { reconciled, migrated, alreadyConnected },
    `Reconciled ${String(reconciled)} services: ${String(migrated)} migrated, ${String(alreadyConnected)} already connected`,
  );
}

async create(opts: {
  name: string;
  template?: string;
  image?: string;
  port?: number;
  version?: string;
  envVars?: Array<{ key: string; value: string }>;
}): Promise<ServiceRow> {
  const hasTemplate = typeof opts.template === 'string';
  const hasImage = typeof opts.image === 'string';

  if (!hasTemplate && !hasImage) {
    throw new Error('Provide at least one of template or image');
  }

  const userEnv = this.toEnvPairs(opts.envVars);
  const userEnvJson = opts.envVars ? JSON.stringify(opts.envVars) : undefined;

  let type: string;
  let image: string;
  let port: number;
  let env: string[];
  let credentialsJson: string | undefined;
  let dataMountPath: string;
  let containerCmd: string[] | undefined;
  let containerHealthcheck: ServiceTemplate['healthcheck'] | undefined;

  if (hasTemplate) {
    const templateId = opts.template as string;
    const template = SERVICE_TEMPLATES[templateId];
    if (!template) {
      throw new Error(`Unsupported service template: ${templateId}`);
    }

    type = template.type;
    // Use provided version or default to first available version
    const version = opts.version ?? AVAILABLE_VERSIONS[templateId]?.[0] ?? 'latest';
    // If custom image is also provided, use it instead of the template default
    image = hasImage ? (opts.image as string) : template.image.replace(/:[^:]+$/, `:${version}`);
    port = template.port;
    dataMountPath = this.getDataMountPath(template.type);
    containerCmd = template.cmd;
    containerHealthcheck = template.healthcheck;

    if (template.type === 'redis') {
      env = [...userEnv];
      credentialsJson = JSON.stringify({
        host: this.getContainerName(opts.name),
        port,
        connectionString: this.getConnectionString(
          'redis',
          this.getContainerName(opts.name),
          port,
        ),
      });
    } else if (template.type === 'minio') {
      const user = 'openlander';
      const password = randomBytes(16).toString('hex');
      const containerName = this.getContainerName(opts.name);
      env = [...template.env({ user, password, database: '' }), ...userEnv];
      credentialsJson = JSON.stringify({
        host: containerName,
        port,
        user,
        password,
        connectionString: this.getConnectionString('minio', containerName, port),
      });
    } else {
      const containerName = this.getContainerName(opts.name);
      const credentials = this.buildCredentials(
        template.type as Exclude<BuiltInServiceType, 'redis' | 'minio'>,
        opts.name,
        containerName,
        port,
      );
      env = [...template.env(credentials), ...userEnv];
      credentialsJson = JSON.stringify(credentials);
    }
  } else {
    if (!opts.image) {
      throw new Error('image is required when template is not provided');
    }
    if (opts.port === undefined) {
      throw new Error('port is required when using custom image');
    }

    type = this.extractTypeFromImage(opts.image);
    image = opts.image;
    port = opts.port;
    env = userEnv;
    credentialsJson = undefined;
    dataMountPath = '/data';
    containerCmd = undefined;
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid service port: ${String(port)}`);
  }

  const containerPort = port;
  // Given no explicit env context, use production port policy for services.
  const hostPort = await allocatePort(this.db, this.docker, {}, 'production');

  const id = nanoid(12);
  const containerName = this.getContainerName(opts.name);
  const volumeName = this.getVolumeName(opts.name);

  await this.docker.pullImage(image);

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
  const client = this.docker.getClient();
  await client.createVolume({
    Name: volumeName,
    Labels: {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.ROLE]: 'service',
      [DOCKER_LABELS.SERVICE]: opts.name,
    },
  });

  // Raw createContainer: incompatible with docker.runContainer() — service containers
  // need different labels (ROLE/SERVICE vs PROJECT), custom healthcheck support,
  // explicit volume binds, and 'unless-stopped' restart policy. Consolidation deferred.
  const container = await client.createContainer({
    Image: image,
    name: containerName,
    Env: env,
    ...(containerCmd ? { Cmd: containerCmd } : {}),
    ...(containerHealthcheck
      ? {
          Healthcheck: {
            Test: containerHealthcheck.test,
            Interval: containerHealthcheck.interval * 1_000_000_000,
            Timeout: containerHealthcheck.timeout * 1_000_000_000,
            Retries: containerHealthcheck.retries,
            StartPeriod: containerHealthcheck.startPeriod * 1_000_000_000,
          },
        }
      : {}),
    Labels: {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.ROLE]: 'service',
      [DOCKER_LABELS.SERVICE]: opts.name,
    },
    ExposedPorts: {
      [`${String(containerPort)}/tcp`]: {},
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [SHARED_NETWORK_NAME]: { Aliases: [opts.name] },
      },
    },
    HostConfig: {
      NetworkMode: this.docker.getNetworkName(),
      RestartPolicy: { Name: 'unless-stopped' },
      Binds: [`${volumeName}:${dataMountPath}`],
      PortBindings: {
        [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
      },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
    },
  });

  await container.start();

  const primaryNetwork = this.docker.getNetworkName();
  const additionalNetworks = [SHARED_NETWORK_NAME].filter(
    (networkName) => networkName !== primaryNetwork,
  );

  for (const networkName of additionalNetworks) {
    try {
      await this.docker.connectContainerToNetwork(container.id, networkName, [opts.name]);
    } catch (err) {
      log.warn(
        { err, networkName, containerName },
        'Failed to connect service to additional network',
      );
    }
  }

  this.db.createService({
    id,
    name: opts.name,
    type,
    image,
    containerName,
    port: hostPort,
    envVars: userEnvJson,
    credentials: credentialsJson,
  });

  this.db.updateService(id, { status: 'running', containerId: container.id });
  this.invalidateServiceCardSummaryCache();
  const created = this.db.getService(id);
  if (!created) {
    throw new Error(`Failed to create service: ${id}`);
  }
  return created;
}

async start(id: string): Promise<void> {
  const service = this.db.getService(id);
  if (!service) {
    throw new Error(`Service not found: ${id}`);
  }

  const containerId = service.container_id ?? service.container_name;
  await this.docker.startContainer(containerId);
  this.db.updateService(id, { status: 'running' });
  this.invalidateServiceCardSummaryCache();
}

async stop(id: string): Promise<void> {
  const service = this.db.getService(id);
  if (!service) {
    throw new Error(`Service not found: ${id}`);
  }

  const containerId = service.container_id ?? service.container_name;
  await this.docker.stopContainer(containerId);
  this.db.updateService(id, { status: 'stopped' });
  this.invalidateServiceCardSummaryCache();
}

async remove(
  id: string,
  options?: { force?: boolean },
): Promise<{ warning?: string; connected_projects?: Array<{ id: string; name: string }> }> {
  const service = this.db.getService(id);
  if (!service) {
    throw new Error(`Service not found: ${id}`);
  }

  // Check for connected projects before deletion
  const connectedProjects = this.getConnectedProjects(id);
  let warning: string | undefined;
  if (connectedProjects.length > 0) {
    const projectNames = connectedProjects.map((p) => p.name).join(', ');
    const count = String(connectedProjects.length);
    if (!options?.force) {
      throw new Error(
        `Service "${service.name}" is referenced by ${count} project(s): ${projectNames}. ` +
          `Remove the service references from their environment variables first, or use force to remove anyway.`,
      );
    }
    warning = `Service "${service.name}" is connected to ${count} project(s): ${projectNames}. These projects may fail to start if they depend on this service.`;
  }

  const containerId = service.container_id ?? service.container_name;
  try {
    await this.docker.stopContainer(containerId);
  } catch (error) {
    if (!isDockerNotFoundError(error)) {
      throw error;
    }
  }
  try {
    await this.docker.safeRemoveContainer(containerId);
  } catch (error) {
    if (!isDockerNotFoundError(error)) {
      throw error;
    }
  }

  const volumeName = this.getVolumeName(service.name);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
  const client = this.docker.getClient();
  try {
    await client.getVolume(volumeName).remove();
  } catch (error) {
    if (!isDockerNotFoundError(error)) {
      throw error;
    }
  }

  this.db.deleteService(id);
  this.invalidateServiceCardSummaryCache();

  return {
    ...(warning && { warning }),
    ...(connectedProjects.length > 0 && { connected_projects: connectedProjects }),
  };
}

async backup(id: string): Promise<{ backupId: string; path: string; size: number }> {
  const service = this.getRequiredService(id);
  const volumeName = this.getVolumeName(service.name);
  const backupDir = this.getBackupDir();
  const backupId = `${service.name}-${String(Date.now())}`;
  const backupPath = join(backupDir, `${backupId}.tar.gz`);

  mkdirSync(backupDir, { recursive: true });

  // Redis: flush in-memory data to disk (BGSAVE) before volume backup.
  // Without this, the RDB dump file may not exist or be stale, leading to empty backups.
  const isRedis = service.type === 'redis' || service.image.includes('redis');
  if (isRedis) {
    try {
      const initialResult = await execInServiceContainer(this.docker, service, [
        'redis-cli',
        'LASTSAVE',
      ]);
      const initialTimestamp = initialResult.stdout.trim();

      await execInServiceContainer(this.docker, service, ['redis-cli', 'BGSAVE']);

      // Poll LASTSAVE until timestamp changes (max 30s, 1s interval)
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(1000);
        const currentResult = await execInServiceContainer(this.docker, service, [
          'redis-cli',
          'LASTSAVE',
        ]);
        if (currentResult.stdout.trim() !== initialTimestamp) {
          log.info(`Redis BGSAVE completed for service ${service.id}`);
          break;
        }
        if (attempt === 29) {
          log.warn(
            `Redis BGSAVE did not complete within 30s for service ${service.id}, proceeding with backup`,
          );
        }
      }
    } catch (error) {
      log.warn(
        `Redis BGSAVE failed for service ${service.id}, proceeding with backup: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await this.docker.pullImage('alpine');

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
  const client = this.docker.getClient();
  // Raw createContainer: ephemeral backup container (AutoRemove, no port/network/labels)
  // is incompatible with docker.runContainer(). Consolidation deferred.
  const container = await client.createContainer({
    Image: 'alpine',
    Cmd: ['tar', 'czf', `/backup/${backupId}.tar.gz`, '-C', '/data', '.'],
    HostConfig: {
      Binds: [`${volumeName}:/data:ro`, `${backupDir}:/backup`],
      AutoRemove: true,
    },
  });

  await container.start();
  const waitResult: unknown = await container.wait();
  const backupExitCode =
    waitResult && typeof waitResult === 'object' && 'StatusCode' in waitResult
      ? (waitResult as { StatusCode: number }).StatusCode
      : 1;
  if (backupExitCode !== 0) {
    throw new Error(
      `Backup failed with exit code ${String(backupExitCode)} for service: ${service.id}`,
    );
  }

  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found after backup: ${backupPath}`);
  }
  const size = statSync(backupPath).size;

  return { backupId, path: backupPath, size };
}

async restore(id: string, backupId: string): Promise<void> {
  const service = this.getRequiredService(id);
  const backupDir = this.getBackupDir();
  const backupFilename = `${backupId}.tar.gz`;
  const backupPath = join(backupDir, backupFilename);
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }

  const volumeName = this.getVolumeName(service.name);
  await this.stop(id);

  try {
    await this.docker.pullImage('alpine');
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
    const client = this.docker.getClient();
    // Raw createContainer: ephemeral restore container (AutoRemove, no port/network/labels)
    // is incompatible with docker.runContainer(). Consolidation deferred.
    const container = await client.createContainer({
      Image: 'alpine',
      Cmd: ['sh', '-c', `rm -rf /data/* && tar xzf /backup/${backupFilename} -C /data`],
      HostConfig: {
        Binds: [`${volumeName}:/data`, `${backupDir}:/backup:ro`],
        AutoRemove: true,
      },
    });

    await container.start();
    const waitResult: unknown = await container.wait();
    const restoreExitCode =
      waitResult && typeof waitResult === 'object' && 'StatusCode' in waitResult
        ? (waitResult as { StatusCode: number }).StatusCode
        : 1;
    if (restoreExitCode !== 0) {
      throw new Error(
        `Restore failed with exit code ${String(restoreExitCode)} for service: ${service.id}`,
      );
    }
  } finally {
    await this.start(id);
  }
}

listBackups(id: string): Array<{ backupId: string; createdAt: Date; sizeBytes: number }> {
  const service = this.getRequiredService(id);
  const backupDir = this.getBackupDir();
  if (!existsSync(backupDir)) {
    return [];
  }

  const prefix = `${service.name}-`;
  const entries = readdirSync(backupDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.tar.gz'))
    .map((name) => {
      const backupId = name.slice(0, -'.tar.gz'.length);
      const timestampRaw = backupId.slice(prefix.length);
      const timestamp = Number.parseInt(timestampRaw, 10);
      const stats = statSync(join(backupDir, name));
      return {
        backupId,
        createdAt: Number.isFinite(timestamp) ? new Date(timestamp) : stats.mtime,
        sizeBytes: stats.size,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return entries;
}

async list(): Promise<ServiceRow[]> {
  const services = this.db.listServices();

  await Promise.all(
    services.map(async (service) => {
      const inspection = await this.inspectServiceContainer(service);
      this.syncServiceStateFromInspection(service, inspection);
    }),
  );

  return this.db.listServices();
}

async getDetail(id: string): Promise<ServiceRow> {
  const service = this.getRequiredService(id);

  if (!service.container_id && !service.container_name) {

exec
/bin/bash -lc "sed -n '240,420p' src/pipeline/traefik.ts" in /home/lee/OpenLander
succeeded in 0ms:
    Image: TRAEFIK_IMAGE,
    name: this.containerName,
    Cmd: [
      '--api.insecure=true',
      '--providers.docker=true',
      '--providers.docker.exposedbydefault=false',
      `--providers.docker.network=${this.networkName}`,
      `--providers.http.endpoint=http://host.docker.internal:${String(this.openLanderPort)}/api/traefik/config`,
      '--providers.http.pollInterval=5s',
      '--entrypoints.web.address=:80',
    ],
    ExposedPorts: {
      '80/tcp': {},
      '8080/tcp': {},
    },
    HostConfig: {
      PortBindings: {
        '80/tcp': [{ HostPort: httpPortStr }],
        '8080/tcp': [{ HostPort: dashboardPortStr }],
      },
      Binds: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
      ...(platform() !== 'darwin' ? { ExtraHosts: ['host.docker.internal:host-gateway'] } : {}),
      NetworkMode: this.networkName,
      RestartPolicy: { Name: 'unless-stopped' },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
    },
    Labels: {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.ROLE]: 'traefik',
    },
  });

  await this.ensureMultiNetwork();
}

private async ensureMultiNetwork(): Promise<void> {
  await this.connectToNetwork(SHARED_NETWORK_NAME);
}

async stop(): Promise<void> {
  try {
    await this.docker.safeRemoveContainer(this.containerName);
  } catch (err) {
    log.warn({ err }, 'Failed to remove Traefik container — may already be removed');
  }
}
}

/**
* Get the hostname for a project.
* Uses sslip.io wildcard DNS so the URL works from any device on the network.
* Falls back to .localhost if no LAN IP is available.
*/
export function getProjectHostname(projectName: string, lanIp?: string): string {
const ip = lanIp ?? getLanIp();
if (ip) {
  return `${projectName}.${ip}.sslip.io`;
}
return `${projectName}.localhost`;
}

export function getEnvironmentProjectHostname(
projectName: string,
_environment: TraefikEnvironment,
lanIp?: string,
): string {
return getProjectHostname(projectName, lanIp);
}

/**
* Get the full internal URL for a project.
*/
export function getProjectUrl(projectName: string, lanIp?: string): string {
return `http://${getProjectHostname(projectName, lanIp)}`;
}

/**
* Build Traefik labels for a project container.
*
* Pattern from Dokploy/openclaw-host-kit:
*   traefik.http.routers.{name}.rule = Host(`{hostname}`)
*   traefik.http.services.{name}.loadbalancer.server.port = {port}
*/
/**
* Get the primary LAN IP address of this machine.
* Prefers LAN IPs over VPN IPs, and skips Docker bridge interfaces.
* Returns undefined if no usable IPv4 address is found.
*/
export function getLanIp(): string | undefined {
const ips = getAllIps();
const first = ips[0];
return first?.address;
}

export interface NetworkIp {
address: string;
interface: string;
/** 'lan' for regular network, 'vpn' for Tailscale/ZeroTier/WireGuard */
type: 'lan' | 'vpn';
}

/**
* Get all non-internal IPv4 addresses.
* Detects LAN IPs and VPN IPs (Tailscale, ZeroTier, WireGuard).
*/
export function getAllIps(): NetworkIp[] {
const hostIp = process.env['HOST_IP'];
const hostVpnIp = process.env['HOST_VPN_IP'];
const dockerHost = process.env['DOCKER_HOST'];

const nets = networkInterfaces();
const detected: NetworkIp[] = [];
const vpnPatterns = /^(tailscale|ts|zt|zerotier|wg|tun|utun)/i;
const dockerPatterns = /^(br-|docker|veth)/i;

for (const name of Object.keys(nets)) {
  for (const net of nets[name] ?? []) {
    if (net.internal || net.family !== 'IPv4') continue;
    if (dockerPatterns.test(name)) continue;
    const isVpn = vpnPatterns.test(name) || net.address.startsWith('100.');
    detected.push({
      address: net.address,
      interface: name,
      type: isVpn ? 'vpn' : 'lan',
    });
  }
}

const result: NetworkIp[] = [];
let dockerHostIp: string | undefined;

if (dockerHost) {
  try {
    const url = new URL(dockerHost);
    if (url.protocol === 'tcp:' || url.protocol === 'ssh:') {
      const host = url.hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        dockerHostIp = host;
      }
    }
  } catch (error) {
    void error;
  }
}

if (hostIp) {
  result.push({ address: hostIp, interface: 'HOST_IP', type: 'lan' });
} else if (dockerHostIp) {
  result.push({ address: dockerHostIp, interface: 'DOCKER_HOST', type: 'lan' });
} else {
  result.push(...detected.filter((ip) => ip.type === 'lan'));
}

if (hostVpnIp) {
  result.push({ address: hostVpnIp, interface: 'HOST_VPN_IP', type: 'vpn' });
} else {
  result.push(...detected.filter((ip) => ip.type === 'vpn'));
}

return result.sort((a, b) => (a.type === 'lan' ? -1 : 1) - (b.type === 'lan' ? -1 : 1));
}

export interface ProjectUrl {
url: string;
type: 'lan' | 'vpn';
ip: string;
}

export function getProjectUrls(projectName: string): ProjectUrl[] {
return getAllIps().map((ip) => ({
  url: `http://${projectName}.${ip.address}.sslip.io`,
  type: ip.type,
  ip: ip.address,
}));
}

export function buildTraefikLabels(
projectName: string,
containerPort: number,
hostname?: string,
_environment: TraefikEnvironment = 'production',

exec
/bin/bash -lc "sed -n '1,220p' src/pipeline/deploy/connectivity-check.ts" in /home/lee/OpenLander
succeeded in 0ms:
import type { Docker } from '../docker.js';

export interface ConnectivityResult {
hostname: string;
port?: number;
dnsResolved: boolean;
tcpReachable: boolean;
error?: string;
}

interface EndpointTarget {
hostname: string;
port?: number;
}

const DEFAULT_PORT_BY_PROTOCOL: Record<string, number> = {
'http:': 80,
'https:': 443,
'postgres:': 5432,
'postgresql:': 5432,
'mysql:': 3306,
'mariadb:': 3306,
'redis:': 6379,
'rediss:': 6379,
'mongodb:': 27017,
'amqp:': 5672,
'amqps:': 5671,
};

function parsePort(value: string | undefined): number | undefined {
if (!value) return undefined;
const parsed = Number.parseInt(value, 10);
if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return undefined;
return parsed;
}

function parseHostValue(rawValue: string): EndpointTarget | null {
const value = rawValue.trim();
if (value.length === 0) return null;

if (value.includes('://')) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.trim();
    const port = parsePort(parsed.port);
    if (hostname.length === 0) return null;
    return { hostname, port };
  } catch {
    return null;
  }
}

if (value.startsWith('[') && value.includes(']')) {
  const closingIndex = value.indexOf(']');
  const hostname = value.slice(1, closingIndex).trim();
  const hasPort = value[closingIndex + 1] === ':';
  const port = hasPort ? parsePort(value.slice(closingIndex + 2)) : undefined;
  return hostname.length > 0 ? { hostname, port } : null;
}

const colonCount = value.split(':').length - 1;
if (colonCount === 1) {
  const [hostPart = '', portPart = ''] = value.split(':');
  const hostname = hostPart.trim();
  const port = parsePort(portPart.trim());
  if (hostname && hostname.length > 0) {
    return { hostname, port };
  }
}

return { hostname: value };
}

function extractEndpointTargets(envVars: Record<string, string>): EndpointTarget[] {
const targets = new Map<string, EndpointTarget>();

for (const [key, value] of Object.entries(envVars)) {
  if (key.endsWith('_URL')) {
    try {
      const parsed = new URL(value);
      const hostname = parsed.hostname.trim();
      if (hostname.length === 0) continue;
      const explicitPort = parsePort(parsed.port);
      const defaultPort = DEFAULT_PORT_BY_PROTOCOL[parsed.protocol];
      const port = explicitPort ?? defaultPort;
      const targetKey = `${hostname}:${port !== undefined ? String(port) : 'none'}`;
      targets.set(targetKey, { hostname, port });
    } catch {
      continue;
    }
    continue;
  }

  if (!key.endsWith('_HOST')) continue;

  const parsed = parseHostValue(value);
  if (!parsed) continue;
  const hostname = parsed.hostname.trim();
  if (hostname.length === 0) continue;

  const inferredPortKey = `${key.slice(0, -5)}_PORT`;
  const inferredPort = parsePort(envVars[inferredPortKey]);
  const port = parsed.port || inferredPort;
  const targetKey = `${hostname}:${port !== undefined ? String(port) : 'none'}`;
  targets.set(targetKey, { hostname, port });
}

return Array.from(targets.values());
}

async function runInContainer(
docker: Docker,
containerId: string,
command: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number; startFailed: boolean }> {
try {
  const result = await docker.execSimple(containerId, command);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    startFailed: false,
  };
} catch (error) {
  return {
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    exitCode: 127,
    startFailed: true,
  };
}
}

function compactErrorText(stderr: string, stdout: string): string | undefined {
const text = stderr.trim() || stdout.trim();
if (text.length === 0) return undefined;
return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export async function checkDeployConnectivity(params: {
docker: Docker;
containerId: string;
envVars: Record<string, string>;
}): Promise<ConnectivityResult[]> {
const { docker, containerId, envVars } = params;
const targets = extractEndpointTargets(envVars);
if (targets.length === 0) return [];

const getentProbe = await runInContainer(docker, containerId, ['getent', 'hosts', 'localhost']);
if (getentProbe.startFailed) return [];

const ncProbe = await runInContainer(docker, containerId, ['nc', '-z', '-w1', '127.0.0.1', '1']);
if (ncProbe.startFailed) return [];

const results: ConnectivityResult[] = [];

for (const target of targets) {
  const dnsCheck = await runInContainer(docker, containerId, [
    'getent',
    'hosts',
    target.hostname,
  ]);
  const dnsResolved = dnsCheck.exitCode === 0;

  if (!dnsResolved) {
    results.push({
      hostname: target.hostname,
      port: target.port,
      dnsResolved: false,
      tcpReachable: false,
      error: compactErrorText(dnsCheck.stderr, dnsCheck.stdout),
    });
    continue;
  }

  if (target.port === undefined) {
    results.push({
      hostname: target.hostname,
      dnsResolved: true,
      tcpReachable: false,
      error: 'Port not specified',
    });
    continue;
  }

  const tcpCheck = await runInContainer(docker, containerId, [
    'nc',
    '-z',
    '-w2',
    target.hostname,
    String(target.port),
  ]);
  const tcpReachable = tcpCheck.exitCode === 0;
  results.push({
    hostname: target.hostname,
    port: target.port,
    dnsResolved: true,
    tcpReachable,
    error: tcpReachable ? undefined : compactErrorText(tcpCheck.stderr, tcpCheck.stdout),
  });
}

return results;
}

codex
The main risk areas look concentrated in `execSimple` reuse and the recovery/service migrations. I’m comparing previous behavior where the abstractions now flatten details, especially timeouts, output truncation, and env var serialization.
exec
/bin/bash -lc "git show 2504caf:src/pipeline/service-adapters/shared.ts | sed -n '1,220p'" in /home/lee/OpenLander
succeeded in 0ms:
import { PassThrough } from 'node:stream';

import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';
import type { ContainerExecResult, ServiceCredentials } from './types.js';

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_024 * 1_024; // 1 MB

export interface ExecOptions {
throwOnNonZeroExit?: boolean;
timeoutMs?: number;
maxOutputBytes?: number;
}

export async function execInServiceContainer(
docker: Docker,
service: ServiceRow,
command: string[],
options?: ExecOptions,
): Promise<ContainerExecResult> {
const client = docker.getClient();
const containerId = service.container_id ?? service.container_name;
const container = client.getContainer(containerId);
const exec = await container.exec({
  Cmd: command,
  AttachStdin: false,
  AttachStdout: true,
  AttachStderr: true,
  Tty: false,
});

const timeoutMs = options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
const maxBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

const stream = await exec.start({ hijack: false, stdin: false });
const stdoutChunks: Buffer[] = [];
const stderrChunks: Buffer[] = [];
const state = { stdoutSize: 0, stderrSize: 0, truncated: false, timedOut: false };
const stdoutStream = new PassThrough();
const stderrStream = new PassThrough();

stdoutStream.on('data', (chunk: Buffer) => {
  if (state.stdoutSize < maxBytes) {
    const remaining = maxBytes - state.stdoutSize;
    stdoutChunks.push(remaining >= chunk.length ? chunk : chunk.subarray(0, remaining));
  } else {
    state.truncated = true;
  }
  state.stdoutSize += chunk.length;
});
stderrStream.on('data', (chunk: Buffer) => {
  if (state.stderrSize < maxBytes) {
    const remaining = maxBytes - state.stderrSize;
    stderrChunks.push(remaining >= chunk.length ? chunk : chunk.subarray(0, remaining));
  } else {
    state.truncated = true;
  }
  state.stderrSize += chunk.length;
});

client.modem.demuxStream(stream, stdoutStream, stderrStream);

const streamDone = new Promise<void>((resolve, reject) => {
  stream.on('error', reject);
  stream.on('end', resolve);
});

const timer = setTimeout(() => {
  state.timedOut = true;
  stream.destroy();
}, timeoutMs);

try {
  await streamDone;
} catch {
  if (!state.timedOut) throw new Error(`Exec stream error for service: ${service.id}`);
} finally {
  clearTimeout(timer);
}

if (state.timedOut) {
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr, exitCode: -1, truncated: true };
}

const info = await exec.inspect();
const exitCode = info.ExitCode;
if (typeof exitCode !== 'number') {
  throw new Error(`Container command did not report an exit code for service: ${service.id}`);
}

const stdout = Buffer.concat(stdoutChunks).toString('utf8');
const stderr = Buffer.concat(stderrChunks).toString('utf8');

if (options?.throwOnNonZeroExit !== false && exitCode !== 0) {
  const commandText = command.join(' ');
  const output = stderr.trim() || stdout.trim();
  throw new Error(
    `Container command failed (${commandText}) with exit code ${String(exitCode)}${output ? `: ${output}` : ''}`,
  );
}

return { stdout, stderr, exitCode, ...(state.truncated ? { truncated: true } : {}) };
}

export function parseServiceCredentials(service: ServiceRow): ServiceCredentials {
if (!service.credentials) {
  throw new Error(`Service credentials not available: ${service.id}`);
}

let parsed: unknown;
try {
  parsed = JSON.parse(service.credentials);
} catch (_err) {
  throw new Error(`Invalid service credentials: ${service.id}`);
}

if (typeof parsed !== 'object' || parsed === null) {
  throw new Error(`Incomplete service credentials: ${service.id}`);
}

const record = parsed as Record<string, unknown>;
if (
  typeof record['user'] !== 'string' ||
  typeof record['password'] !== 'string' ||
  typeof record['database'] !== 'string'
) {
  throw new Error(`Incomplete service credentials: ${service.id}`);
}

return {
  user: record['user'],
  password: record['password'],
  database: record['database'],
};
}

export function assertSafeDatabaseName(name: string): void {
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
  throw new Error(`Invalid database name: ${name}`);
}
}

export function assertSafeUserName(username: string): void {
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(username)) {
  throw new Error(`Invalid username: ${username}`);
}
}

export function quoteSqlLiteral(value: string): string {
return `'${value.replace(/'/g, "''")}'`;
}

export { sleep } from '../../lib/sleep.js';

exec
/bin/bash -lc "git show 2504caf:src/pipeline/recover.ts | sed -n '100,220p'" in /home/lee/OpenLander
succeeded in 0ms:
dryRun: boolean,
): Promise<RecoverItemResult<ServiceStatus>> {
const cName = serviceContainerName(service.name);
const vName = serviceVolumeName(service.name);

try {
  // Check if container already exists
  const container = await containerExists(ctx, cName);
  if (container.exists && container.running) {
    return { name: service.name, status: 'running' };
  }
  if (container.exists && !container.running) {
    if (!dryRun) {
      await ctx.docker.startContainer(cName);
      ctx.db.updateService(service.id, { status: 'running' });
    }
    return { name: service.name, status: 'started' };
  }

  // Container doesn't exist — recreate
  if (dryRun) {
    return { name: service.name, status: 'recreated' };
  }

  // Ensure volume (preserve existing data!)
  const volExists = await volumeExists(ctx, vName);
  if (!volExists) {
    await ctx.docker.getClient().createVolume({
      Name: vName,
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.ROLE]: 'service',
        [DOCKER_LABELS.SERVICE]: service.name,
      },
    });
  }

  // Ensure image
  const hasImage = await imageExists(ctx, service.image);
  if (!hasImage) {
    await ctx.docker.pullImage(service.image);
  }

  // Parse stored env vars
  const envVars: string[] = service.env_vars ? (JSON.parse(service.env_vars) as string[]) : [];

  // Get template config
  const template = SERVICE_TEMPLATES[service.type];
  const containerPort = getServiceContainerPort(service);
  const dataMountPath = getDataMountPath(service.type);

  // Create container
  const client = ctx.docker.getClient();
  const newContainer = await client.createContainer({
    Image: service.image,
    name: cName,
    Env: envVars,
    ...(template?.cmd ? { Cmd: template.cmd } : {}),
    ...(template?.healthcheck
      ? {
          Healthcheck: {
            Test: template.healthcheck.test,
            Interval: template.healthcheck.interval * 1_000_000_000,
            Timeout: template.healthcheck.timeout * 1_000_000_000,
            Retries: template.healthcheck.retries,
            StartPeriod: template.healthcheck.startPeriod * 1_000_000_000,
          },
        }
      : {}),
    Labels: {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.ROLE]: 'service',
      [DOCKER_LABELS.SERVICE]: service.name,
    },
    ExposedPorts: {
      [`${String(containerPort)}/tcp`]: {},
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [SHARED_NETWORK_NAME]: { Aliases: [service.name] },
      },
    },
    HostConfig: {
      NetworkMode: ctx.docker.getNetworkName(),
      RestartPolicy: { Name: 'unless-stopped' },
      Binds: [`${vName}:${dataMountPath}`],
      PortBindings: {
        [`${String(containerPort)}/tcp`]: [{ HostPort: String(service.port) }],
      },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
    },
  });

  await newContainer.start();

  // Connect to shared network if different from primary
  const primaryNetwork = ctx.docker.getNetworkName();
  if (primaryNetwork !== SHARED_NETWORK_NAME) {
    try {
      const sharedNet = client.getNetwork(SHARED_NETWORK_NAME);
      await sharedNet.connect({
        Container: newContainer.id,
        EndpointConfig: { Aliases: [service.name] },
      });
    } catch {
      // best-effort — may already be connected via NetworkingConfig
    }
  }

  ctx.db.updateService(service.id, { status: 'running', containerId: newContainer.id });

  log.info({ service: service.name }, 'Service recovered');
  return { name: service.name, status: 'recreated' };
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  log.error({ service: service.name, error: msg }, 'Failed to recover service');
  return { name: service.name, status: 'error', error: msg };
}
}

async function recoverProject(

exec
/bin/bash -lc "rg -n \"envVars: userEnvJson|env_vars|JSON.stringify\\(opts.envVars|JSON.stringify\\(env\\)|service\\.env_vars\" src test | head -n 200" in /home/lee/OpenLander
succeeded in 0ms:
test/ops-drift.test.ts:19:    env_vars: partial?.env_vars ?? null,
test/web-routes.test.ts:572:          env_vars: {
test/web-routes.test.ts:952:        env_vars: null,
test/web-routes.test.ts:1252:        env_vars: customEnv,
src/pipeline/auto-recovery.ts:852:    const message = `Hardcoded secrets detected in ${payload.projectName}:\n${list}\nAdvise user to move these to environment variables using set_env_vars.`;
src/pipeline/recover.ts:147:    const rawEnvVars: string[] = service.env_vars ? (JSON.parse(service.env_vars) as string[]) : [];
test/environments.test.ts:137:      CREATE TABLE env_vars (
test/environments.test.ts:165:      .prepare('INSERT INTO env_vars (id, project_id, key, value) VALUES (?, ?, ?, ?)')
test/environments.test.ts:185:      inspector.prepare("PRAGMA table_info('env_vars')").all() as Array<{ name: string }>
test/service-manager-extended.test.ts:30:    env_vars: partial.env_vars ?? null,
test/infra-analyzer.test.ts:20:    env_vars: partial.env_vars ?? null,
test/pipeline/image-deploy-e2e.test.ts:16:  const envVars = parsed.env_vars
test/pipeline/image-deploy-e2e.test.ts:17:    ? (JSON.parse(parsed.env_vars) as Record<string, string>)
test/pipeline/image-deploy-e2e.test.ts:78:      env_vars: '{"NODE_ENV":"production"}',
test/pipeline/image-deploy-e2e.test.ts:115:      env_vars: '{"NODE_ENV":"production","LOG_LEVEL":"info"}',
src/pipeline/recovery-dispatch.ts:261:What you can do: Use ask_user_question to ask the user for the missing value, then call set_env_vars to set it, then create_deploy_plan and execute_deploy_plan to retry.
src/pipeline/recovery-dispatch.ts:262:Allowed tools: ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan, debug_build_error
src/pipeline/recovery-dispatch.ts:266:      'set_env_vars',
src/pipeline/recovery-dispatch.ts:283:What you can do: Call debug_build_error to get AI diagnosis of the build failure. If it's a missing env var, use ask_user_question + set_env_vars. If it's a Dockerfile issue, the pipeline will auto-fix on retry. Call create_deploy_plan and execute_deploy_plan to retry after fixing.
src/pipeline/recovery-dispatch.ts:284:Allowed tools: debug_build_error, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan, get_logs
src/pipeline/recovery-dispatch.ts:289:      'set_env_vars',
src/pipeline/recovery-dispatch.ts:343:Allowed tools: get_logs, debug_build_error, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
src/pipeline/recovery-dispatch.ts:349:      'set_env_vars',
src/pipeline/recovery-dispatch.ts:388:Allowed tools: get_logs, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
src/pipeline/recovery-dispatch.ts:393:      'set_env_vars',
src/pipeline/recovery-dispatch.ts:442:Allowed tools: get_logs, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
src/pipeline/recovery-dispatch.ts:447:      'set_env_vars',
test/service-manager-backup.test.ts:44:    env_vars: partial.env_vars ?? null,
src/pipeline/service-manager.ts:164:   * can auto-link it to a project via set_env_vars.
src/pipeline/service-manager.ts:325:    const userEnvJson = opts.envVars ? JSON.stringify(opts.envVars) : undefined;
src/pipeline/service-manager.ts:497:      envVars: userEnvJson,
test/env-roundtrip.test.ts:63:describe('set_env_vars round-trip verification', () => {
test/env-roundtrip.test.ts:67:      names: ['set_env_vars'],
test/env-roundtrip.test.ts:68:    }).find((entry) => entry.name === 'set_env_vars');
test/env-roundtrip.test.ts:71:      throw new Error('set_env_vars tool not found');
test/env-roundtrip.test.ts:77:  it('set_env_vars returns error when round-trip verification fails', async () => {
test/env-roundtrip.test.ts:147:      names: ['set_env_vars', 'list_env_vars', 'get_env_var'],
test/env-roundtrip.test.ts:162:  it('MCP set_env_vars → HTTP getAllWithInheritance shows the vars', async () => {
test/env-roundtrip.test.ts:163:    const setTool = getTool('set_env_vars');
test/env-roundtrip.test.ts:173:  it('HTTP setBulk with envId → MCP list_env_vars shows the vars', async () => {
test/env-roundtrip.test.ts:176:    const listTool = getTool('list_env_vars');
test/env-roundtrip.test.ts:199:    const setTool = getTool('set_env_vars');
test/env-roundtrip.test.ts:209:    const listTool = getTool('list_env_vars');
test/web/tool-result-card.test.tsx:202:        env_vars: { API_KEY: 'secret', PASSWORD: 'pw' },
test/web/tool-result-card.test.tsx:233:  it('renders get_system_stats from percent aliases and set_env_vars fallback keys', () => {
test/web/tool-result-card.test.tsx:254:      toolName: 'set_env_vars',
src/pipeline/env.ts:8: *   - **Project env vars**: per-project, stored as plaintext in `env_vars` table.
test/helpers/web-route-mocks.ts:115:    env_vars: null,
test/tool-registry.test.ts:21:  'list_env_vars',
test/tool-registry.test.ts:22:  'set_env_vars',
test/tool-registry.test.ts:295:  it('set_env_vars redeploys only when env changed and project is running', async () => {
test/tool-registry.test.ts:312:    const setEnvVars = getTool(ctx, 'set_env_vars');
test/tool-registry.test.ts:344:  it('list_env_vars returns masked variables for a project', async () => {
test/tool-registry.test.ts:360:    const listEnvVars = getTool(ctx, 'list_env_vars');
test/tool-registry.test.ts:377:  it('set_env_vars throws on malformed JSON and does not redeploy', async () => {
test/tool-registry.test.ts:393:    const setEnvVars = getTool(ctx, 'set_env_vars');
test/mcp-service-tools.test.ts:25:    env_vars: partial.env_vars ?? null,
test/mcp-service-tools.test.ts:165:          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
test/mcp-service-tools.test.ts:219:          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
test/mcp-service-tools.test.ts:268:          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
test/volume-minio.test.ts:43:    env_vars: partial.env_vars ?? null,
test/network-service-integration.test.ts:23:    env_vars: partial.env_vars ?? null,
test/mcp/tool-registry-snapshot.test.ts:58:  'list_env_vars',
test/mcp/tool-registry-snapshot.test.ts:79:  'set_env_vars',
test/domain-routes.test.ts:121:            await onEvent({ type: 'tool_call', toolName: 'list_env_vars', arguments: {} });
src/llm/decision.ts:21:  'list_env_vars',
test/tools/image-schema.test.ts:111:      env_vars: '{"NODE_ENV":"production","DEBUG":"false"}',
test/tools/image-schema.test.ts:122:      expect(result.data.env_vars).toBe('{"NODE_ENV":"production","DEBUG":"false"}');
src/llm/prompts.ts:180:| Set/update env variables      | set_env_vars         | Auto-redeploys if project is running.    |
src/llm/prompts.ts:208:   - If env keys are known, call set_env_vars before deploy (for example DATABASE_URL, REDIS_URL).
src/llm/prompts.ts:215:3. set_env_vars -> set DATABASE_URL to postgres-main host
src/llm/prompts.ts:222:3. list_services + set_env_vars -> map REDIS_URL/DB_URL for selected services
src/llm/prompts.ts:270:1. Call set_env_vars (auto-redeploys)
src/llm/prompts.ts:285:5. After user confirmation, call set_env_vars ONCE with the full final key-value map.
src/llm/prompts.ts:463:     - Missing env vars or missing env_file (keywords like "undefined", "required", "not set") → ask_user_question for missing keys/pattern choice → set_env_vars or chosen config path → create_deploy_plan + execute_deploy_plan
src/llm/prompts.ts:466:     - Runtime crash (keywords like "exit code", "healthcheck failed") → present options, choose via ask_user_question, then set_env_vars/restart_project/create_deploy_plan + execute_deploy_plan as appropriate
src/llm/prompts.ts:474:    - Call set_env_vars with only the missing keys/values
src/llm/prompts.ts:479:7. Available tools for recovery: get_deploy_status, debug_build_error, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan, restart_project, get_logs, get_system_stats
src/llm/prompts.ts:498:3. Once provided, call set_env_vars with the new key-value pairs
src/llm/prompts.ts:506:4. Once provided, call set_env_vars to store as environment variables
test/tools/env-source.test.ts:12:describe('list_env_vars tool', () => {
test/tools/env-source.test.ts:25:    listEnvVarsTool = envToolDefs.find((tool) => tool.name === 'list_env_vars')!;
src/db/types.ts:126:  env_vars: string | null;
src/mcp/prompts.ts:51:    - Call \`set_env_vars\` on the project with the suggested key/value to link the service.
src/mcp/prompts.ts:52:3. **Deploy** — \`create_deploy_plan\` with the repo URL, then \`execute_deploy_plan\`. Add \`env_vars\` for any additional config.
src/mcp/prompts.ts:64:set_env_vars({ project_name: "myapp", variables: '{"DATABASE_URL": "postgresql://..."}' })
src/mcp/prompts.ts:87:2. **Forgetting to redeploy after set_env_vars** — Env changes only take effect on next deploy.
src/mcp/prompts.ts:103:No special configuration needed — just pass them via env_vars in create_deploy_plan or set_env_vars.
src/mcp/prompts.ts:127:- \`NEXT_PUBLIC_*\` env vars are automatically injected as Docker build args — just pass them via env_vars.
src/tools/defs/schemas.ts:16:  env_vars: z
src/tools/defs/schemas.ts:520:    env_vars: z
src/tools/defs/schemas.ts:586:    env_vars: z
src/tools/defs/service.ts:87:      'Create a new service (database, cache, message broker, object storage, or custom container). Use when user needs a PostgreSQL, MySQL, Redis, MongoDB, RabbitMQ, MinIO (S3-compatible storage), or custom Docker image service. Provide template (postgresql/mysql/redis/mongodb/rabbitmq/minio), custom image with port, or BOTH template + image to get auto-credentials with a custom image (e.g., template="postgresql" + image="pgvector/pgvector:pg17" gives you PostgreSQL credential generation with the pgvector image). Returns { service, suggested_env } — suggested_env contains the recommended env var key/value (e.g. DATABASE_URL, RABBITMQ_URL, S3_ENDPOINT) for connecting a project. For MinIO: returns S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY. Call set_env_vars with the suggested key/value to auto-link. Errors: INVALID_TEMPLATE, MISSING_PORT_FOR_CUSTOM_IMAGE.',
src/tools/defs/service.ts:115:            'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
src/tools/defs/env.ts:32:    name: 'list_env_vars',
src/tools/defs/env.ts:67:    name: 'set_env_vars',
src/mcp/composite-tools.ts:69:  'list_env_vars',
src/mcp/composite-tools.ts:71:  'set_env_vars',
src/db/migration.ts:110:  const envVarColumns = sqlite.prepare("PRAGMA table_info('env_vars')").all() as Array<{
src/db/migration.ts:115:    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'env_vars'")
src/db/migration.ts:125:    sqlite.exec(`CREATE TABLE env_vars_migrated (
src/db/migration.ts:133:    sqlite.exec(`INSERT INTO env_vars_migrated (
src/db/migration.ts:147:    FROM env_vars`);
src/db/migration.ts:148:    sqlite.exec('DROP TABLE env_vars');
src/db/migration.ts:149:    sqlite.exec('ALTER TABLE env_vars_migrated RENAME TO env_vars');
src/db/migration.ts:152:      'ALTER TABLE env_vars ADD COLUMN environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE',
src/db/migration.ts:156:  sqlite.exec('DROP INDEX IF EXISTS idx_env_vars_project');
src/db/migration.ts:157:  sqlite.exec('DROP INDEX IF EXISTS idx_env_vars_environment');
src/db/migration.ts:159:    'CREATE UNIQUE INDEX IF NOT EXISTS env_vars_project_key_global_unique ON env_vars(project_id, key) WHERE environment_id IS NULL',
src/db/migration.ts:162:    'CREATE UNIQUE INDEX IF NOT EXISTS env_vars_project_environment_key_unique ON env_vars(project_id, environment_id, key) WHERE environment_id IS NOT NULL',
src/db/migration.ts:164:  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id)');
src/db/migration.ts:165:  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_environment ON env_vars(environment_id)');
src/db/migration.ts:246:    env_vars TEXT,
src/db/migration.ts:283:    const envVarsSelect = svcColNames.has('env_vars') ? 'env_vars' : 'NULL';
src/db/migration.ts:294:      env_vars TEXT,
src/db/migration.ts:308:      env_vars,
src/db/migration.ts:346:  } else if (!svcColNames.has('env_vars')) {
src/db/migration.ts:347:    sqlite.exec('ALTER TABLE services ADD COLUMN env_vars TEXT');
src/mcp/server.ts:82:Key actions: list_projects, redeploy_project, set_env_vars, archive_project, enable_webhook, expose_public
src/tools/defs/deploy-plan.ts:58:      const envVarsRaw = (args['env_vars'] as string | undefined) ?? undefined;
src/tools/defs/deploy-plan.ts:248:      const envVarsRaw = (args['env_vars'] as string | undefined) ?? undefined;
src/tools/defs/deploy-plan.ts:279:              'Or call deploy again with env_vars including the missing keys',
src/tools/defs/deploy-plan.ts:583:            name: 'env_vars',
src/tools/defs/deploy-plan.ts:593:            name: 'env_vars',
src/tools/defs/deploy-plan.ts:602:          name: 'env_vars',
src/tools/defs/deploy-plan.ts:608:      const hasEnvIssues = checks.some((c) => c.name === 'env_vars');
src/tools/defs/deploy-plan.ts:611:          name: 'env_vars',
src/tools/defs/platform-debug.ts:20:const FORBIDDEN_TABLES = new Set(['global_secrets', 'oauth_tokens', 'secret_files', 'env_vars']);
src/db/schema.ts:55:CREATE TABLE IF NOT EXISTS env_vars (
src/db/schema.ts:147:   env_vars TEXT,
src/db/schema.ts:190:CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id);
src/ipc/client.ts:262:      env_vars: options?.envVars,
src/db/schema.drizzle.ts:101:  'env_vars',
src/db/schema.drizzle.ts:115:    uniqueIndex('env_vars_project_key_unique').on(table.project_id, table.key),
src/db/schema.drizzle.ts:116:    index('idx_env_vars_project').on(table.project_id),
src/db/schema.drizzle.ts:117:    index('idx_env_vars_environment').on(table.environment_id),
src/db/schema.drizzle.ts:255:    env_vars: text('env_vars'),
src/db/repos/service.repo.ts:34:        env_vars: service.envVars ?? null,
src/web/api/system-routes.ts:154:        env_vars?: Array<{ key: string; value: string }>;
src/web/api/system-routes.ts:188:        envVars: body.env_vars,
src/web/api/domain-routes.ts:149:        'Use existing tools first (scan_project, list_env_vars, get_deploy_status).',
src/web/api/deploy-stream-routes.ts:35:      env_vars?: Record<string, string>;
src/web/api/deploy-stream-routes.ts:81:          envVars: body.env_vars,
src/web/api/deploy-stream-routes.ts:92:          envVars: body.env_vars,
src/web/api/deploy-stream-routes.ts:167:    if (body.env_vars && typeof body.env_vars === 'object') {
src/web/api/deploy-stream-routes.ts:168:      for (const [key, value] of Object.entries(body.env_vars)) {
src/web/api/deploy-stream-routes.ts:203:        envVars: body.env_vars,
src/web/api/project-routes.ts:702:    // If caller provides env_vars, merge them into existing vars before redeploying
src/web/api/project-routes.ts:705:        env_vars?: Record<string, string>;
src/web/api/project-routes.ts:709:      .catch(() => ({ env_vars: undefined, no_cache: undefined, health_check_path: undefined }));
src/web/api/project-routes.ts:710:    if (body.env_vars && typeof body.env_vars === 'object') {
src/web/api/project-routes.ts:711:      for (const [key, value] of Object.entries(body.env_vars)) {

exec
/bin/bash -lc 'npm test -- --runInBand test/pipeline/docker-sandbox.test.ts test/pipeline/docker-methods.test.ts' in /home/lee/OpenLander
exited 1 in 124ms:
file:///home/lee/OpenLander/node_modules/vitest/dist/chunks/cac.CWGDZnXT.js:405
        throw new CACError(`Unknown option \`${name.length > 1 ? `--${name}` : `-${name}`}\``);
              ^

CACError: Unknown option `--runInBand`
  at Command.checkUnknownOptions (file:///home/lee/OpenLander/node_modules/vitest/dist/chunks/cac.CWGDZnXT.js:405:17)
  at CAC.runMatchedCommand (file:///home/lee/OpenLander/node_modules/vitest/dist/chunks/cac.CWGDZnXT.js:605:13)
  at CAC.parse (file:///home/lee/OpenLander/node_modules/vitest/dist/chunks/cac.CWGDZnXT.js:546:12)
  at file:///home/lee/OpenLander/node_modules/vitest/dist/cli.js:29:13
  at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
  at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
  at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.22.0

codex
The new tests didn’t run with the provided `npm test` flags because this repo’s Vitest CLI doesn’t support `--runInBand`. I’m rerunning them directly and checking how `service.env_vars` is actually persisted, since that affects the recovery migration safety.
exec
/bin/bash -lc "sed -n '1,140p' src/db/repos/service.repo.ts" in /home/lee/OpenLander
succeeded in 0ms:
import { desc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { services } from '../schema.drizzle.js';
import type { ServiceRow } from '../types.js';

export class ServiceRepo {
constructor(
  private readonly db: DrizzleClient,
  private readonly sqlite: SqliteDatabase,
) {
  void this.sqlite;
}

createService(service: {
  id: string;
  name: string;
  type: string;
  image: string;
  containerName: string;
  port: number;
  envVars?: string;
  credentials?: string;
}): ServiceRow {
  this.db
    .insert(services)
    .values({
      id: service.id,
      name: service.name,
      type: service.type,
      image: service.image,
      container_name: service.containerName,
      port: service.port,
      env_vars: service.envVars ?? null,
      credentials: service.credentials ?? null,
    })
    .run();

  const created = this.getService(service.id);
  if (!created) throw new Error(`Failed to create service ${service.id}`);
  return created;
}

getService(id: string): ServiceRow | undefined {
  return this.db.select().from(services).where(eq(services.id, id)).get() as
    | ServiceRow
    | undefined;
}

listServices(): ServiceRow[] {
  return this.db.select().from(services).orderBy(desc(services.updated_at)).all() as ServiceRow[];
}

updateService(
  id: string,
  updates: Partial<{
    status: ServiceRow['status'];
    containerId: string | null;
  }>,
): void {
  const setValues: Partial<typeof services.$inferInsert> = {};

  if (updates.status !== undefined) {
    setValues.status = updates.status;
  }
  if (updates.containerId !== undefined) {
    setValues.container_id = updates.containerId;
  }

  if (Object.keys(setValues).length === 0) return;

  this.db
    .update(services)
    .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(services.id, id))
    .run();
}

deleteService(id: string): void {
  this.db.delete(services).where(eq(services.id, id)).run();
}
}

exec
/bin/bash -lc "sed -n '220,340p' src/db/migration.ts" in /home/lee/OpenLander
succeeded in 0ms:
}
sqlite.exec(
  'CREATE INDEX IF NOT EXISTS idx_deploy_logs_environment ON deploy_logs(environment_id)',
);

// global_secrets table (v0.0.10)
sqlite.exec(`CREATE TABLE IF NOT EXISTS global_secrets (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,
  iv TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_global_secrets_key ON global_secrets(key)');

sqlite.exec(`CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  image TEXT NOT NULL,
  status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'error')),
  container_id TEXT,
  container_name TEXT NOT NULL UNIQUE,
  port INTEGER NOT NULL,
  env_vars TEXT,
  credentials TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_services_type ON services(type)');

sqlite.exec(`CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deploy_id TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  severity TEXT,
  percent INTEGER,
  tool_name TEXT,
  action_buttons TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
sqlite.exec(
  'CREATE INDEX IF NOT EXISTS idx_timeline_project ON timeline_events(project_id, created_at)',
);

const svcTable = sqlite
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'services'")
  .get() as { sql: string | null } | undefined;
const svcCols = sqlite.prepare("PRAGMA table_info('services')").all() as Array<{
  name: string;
}>;
const svcColNames = new Set(svcCols.map((c) => c.name));

const hasLegacyTypeCheck =
  typeof svcTable?.sql === 'string' &&
  svcTable.sql.includes("CHECK(type IN ('postgresql', 'mysql', 'redis', 'mongodb'))");

if (hasLegacyTypeCheck) {
  const envVarsSelect = svcColNames.has('env_vars') ? 'env_vars' : 'NULL';

  sqlite.exec(`CREATE TABLE services_migrated (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    image TEXT NOT NULL,
    status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'error')),
    container_id TEXT,
    container_name TEXT NOT NULL UNIQUE,
    port INTEGER NOT NULL,
    env_vars TEXT,
    credentials TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlite.exec(`INSERT INTO services_migrated (
    id,
    name,
    type,
    image,
    status,
    container_id,
    container_name,
    port,
    env_vars,
    credentials,
    created_at,
    updated_at
  ) SELECT
    id,
    name,
    type,
    image,
    status,
    container_id,
    container_name,
    port,
    ${envVarsSelect},
    credentials,
    created_at,
    updated_at
  FROM services`);
  sqlite.exec('DROP TABLE services');
  sqlite.exec('ALTER TABLE services_migrated RENAME TO services');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_services_type ON services(type)');

  // secret_files table (v0.4.2)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS secret_files (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  filename TEXT NOT NULL,
  encrypted_content TEXT NOT NULL,
  iv TEXT NOT NULL,
  mount_path TEXT NOT NULL DEFAULT '/run/secrets',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE

exec
/bin/bash -lc "sed -n '1,220p' test/service-manager-backup.test.ts" in /home/lee/OpenLander
succeeded in 0ms:
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
mockLogger: {
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
},
}));

vi.mock('../src/lib/logger.js', () => ({
createModuleLogger: vi.fn(() => mockLogger),
}));

vi.mock('../src/lib/sleep.js', () => ({
sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', async (importOriginal) => {
const actual = await importOriginal<typeof import('node:fs')>();
return {
  ...actual,
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ size: 12345 })),
};
});

import type { Database, ServiceRow } from '../src/db/index.js';
import { ServiceManager } from '../src/pipeline/service-manager.js';
import { createMockDockerHarness } from './helpers/docker-mocks.js';

function createService(partial: Partial<ServiceRow>): ServiceRow {
return {
  id: partial.id ?? 'svc-1',
  name: partial.name ?? 'shared-pg',
  type: partial.type ?? 'postgresql',
  image: partial.image ?? 'postgres:16-alpine',
  status: partial.status ?? 'running',
  container_id: partial.container_id ?? 'svc-1-container',
  container_name: partial.container_name ?? 'ol-svc-shared-pg',
  port: partial.port ?? 5432,
  env_vars: partial.env_vars ?? null,
  credentials:
    partial.credentials ??
    JSON.stringify({
      user: 'openlander',
      password: 'rootpw',
      database: 'openlander',
    }),
  created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
  updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
};
}

function createDbMock(services: ServiceRow[]): Database {
const byId = new Map(services.map((svc) => [svc.id, svc]));
return {
  getService: vi.fn((id: string) => byId.get(id) ?? null),
  listServices: vi.fn(() => Array.from(byId.values())),
  updateService: vi.fn(),
  deleteService: vi.fn(),
} as unknown as Database;
}

function setupBackupContainerMock(harness: ReturnType<typeof createMockDockerHarness>): void {
harness.client.createContainer.mockResolvedValue({
  id: 'backup-container-id',
  start: vi.fn().mockResolvedValue(undefined),
  wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
});
}

describe('ServiceManager backup Redis BGSAVE', () => {
beforeEach(() => {
  vi.clearAllMocks();
});

it('calls BGSAVE and polls LASTSAVE before volume backup for Redis services', async () => {
  const redis = createService({
    id: 'svc-redis',
    name: 'shared-redis',
    type: 'redis',
    image: 'redis:7-alpine',
    container_id: 'svc-redis-container',
    container_name: 'ol-svc-shared-redis',
    port: 6379,
    credentials: null,
  });

  const dockerHarness = createMockDockerHarness();
  dockerHarness.setContainerRunning('svc-redis-container', true);

  // BGSAVE flow: initial LASTSAVE → BGSAVE → poll LASTSAVE (changed)
  dockerHarness.queueExecResult('svc-redis-container', {
    exitCode: 0,
    stdout: '1000',
  });
  dockerHarness.queueExecResult('svc-redis-container', {
    exitCode: 0,
    stdout: 'Background saving started',
  });
  dockerHarness.queueExecResult('svc-redis-container', {
    exitCode: 0,
    stdout: '1001',
  });

  setupBackupContainerMock(dockerHarness);

  const manager = new ServiceManager(dockerHarness.docker, createDbMock([redis]));
  const result = await manager.backup('svc-redis');

  const commands = dockerHarness.getExecCommands('svc-redis-container');
  expect(commands).toHaveLength(3);
  expect(commands[0]).toEqual(['redis-cli', 'LASTSAVE']);
  expect(commands[1]).toEqual(['redis-cli', 'BGSAVE']);
  expect(commands[2]).toEqual(['redis-cli', 'LASTSAVE']);

  expect(result.size).toBe(12345);
  expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Redis BGSAVE completed'));
});

it('does NOT call BGSAVE for PostgreSQL services', async () => {
  const postgres = createService({
    id: 'svc-pg',
    name: 'shared-pg',
    type: 'postgresql',
    image: 'postgres:16-alpine',
    container_id: 'svc-pg-container',
    container_name: 'ol-svc-shared-pg',
    port: 5432,
  });

  const dockerHarness = createMockDockerHarness();
  dockerHarness.setContainerRunning('svc-pg-container', true);
  setupBackupContainerMock(dockerHarness);

  const manager = new ServiceManager(dockerHarness.docker, createDbMock([postgres]));
  await manager.backup('svc-pg');

  const commands = dockerHarness.getExecCommands('svc-pg-container');
  expect(commands).toHaveLength(0);
});

it('continues backup when BGSAVE fails', async () => {
  const redis = createService({
    id: 'svc-redis',
    name: 'shared-redis',
    type: 'redis',
    image: 'redis:7-alpine',
    container_id: 'svc-redis-container',
    container_name: 'ol-svc-shared-redis',
    port: 6379,
    credentials: null,
  });

  const dockerHarness = createMockDockerHarness();
  dockerHarness.setContainerRunning('svc-redis-container', true);

  // LASTSAVE succeeds, but BGSAVE fails (exit code 1)
  dockerHarness.queueExecResult('svc-redis-container', {
    exitCode: 0,
    stdout: '1000',
  });
  dockerHarness.queueExecResult('svc-redis-container', {
    exitCode: 1,
    stderr: 'ERR BGSAVE failed',
  });

  setupBackupContainerMock(dockerHarness);

  const manager = new ServiceManager(dockerHarness.docker, createDbMock([redis]));
  const result = await manager.backup('svc-redis');

  expect(result.size).toBe(12345);
  expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis BGSAVE failed'));
});
});

exec
/bin/bash -lc 'npx vitest run test/pipeline/docker-sandbox.test.ts test/pipeline/docker-methods.test.ts' in /home/lee/OpenLander
succeeded in 491ms:

RUN  v4.1.0 /home/lee/OpenLander


Test Files  2 passed (2)
    Tests  23 passed (23)
 Start at  09:50:46
 Duration  180ms (transform 122ms, setup 35ms, import 132ms, tests 33ms, environment 0ms)


exec
/bin/bash -lc "sed -n '1160,1325p' src/pipeline/service-manager.ts" in /home/lee/OpenLander
succeeded in 0ms:
    );
  }

  const adapter = new MinioAdapter();
  return adapter.deleteBucket(service, this.docker, bucketName);
}

private getContainerName(name: string): string {
  return serviceContainerName(name);
}

private getVolumeName(name: string): string {
  return serviceVolumeName(name);
}

private getBackupDir(): string {
  return join(this.dataDir, 'backups');
}

private getDataMountPath(type: string): string {
  const adapter = getServiceAdapter(type);
  if (!adapter) {
    return '/data';
  }

  return adapter.getDataMountPath();
}

private buildCredentials(
  type: Exclude<BuiltInServiceType, 'redis' | 'minio'>,
  name: string,
  containerName: string,
  port: number,
): {
  user: string;
  password: string;
  database: string;
  connectionString: string;
  host: string;
  port: number;
} {
  const user = 'openlander';
  const password = randomBytes(16).toString('hex');
  const database = this.toDatabaseName(name);

  return {
    user,
    password,
    database,
    host: containerName,
    port,
    connectionString: this.getConnectionString(type, containerName, port, {
      user,
      password,
      database,
    }),
  };
}

private getConnectionString(
  type: BuiltInServiceType,
  containerName: string,
  port: number,
  creds?: { user: string; password: string; database: string },
): string {
  const adapter = getServiceAdapter(type);
  if (!adapter) {
    throw new Error(`Unsupported service type: ${type}`);
  }

  return adapter.getConnectionString(containerName, port, creds);
}

private toDatabaseName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return normalized.length > 0 ? normalized : 'openlander';
}

private toEnvPairs(envVars?: Array<{ key: string; value: string }>): string[] {
  if (!envVars) {
    return [];
  }

  return envVars.map(({ key, value }) => `${key}=${value}`);
}

private extractTypeFromImage(image: string): string {
  const imageWithoutDigest = image.split('@')[0] ?? image;
  const imageNameWithTag = imageWithoutDigest.split('/').pop() ?? imageWithoutDigest;
  const imageName = imageNameWithTag.split(':')[0] ?? imageNameWithTag;
  const normalized = imageName.trim().toLowerCase();

  return normalized.length > 0 ? normalized : 'custom';
}

private getRequiredService(serviceId: string): ServiceRow {
  const service = this.db.getService(serviceId);
  if (!service) {
    throw new Error(`Service not found: ${serviceId}`);
  }
  return service;
}

private async ensureServiceContainerRunning(service: ServiceRow): Promise<void> {
  const containerId = service.container_id ?? service.container_name;
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
    const info = await this.docker.getClient().getContainer(containerId).inspect();
    if (!info.State.Running) {
      throw new Error(`Service container is not running: ${service.id}`);
    }
  } catch (error) {
    if (isDockerNotFoundError(error)) {
      throw new Error(`Service container not found: ${service.id}`);
    }
    throw error;
  }
}
}

exec
/bin/bash -lc "rg -n \"toEnvPairs\\(|envVars\\?: Array<\\{ key: string; value: string \\}>|createService\\(|env_vars\\) as string\\[]|service\\.env_vars\" src/pipeline/service-manager.ts src test | sed -n '1,200p'" in /home/lee/OpenLander
succeeded in 0ms:
src/pipeline/service-manager.ts:315:    envVars?: Array<{ key: string; value: string }>;
src/pipeline/service-manager.ts:324:    const userEnv = this.toEnvPairs(opts.envVars);
src/pipeline/service-manager.ts:490:    this.db.createService({
src/pipeline/service-manager.ts:1238:  private toEnvPairs(envVars?: Array<{ key: string; value: string }>): string[] {
src/pipeline/recover.ts:147:    const rawEnvVars: string[] = service.env_vars ? (JSON.parse(service.env_vars) as string[]) : [];
test/network-service-integration.test.ts:13:function createService(partial: Partial<ServiceRow>): ServiceRow {
test/network-service-integration.test.ts:68:    db.createService({
test/network-service-integration.test.ts:86:    db.createService({
test/network-service-integration.test.ts:103:    db.createService({
test/network-service-integration.test.ts:111:    db.createService({
test/network-service-integration.test.ts:131:    db.createService({
test/network-service-integration.test.ts:150:    db.createService({
test/network-service-integration.test.ts:167:    db.createService({
test/network-service-integration.test.ts:184:    db.createService({
test/network-service-integration.test.ts:286:    db.createService({
test/network-service-integration.test.ts:294:    db.createService({
test/network-service-integration.test.ts:409:    const service = createService({
test/network-service-integration.test.ts:444:    const service = createService({
test/network-service-integration.test.ts:484:    const service = createService({
test/network-service-integration.test.ts:514:    const service = createService({
test/network-service-integration.test.ts:547:    const svcMigrated = createService({
test/network-service-integration.test.ts:552:    const svcAlready = createService({
src/pipeline/service-manager.ts:315:    envVars?: Array<{ key: string; value: string }>;
src/pipeline/service-manager.ts:324:    const userEnv = this.toEnvPairs(opts.envVars);
src/pipeline/service-manager.ts:490:    this.db.createService({
src/pipeline/service-manager.ts:1238:  private toEnvPairs(envVars?: Array<{ key: string; value: string }>): string[] {
test/service-manager-extended.test.ts:20:function createService(partial: Partial<ServiceRow>): ServiceRow {
test/service-manager-extended.test.ts:80:    const postgres = createService({
test/service-manager-extended.test.ts:110:    const postgres = createService({
test/service-manager-extended.test.ts:144:    const postgres = createService({
test/service-manager-extended.test.ts:184:    const mysql = createService({
test/service-manager-extended.test.ts:220:    const redis = createService({
test/service-manager-extended.test.ts:240:    const redis = createService({
test/service-manager-extended.test.ts:260:    const redis = createService({
test/service-manager-extended.test.ts:280:    const redis = createService({
test/service-manager-extended.test.ts:315:    const service = createService({
test/service-manager-extended.test.ts:342:    const service = createService({ id: 'svc-log', container_id: 'svc-log-container' });
test/service-manager-extended.test.ts:355:    const service = createService({
test/service-manager-extended.test.ts:386:    const service = createService({
test/service-manager-extended.test.ts:418:    const service = createService({
test/service-manager-extended.test.ts:440:    const service = createService({
test/service-manager-extended.test.ts:459:    const service = createService({
test/service-manager-extended.test.ts:480:      createService({
test/service-manager-extended.test.ts:485:      createService({
test/service-manager-extended.test.ts:514:    const service = createService({
test/service-manager-extended.test.ts:544:    const service = createService({
test/service-manager-backup.test.ts:34:function createService(partial: Partial<ServiceRow>): ServiceRow {
test/service-manager-backup.test.ts:81:    const redis = createService({
test/service-manager-backup.test.ts:125:    const postgres = createService({
test/service-manager-backup.test.ts:147:    const redis = createService({
test/volume-minio.test.ts:33:function createService(partial: Partial<ServiceRow>): ServiceRow {
test/volume-minio.test.ts:130:    const service = createService({
test/volume-minio.test.ts:152:    const first = createService({
test/volume-minio.test.ts:164:    const second = createService({
test/volume-minio.test.ts:293:      createService({ id: 'svc-minio', name: 'storage', type: 'minio', port: 9000 }),
src/db/index.ts:161:  createService(service: Parameters<ServiceRepo['createService']>[0]) { return this.serviceRepo.createService(service); }
src/db/repos/service.repo.ts:15:  createService(service: {

exec
/bin/bash -lc "sed -n '1,220p' test/helpers/docker-mocks.ts" in /home/lee/OpenLander
succeeded in 0ms:
import { vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Docker } from '../../src/pipeline/docker.js';

// ---------------------------------------------------------------------------
// Shared Docker mock factories (used by traefik.test.ts, preflight.test.ts)
// ---------------------------------------------------------------------------

export type MockContainer = {
id: string;
name: string;
image: string;
state: string;
status: string;
ports: Array<{ PublicPort?: number }>;
labels: Record<string, string>;
managedByOpenLander: boolean;
composeProject: string | null;
created: number;
};

export type MockExecPlan = {
stdout?: string;
stderr?: string;
exitCode?: number;
};

type MockDockerContainerControl = {
id: string;
inspect: () => Promise<{ Id: string; State: { Running: boolean } }>;
start: () => Promise<void>;
stop: () => Promise<void>;
remove: () => Promise<void>;
exec: (opts?: { Cmd?: string[] }) => Promise<{
  start: () => Promise<NodeJS.ReadableStream>;
  inspect: () => Promise<{ ExitCode: number }>;
}>;
};

export type MockDockerHarness = {
docker: Docker;
client: {
  listContainers: ReturnType<typeof vi.fn>;
  getNetwork: ReturnType<typeof vi.fn>;
  createVolume: ReturnType<typeof vi.fn>;
  createContainer: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  modem: { demuxStream: ReturnType<typeof vi.fn> };
};
createdVolumes: Array<Record<string, unknown>>;
createdContainers: Array<Record<string, unknown>>;
setContainerRunning: (containerId: string, running: boolean) => void;
queueExecResult: (containerId: string, result: MockExecPlan) => void;
getExecCommands: (containerId: string) => string[][];
};

export function createMockContainer(
name: string,
options: {
  image?: string;
  state?: string;
  ports?: Array<{ PublicPort?: number }>;
  labels?: Record<string, string>;
} = {},
): MockContainer {
return {
  id: `container-${name}`,
  name,
  image: options.image ?? 'test-image:latest',
  state: options.state ?? 'running',
  status: 'Up 2 hours',
  ports: options.ports ?? [],
  labels: options.labels ?? {},
  managedByOpenLander: options.labels?.['openlander.managed'] === 'true',
  composeProject: null,
  created: Date.now(),
};
}

export function createMockDocker(containers: MockContainer[] = []): Docker {
return createMockDockerHarness(containers).docker;
}

export function createMockDockerHarness(containers: MockContainer[] = []): MockDockerHarness {
const createdVolumes: Array<Record<string, unknown>> = [];
const createdContainers: Array<Record<string, unknown>> = [];
const runningContainers = new Map<string, boolean>();
const execPlans = new Map<string, MockExecPlan[]>();
const execCommands = new Map<string, string[][]>();
const controls = new Map<string, MockDockerContainerControl>();

const queueExecResult = (containerId: string, result: MockExecPlan) => {
  const queue = execPlans.get(containerId) ?? [];
  queue.push(result);
  execPlans.set(containerId, queue);
};

const setContainerRunning = (containerId: string, running: boolean) => {
  runningContainers.set(containerId, running);
};

const getExecCommands = (containerId: string): string[][] => {
  return execCommands.get(containerId) ?? [];
};

const getNextExecPlan = (containerId: string): Required<MockExecPlan> => {
  const queue = execPlans.get(containerId) ?? [];
  const next = queue.shift();
  execPlans.set(containerId, queue);
  return {
    stdout: next?.stdout ?? '',
    stderr: next?.stderr ?? '',
    exitCode: next?.exitCode ?? 0,
  };
};

const createExecStream = (plan: Required<MockExecPlan>): PassThrough => {
  const stream = new PassThrough() as PassThrough & {
    __stdout?: string;
    __stderr?: string;
  };
  stream.__stdout = plan.stdout;
  stream.__stderr = plan.stderr;
  setTimeout(() => {
    stream.emit('end');
  }, 0);
  return stream;
};

const getContainerControl = (containerId: string): MockDockerContainerControl => {
  const existing = controls.get(containerId);
  if (existing) {
    return existing;
  }

  const control: MockDockerContainerControl = {
    id: containerId,
    inspect: vi.fn(async () => ({
      Id: containerId,
      State: {
        Running: runningContainers.get(containerId) ?? true,
      },
    })),
    start: vi.fn(async () => {
      runningContainers.set(containerId, true);
    }),
    stop: vi.fn(async () => {
      runningContainers.set(containerId, false);
    }),
    remove: vi.fn(async () => undefined),
    exec: vi.fn(async (opts?: { Cmd?: string[] }) => {
      const commands = execCommands.get(containerId) ?? [];
      commands.push(opts?.Cmd ?? []);
      execCommands.set(containerId, commands);
      const plan = getNextExecPlan(containerId);
      return {
        start: vi.fn(async () => createExecStream(plan)),
        inspect: vi.fn(async () => ({ ExitCode: plan.exitCode })),
      };
    }),
  };

  controls.set(containerId, control);
  return control;
};

const client = {
  listContainers: vi.fn().mockResolvedValue([]),
  getNetwork: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
  }),
  createVolume: vi.fn(async (opts: Record<string, unknown>) => {
    createdVolumes.push(opts);
    return { name: opts['Name'] };
  }),
  getVolume: vi.fn((volumeName: string) => ({
    remove: vi.fn().mockResolvedValue(undefined),
  })),
  createContainer: vi.fn(async (opts: Record<string, unknown>) => {
    createdContainers.push(opts);
    const name =
      typeof opts['name'] === 'string' ? opts['name'] : `container-${createdContainers.length}`;
    const id = `${name}-id`;
    runningContainers.set(id, false);
    return {
      id,
      start: vi.fn(async () => {
        runningContainers.set(id, true);
      }),
      exec: getContainerControl(id).exec,
      inspect: getContainerControl(id).inspect,
    };
  }),
  getContainer: vi.fn((containerId: string) => getContainerControl(containerId)),
  modem: {
    demuxStream: vi.fn(
      (stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
        const source = stream as NodeJS.ReadableStream & { __stdout?: string; __stderr?: string };
        if (source.__stdout) {
          stdout.write(Buffer.from(source.__stdout));
        }
        if (source.__stderr) {
          stderr.write(Buffer.from(source.__stderr));
        }
        stdout.end();
        stderr.end();
      },
    ),
  },
};

return {
  docker: {
    listAllContainers: vi.fn().mockResolvedValue(containers),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    startContainer: vi.fn(async (containerId: string) => {
      await getContainerControl(containerId).start();
    }),
    stopContainer: vi.fn(async (containerId: string) => {

exec
/bin/bash -lc "git show 2504caf:src/pipeline/docker.ts | sed -n '430,900p'" in /home/lee/OpenLander
succeeded in 0ms:
  const envArray = Object.entries(options.envVars).map(([k, v]) => `${k}=${v}`);
  const cPort = options.containerPort ?? options.port;
  const extraHosts = await this.resolveExtraHosts();
  const secretBinds = this.writeSecretFiles(options.name, options.secretFiles ?? []);
  const projectName = stripContainerPrefix(options.name);
  const networkMode = options.network ?? this.networkName;
  const networkingConfig =
    networkMode === SHARED_NETWORK_NAME
      ? {
          EndpointsConfig: {
            [SHARED_NETWORK_NAME]: {
              Aliases: [projectName],
            },
          },
        }
      : undefined;
  const volumeBinds = await this.getProjectVolumeBinds(projectName);
  const binds = [...secretBinds, ...volumeBinds];

  const container = await this.client.createContainer({
    Image: options.imageTag,
    name: options.name,
    Env: envArray,
    Labels: {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.PROJECT]: stripContainerPrefix(options.name),
      ...options.traefikLabels,
    },
    ExposedPorts: {
      [`${String(cPort)}/tcp`]: {},
    },
    Cmd: options.cmd,
    NetworkingConfig: networkingConfig,
    HostConfig: {
      PortBindings: {
        [`${String(cPort)}/tcp`]: [{ HostPort: String(options.port) }],
      },
      Binds: binds.length > 0 ? binds : undefined,
      NetworkMode: networkMode,
      RestartPolicy: options.restartPolicy ?? { Name: 'on-failure', MaximumRetryCount: 5 },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
    },
  });

  await container.start();

  await this.connectContainerToSharedNetwork(container.id, projectName);
  return container.id;
}

async runComposeService(opts: RunComposeServiceOptions): Promise<string> {
  const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
  const cPort = opts.containerPort ?? opts.port;
  const extraHosts = await this.resolveExtraHosts();
  const secretBinds = this.writeSecretFiles(opts.name, opts.secretFiles ?? []);
  const projectName = stripContainerPrefix(opts.name);
  const volumeBinds = await this.getProjectVolumeBinds(projectName);
  const binds = [...secretBinds, ...volumeBinds];
  const networkMode = opts.network ?? opts.networks?.[0] ?? this.networkName;

  if (typeof opts.command === 'string' && /[;&|`$(){}]/.test(opts.command)) {
    throw new Error('Command contains disallowed shell metacharacters');
  }

  const command = typeof opts.command === 'string' ? ['sh', '-c', opts.command] : opts.command;
  const restartPolicyName =
    opts.restart === 'no' ||
    opts.restart === 'always' ||
    opts.restart === 'on-failure' ||
    opts.restart === 'unless-stopped'
      ? opts.restart
      : 'unless-stopped';
  const healthcheck = opts.healthcheck
    ? {
        Test:
          typeof opts.healthcheck.test === 'string'
            ? ['CMD-SHELL', opts.healthcheck.test]
            : opts.healthcheck.test,
        ...(opts.healthcheck.interval !== undefined
          ? { Interval: opts.healthcheck.interval * 1_000_000_000 }
          : {}),
        ...(opts.healthcheck.timeout !== undefined
          ? { Timeout: opts.healthcheck.timeout * 1_000_000_000 }
          : {}),
        ...(opts.healthcheck.retries !== undefined ? { Retries: opts.healthcheck.retries } : {}),
        ...(opts.healthcheck.start_period !== undefined
          ? { StartPeriod: opts.healthcheck.start_period * 1_000_000_000 }
          : {}),
      }
    : undefined;

  const container = await this.client.createContainer({
    Image: opts.imageTag,
    name: opts.name,
    Env: envArray,
    Labels: {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.PROJECT]: stripContainerPrefix(opts.name),
      ...opts.traefikLabels,
    },
    ExposedPorts: {
      [`${String(cPort)}/tcp`]: {},
    },
    Cmd: command,
    Entrypoint: opts.entrypoint,
    Healthcheck: healthcheck,
    HostConfig: {
      PortBindings: {
        [`${String(cPort)}/tcp`]: [{ HostPort: String(opts.port) }],
      },
      Binds: binds.length > 0 ? binds : undefined,
      NetworkMode: networkMode,
      RestartPolicy: { Name: restartPolicyName },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
    },
  });

  await container.start();

  await this.connectContainerToSharedNetwork(container.id, projectName);

  const additionalNetworks =
    opts.networks
      ?.slice(1)
      .filter((networkName, index, arr) => arr.indexOf(networkName) === index) ?? [];
  try {
    for (const networkName of additionalNetworks) {
      await this.client.getNetwork(networkName).connect({ Container: container.id });
    }
  } catch (error) {
    try {
      await container.stop();
    } catch {
      /* best-effort */
    }

    try {
      await container.remove({ force: true });
    } catch {
      /* best-effort */
    }

    throw error;
  }

  return container.id;
}

private async connectContainerToSharedNetwork(containerId: string, alias: string): Promise<void> {
  const network = this.client.getNetwork(SHARED_NETWORK_NAME);

  try {
    await network.connect({
      Container: containerId,
      EndpointConfig: { Aliases: [alias] },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('already exists') && !msg.includes('already connected')) {
      throw error;
    }

    const networkInfo = (await network.inspect()) as {
      Containers?: Record<string, { Aliases?: string[] | null }>;
    };
    const containerEndpoint = networkInfo.Containers?.[containerId];
    const currentAliases: string[] = containerEndpoint?.Aliases ?? [];
    if (currentAliases.includes(alias)) {
      return;
    }

    try {
      await network.disconnect({ Container: containerId, Force: false });
    } catch (disconnectError) {
      const disconnectMsg =
        disconnectError instanceof Error ? disconnectError.message : String(disconnectError);
      if (
        !disconnectMsg.includes('is not connected') &&
        !isDockerNotFoundError(disconnectError)
      ) {
        throw disconnectError;
      }
    }

    await network.connect({
      Container: containerId,
      EndpointConfig: { Aliases: [alias] },
    });
  }
}

private writeSecretFiles(containerName: string, files: SecretFileMount[]): string[] {
  if (files.length === 0) return [];

  const secretsDir = join(getDataDir(), 'container-secrets', containerName);
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });

  const binds: string[] = [];
  for (const file of files) {
    const hostPath = join(secretsDir, file.filename);
    writeFileSync(hostPath, file.content, { mode: 0o600 });
    binds.push(`${hostPath}:${file.mountPath}:ro`);
  }
  return binds;
}

private async getProjectVolumeBinds(projectName: string): Promise<string[]> {
  try {
    const result = await this.client.listVolumes({
      filters: {
        label: [
          `${DOCKER_LABELS.MANAGED}=true`,
          `${DOCKER_LABELS.ROLE}=volume`,
          `${DOCKER_LABELS.PROJECT}=${projectName}`,
        ],
      },
    });
    const volumes = Array.isArray(result.Volumes) ? result.Volumes : [];
    const volumeBinds: string[] = [];
    for (const vol of volumes) {
      const name = vol.Name;
      const labels = vol.Labels as Record<string, string> | undefined;
      if (!labels) continue;
      const mountPath = labels[DOCKER_LABELS.MOUNT_PATH];
      if (typeof mountPath === 'string' && mountPath.startsWith('/')) {
        volumeBinds.push(`${name}:${mountPath}:rw`);
      }
    }
    return volumeBinds;
  } catch {
    return [];
  }
}

cleanupSecretFiles(containerName: string): void {
  const secretsDir = join(getDataDir(), 'container-secrets', containerName);
  try {
    rmSync(secretsDir, { recursive: true, force: true });
  } catch (_) {
    /* best-effort */
  }
}

private async resolveExtraHosts(): Promise<string[]> {
  try {
    const info = (await this.client.info()) as {
      OperatingSystem?: string;
    };

    if (info.OperatingSystem?.includes('Docker Desktop')) {
      return [];
    }
  } catch {
    return [];
  }

  // Prefer concrete gateway IP — host-gateway relies on daemon resolution
  // which fails on some configurations (Podman, misconfigured daemons, WSL)
  try {
    const network = (await this.client.getNetwork(this.networkName).inspect()) as {
      IPAM?: { Config?: Array<{ Gateway?: string }> };
    };
    const gateway = network.IPAM?.Config?.[0]?.Gateway;
    if (gateway && /^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
      return [`host.docker.internal:${gateway}`];
    }
  } catch (_) {
    /* network inspect may fail */
  }

  return [];
}

/** Get the first EXPOSE port from a Docker image. Returns undefined if none found. */
async getImageExposedPort(imageTag: string): Promise<number | undefined> {
  try {
    const image = this.client.getImage(imageTag);
    const info = await image.inspect();
    const keys = Object.keys(info.Config.ExposedPorts);
    const first = keys[0]; // e.g. "80/tcp"
    if (!first) return undefined;
    const portStr = first.split('/')[0];
    if (!portStr) return undefined;
    const port = parseInt(portStr, 10);
    return isNaN(port) ? undefined : port;
  } catch (_err) {
    return undefined;
  }
}

/** Stop a running container. */
async stopContainer(containerId: string): Promise<void> {
  try {
    const container = this.client.getContainer(containerId);
    await container.stop();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isDockerNotFoundError(error)) {
      throw new ContainerNotFoundError(containerId);
    }
    // Already stopped is not an error
    if (!msg.includes('is not running')) {
      throw error;
    }
  }
}

/** Start a stopped container. */
async startContainer(containerId: string): Promise<void> {
  try {
    const container = this.client.getContainer(containerId);
    await container.start();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isDockerNotFoundError(error)) {
      throw new ContainerNotFoundError(containerId);
    }
    // Already running is not an error
    if (!msg.includes('is already running') && !msg.includes('already started')) {
      throw error;
    }
  }
}

/** Remove a container (force removes even if running). */
async removeContainer(containerId: string): Promise<void> {
  try {
    const container = this.client.getContainer(containerId);
    await container.remove({ force: true });
  } catch (error) {
    if (isDockerNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

async safeRemoveContainer(containerId: string): Promise<void> {
  try {
    const container = this.client.getContainer(containerId);
    const info = await container.inspect();
    const networks = info.NetworkSettings.Networks;
    for (const net of Object.keys(networks)) {
      try {
        await this.disconnectContainerFromNetwork(containerId, net);
      } catch (disconnectErr) {
        log.warn(
          { containerId, network: net, err: disconnectErr },
          'Failed to disconnect container from network before removal',
        );
      }
    }
  } catch (inspectErr) {
    log.debug({ containerId, err: inspectErr }, 'Container inspect failed during safe removal');
  }
  await this.removeContainer(containerId);
}

async tagImage(sourceTag: string, repo: string, newTag: string): Promise<void> {
  const image = this.client.getImage(sourceTag);
  await image.tag({ repo, tag: newTag });
}

/** Disconnect a container from a network before removal to avoid sandbox cleanup races. */
async disconnectContainerFromNetwork(containerId: string, networkName: string): Promise<void> {
  try {
    const network = this.client.getNetwork(networkName);
    await network.disconnect({ Container: containerId, Force: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('is not connected') || isDockerNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

async ensureProjectNetwork(projectName: string): Promise<string> {
  const networkName = containerName(projectName);

  try {
    await this.client.getNetwork(networkName).inspect();
    return networkName;
  } catch (error) {
    if (!isDockerNotFoundError(error)) {
      throw error;
    }
  }

  try {
    await this.client.createNetwork({ Name: networkName, Driver: 'bridge' });
    return networkName;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('already exists')) {
      return networkName;
    }
    throw error;
  }
}

async removeProjectNetwork(projectName: string): Promise<void> {
  const networkName = containerName(projectName);

  try {
    await this.client.getNetwork(networkName).remove();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isDockerNotFoundError(error)) {
      return;
    }
    if (msg.includes('active endpoints')) {
      log.warn(
        { projectName, networkName, error: msg },
        'Cannot remove project network with active endpoints',
      );
      return;
    }
    throw error;
  }
}

/** Get container logs as a string. */
async getLogs(containerId: string, tail = 100): Promise<string> {
  try {
    const container = this.client.getContainer(containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      follow: false,
    });
    const buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(logs as string);
    return stripDockerStreamHeaders(buffer);
  } catch (error) {
    if (isDockerNotFoundError(error)) {
      throw new ContainerNotFoundError(containerId);
    }
    throw error;
  }
}

/**
 * Wait for a container to stabilize after starting.
 * Detects crash loops (container restarts) and immediate exits.
 * Returns healthy=false if the container crashes within the timeout window.
 */
async waitForHealthy(containerId: string, timeoutMs = 15000): Promise<WaitForHealthyResult> {
  const startTime = Date.now();
  const checkInterval = 2000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const container = this.client.getContainer(containerId);
      const info = await container.inspect();

      if (info.State.Restarting) {
        return {
          healthy: false,
          exitCode: info.State.ExitCode,
          error: `Container is in restart loop (exit code: ${String(info.State.ExitCode)})`,
        };
      }

      if (!info.State.Running && info.State.ExitCode !== 0) {
        return {
          healthy: false,
          exitCode: info.State.ExitCode,
          error: `Container exited with code ${String(info.State.ExitCode)}`,

exec
/bin/bash -lc "sed -n '520,620p' test/network-service-integration.test.ts" in /home/lee/OpenLander
succeeded in 0ms:
  const client = {
    getContainer: () => ({
      inspect: async () => ({
        Id: 'container-stopped',
        State: { Running: false },
        NetworkSettings: { Networks: {} },
      }),
    }),
    getNetwork: () => ({ connect, disconnect }),
  };

  const docker = { getClient: () => client };
  const db = { listServices: () => [service] };
  const manager = new ServiceManager(
    docker as unknown as ConstructorParameters<typeof ServiceManager>[0],
    db as unknown as DatabaseType,
  );

  await manager.reconcileServiceNetworks();

  expect(connect).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
});

it('logs summary with migrated and already-connected counts', async () => {
  const connectContainerToNetwork = vi.fn(async () => undefined);

  const svcMigrated = createService({
    id: 'svc-migrate',
    name: 'migrate-db',
    container_id: 'svc-migrate-container',
  });
  const svcAlready = createService({
    id: 'svc-already',
    name: 'already-db',
    container_id: 'svc-already-container',
  });

  const client = {
    getContainer: (containerRef: string) => ({
      inspect: async () => {
        if (containerRef === 'svc-migrate-container') {
          return {
            Id: 'container-migrate',
            State: { Running: true },
            NetworkSettings: { Networks: {} },
          };
        }
        return {
          Id: 'container-already',
          State: { Running: true },
          NetworkSettings: {
            Networks: {
              [SHARED_NETWORK_NAME]: {
                Aliases: ['already-db'],
              },
            },
          },
        };
      },
    }),
  };

  const docker = { getClient: () => client, connectContainerToNetwork };
  const db = { listServices: () => [svcMigrated, svcAlready] };
  const manager = new ServiceManager(
    docker as unknown as ConstructorParameters<typeof ServiceManager>[0],
    db as unknown as DatabaseType,
  );

  await manager.reconcileServiceNetworks();

  expect(connectContainerToNetwork).toHaveBeenCalledTimes(1);
  expect(connectContainerToNetwork).toHaveBeenCalledWith(
    'container-migrate',
    SHARED_NETWORK_NAME,
    ['migrate-db'],
  );
});
});

exec
/bin/bash -lc "rg -n \"recoverService|recover\\(|safeRemoveContainer|execInServiceContainer|reconcileServiceNetworks|alias updated|runContainer\\(|extraBinds|env_vars\" test src/pipeline | sed -n '1,240p'" in /home/lee/OpenLander
succeeded in 0ms:
src/pipeline/auto-recovery.ts:852:    const message = `Hardcoded secrets detected in ${payload.projectName}:\n${list}\nAdvise user to move these to environment variables using set_env_vars.`;
src/pipeline/recover.ts:100:async function recoverService(
src/pipeline/recover.ts:147:    const rawEnvVars: string[] = service.env_vars ? (JSON.parse(service.env_vars) as string[]) : [];
src/pipeline/recover.ts:161:    await ctx.docker.safeRemoveContainer(cName);
src/pipeline/recover.ts:163:    const containerId = await ctx.docker.runContainer({
src/pipeline/recover.ts:176:      extraBinds: [`${vName}:${dataMountPath}`],
src/pipeline/recover.ts:261:    await ctx.docker.safeRemoveContainer(cName);
src/pipeline/recover.ts:264:    const containerId = await ctx.docker.runContainer({
src/pipeline/recover.ts:291:export async function recover(
src/pipeline/recover.ts:314:    result.services.push(await recoverService(ctx, service, dryRun));
src/pipeline/env.ts:8: *   - **Project env vars**: per-project, stored as plaintext in `env_vars` table.
src/pipeline/preview.ts:114:      const containerId = await this.docker.runContainer({
src/pipeline/preview.ts:197:      await this.docker.safeRemoveContainer(preview.containerId);
src/pipeline/traefik.ts:281:      await this.docker.safeRemoveContainer(this.containerName);
src/pipeline/docker.ts:50:  extraBinds?: string[];
src/pipeline/docker.ts:432:  async runContainer(options: RunContainerOptions): Promise<string> {
src/pipeline/docker.ts:450:    const binds = [...secretBinds, ...volumeBinds, ...(options.extraBinds ?? [])];
src/pipeline/docker.ts:774:  async safeRemoveContainer(containerId: string): Promise<void> {
src/pipeline/docker.ts:1145:   * restartContainer, getNetworkInfo, runContainer, safeRemoveContainer, etc.
src/pipeline/recovery-dispatch.ts:261:What you can do: Use ask_user_question to ask the user for the missing value, then call set_env_vars to set it, then create_deploy_plan and execute_deploy_plan to retry.
src/pipeline/recovery-dispatch.ts:262:Allowed tools: ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan, debug_build_error
src/pipeline/recovery-dispatch.ts:266:      'set_env_vars',
src/pipeline/recovery-dispatch.ts:283:What you can do: Call debug_build_error to get AI diagnosis of the build failure. If it's a missing env var, use ask_user_question + set_env_vars. If it's a Dockerfile issue, the pipeline will auto-fix on retry. Call create_deploy_plan and execute_deploy_plan to retry after fixing.
src/pipeline/recovery-dispatch.ts:284:Allowed tools: debug_build_error, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan, get_logs
src/pipeline/recovery-dispatch.ts:289:      'set_env_vars',
src/pipeline/recovery-dispatch.ts:343:Allowed tools: get_logs, debug_build_error, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
src/pipeline/recovery-dispatch.ts:349:      'set_env_vars',
src/pipeline/recovery-dispatch.ts:388:Allowed tools: get_logs, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
src/pipeline/recovery-dispatch.ts:393:      'set_env_vars',
src/pipeline/recovery-dispatch.ts:442:Allowed tools: get_logs, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
src/pipeline/recovery-dispatch.ts:447:      'set_env_vars',
test/docker.test.ts:245:    const id = await docker.runContainer({
test/docker.test.ts:280:    await docker.runContainer({
test/docker.test.ts:331:    await docker.runContainer({
test/docker.test.ts:361:    await docker.runContainer({
test/docker.test.ts:381:    await docker.runContainer({
src/pipeline/compose.ts:599:            await this.docker.safeRemoveContainer(child.container_id);
src/pipeline/compose.ts:670:          await this.docker.safeRemoveContainer(staleContainerName);
src/pipeline/compose.ts:722:            await this.docker.safeRemoveContainer(containerName);
src/pipeline/compose.ts:857:            await this.docker.safeRemoveContainer(deployment.containerId);
src/pipeline/compose.ts:867:            await this.docker.safeRemoveContainer(containerName);
src/pipeline/compose.ts:1020:          await this.docker.safeRemoveContainer(deployment.containerId);
src/pipeline/compose.ts:1083:          await this.docker.safeRemoveContainer(child.container_id);
src/pipeline/deploy/run-step.ts:42:    await this.docker.safeRemoveContainer(containerName);
src/pipeline/deploy/run-step.ts:60:        const containerId = await this.docker.runContainer({
src/pipeline/service-manager.ts:24:  execInServiceContainer,
src/pipeline/service-manager.ts:164:   * can auto-link it to a project via set_env_vars.
src/pipeline/service-manager.ts:223:  async reconcileServiceNetworks(): Promise<void> {
src/pipeline/service-manager.ts:285:          'Service network reconciled (alias updated on shared network)',
src/pipeline/service-manager.ts:429:    // Raw createContainer: incompatible with docker.runContainer() — service containers
src/pipeline/service-manager.ts:567:      await this.docker.safeRemoveContainer(containerId);
src/pipeline/service-manager.ts:608:        const initialResult = await execInServiceContainer(this.docker, service, [
src/pipeline/service-manager.ts:614:        await execInServiceContainer(this.docker, service, ['redis-cli', 'BGSAVE']);
src/pipeline/service-manager.ts:619:          const currentResult = await execInServiceContainer(this.docker, service, [
src/pipeline/service-manager.ts:645:    // is incompatible with docker.runContainer(). Consolidation deferred.
src/pipeline/service-manager.ts:692:      // is incompatible with docker.runContainer(). Consolidation deferred.
src/pipeline/service-manager.ts:806:    return execInServiceContainer(this.docker, service, command, {
src/pipeline/service-manager.ts:980:      const result = await execInServiceContainer(this.docker, service, [
src/pipeline/deploy/monorepo-orchestrator.ts:300:      await deps.docker.safeRemoveContainer(project.container_id);
src/pipeline/deploy/rollback.ts:106:      const containerId = await this.docker.runContainer({
src/pipeline/deploy/rollback.ts:228:      await this.docker.safeRemoveContainer(containerId);
test/traefik.test.ts:281:      safeRemoveContainer: mockSafeRemoveContainer,
test/pipeline/image-deploy-e2e.test.ts:16:  const envVars = parsed.env_vars
test/pipeline/image-deploy-e2e.test.ts:17:    ? (JSON.parse(parsed.env_vars) as Record<string, string>)
test/pipeline/image-deploy-e2e.test.ts:78:      env_vars: '{"NODE_ENV":"production"}',
test/pipeline/image-deploy-e2e.test.ts:115:      env_vars: '{"NODE_ENV":"production","LOG_LEVEL":"info"}',
test/deploy-controls.test.ts:26:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/deploy-controls.test.ts:159:    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
test/env-roundtrip.test.ts:63:describe('set_env_vars round-trip verification', () => {
test/env-roundtrip.test.ts:67:      names: ['set_env_vars'],
test/env-roundtrip.test.ts:68:    }).find((entry) => entry.name === 'set_env_vars');
test/env-roundtrip.test.ts:71:      throw new Error('set_env_vars tool not found');
test/env-roundtrip.test.ts:77:  it('set_env_vars returns error when round-trip verification fails', async () => {
test/env-roundtrip.test.ts:147:      names: ['set_env_vars', 'list_env_vars', 'get_env_var'],
test/env-roundtrip.test.ts:162:  it('MCP set_env_vars → HTTP getAllWithInheritance shows the vars', async () => {
test/env-roundtrip.test.ts:163:    const setTool = getTool('set_env_vars');
test/env-roundtrip.test.ts:173:  it('HTTP setBulk with envId → MCP list_env_vars shows the vars', async () => {
test/env-roundtrip.test.ts:176:    const listTool = getTool('list_env_vars');
test/env-roundtrip.test.ts:199:    const setTool = getTool('set_env_vars');
test/env-roundtrip.test.ts:209:    const listTool = getTool('list_env_vars');
test/pipeline/docker-sandbox.test.ts:86:  it('safeRemoveContainer resolves when container is already gone (404)', async () => {
test/pipeline/docker-sandbox.test.ts:96:    await expect(docker.safeRemoveContainer('sandbox-test')).resolves.toBeUndefined();
test/pipeline/docker-sandbox.test.ts:102:  it('safeRemoveContainer treats ECONNREFUSED as container gone', async () => {
test/pipeline/docker-sandbox.test.ts:112:    await expect(docker.safeRemoveContainer('sandbox-econnrefused')).resolves.toBeUndefined();
test/pipeline/docker-sandbox.test.ts:118:  it('safeRemoveContainer timeout logs warning but does not throw', async () => {
test/pipeline/docker-sandbox.test.ts:130:    const promise = docker.safeRemoveContainer('sandbox-stuck');
test/pipeline/docker-sandbox.test.ts:157:    await docker.runContainer({
test/pipeline/docker-sandbox.test.ts:209:    await docker.runContainer({
test/pipeline/event-golden.test.ts:72:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/ops-drift.test.ts:19:    env_vars: partial?.env_vars ?? null,
src/pipeline/service-adapters/mongo-adapter.ts:3:import { execInServiceContainer, sleep } from './shared.js';
src/pipeline/service-adapters/mongo-adapter.ts:54:    const connResult = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mongo-adapter.ts:74:    const result = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mongo-adapter.ts:99:    const result = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/minio-adapter.ts:3:import { execInServiceContainer, sleep } from './shared.js';
src/pipeline/service-adapters/minio-adapter.ts:97:    await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/minio-adapter.ts:113:    const result = await execInServiceContainer(docker, service, ['mc', 'ls', 'local', '--json']);
src/pipeline/service-adapters/minio-adapter.ts:147:    await execInServiceContainer(docker, service, ['mc', 'mb', `local/${bucketName}`], {
src/pipeline/service-adapters/minio-adapter.ts:154:    await execInServiceContainer(docker, service, ['mc', 'rb', `local/${bucketName}`], {
test/pipeline/performance-baseline.test.ts:34:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
src/pipeline/deploy-core.ts:279:          await this.docker.safeRemoveContainer(container.id);
src/pipeline/deploy-core.ts:698:        await this.docker.safeRemoveContainer(environment.container_id);
src/pipeline/deploy-core.ts:870:        await this.docker.safeRemoveContainer(containerName);
src/pipeline/deploy-core.ts:1090:            await this.docker.safeRemoveContainer(child.container_id);
src/pipeline/deploy-core.ts:1529:      greenContainerId = await this.docker.runContainer({
src/pipeline/deploy-core.ts:1567:      await this.docker.safeRemoveContainer(blueContainerId);
src/pipeline/deploy-core.ts:1742:      await this.docker.safeRemoveContainer(greenName);
src/pipeline/deploy-core.ts:1756:      await this.docker.safeRemoveContainer(containerId);
src/pipeline/service-adapters/redis-adapter.ts:3:import { execInServiceContainer, sleep } from './shared.js';
src/pipeline/service-adapters/redis-adapter.ts:47:    const infoResult = await execInServiceContainer(docker, service, [
test/service-manager-backup.test.ts:44:    env_vars: partial.env_vars ?? null,
src/pipeline/service-adapters/postgres-adapter.ts:4:  execInServiceContainer,
src/pipeline/service-adapters/postgres-adapter.ts:43:        const result = await execInServiceContainer(
src/pipeline/service-adapters/postgres-adapter.ts:66:    const connResult = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/postgres-adapter.ts:77:    const maxResult = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/postgres-adapter.ts:99:    const result = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/postgres-adapter.ts:141:    const result = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/postgres-adapter.ts:175:    await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/postgres-adapter.ts:207:    await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/postgres-adapter.ts:221:      await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mysql-adapter.ts:4:  execInServiceContainer,
src/pipeline/service-adapters/mysql-adapter.ts:43:        const result = await execInServiceContainer(
src/pipeline/service-adapters/mysql-adapter.ts:74:    const connResult = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mysql-adapter.ts:82:    const maxResult = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mysql-adapter.ts:102:    const result = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mysql-adapter.ts:125:    const result = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mysql-adapter.ts:149:    await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mysql-adapter.ts:177:    await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/mysql-adapter.ts:187:      await execInServiceContainer(docker, service, [
test/helpers/docker-mocks.ts:216:      safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
src/pipeline/service-adapters/rabbitmq-adapter.ts:4:import { execInServiceContainer } from './shared.js';
src/pipeline/service-adapters/rabbitmq-adapter.ts:34:        const result = await execInServiceContainer(docker, service, [
src/pipeline/service-adapters/rabbitmq-adapter.ts:49:      const result = await execInServiceContainer(docker, service, [
test/blue-green-port-conflict.test.ts:60:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/blue-green-port-conflict.test.ts:156:    const safeRemoveContainerMock = docker.safeRemoveContainer as ReturnType<typeof vi.fn>;
test/blue-green-port-conflict.test.ts:162:    const removeBlueCallIndex = safeRemoveContainerMock.mock.calls.findIndex(
test/blue-green-port-conflict.test.ts:171:    expect(safeRemoveContainerMock.mock.invocationCallOrder[removeBlueCallIndex]).toBeLessThan(
test/blue-green-port-conflict.test.ts:195:    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
test/blue-green-port-conflict.test.ts:198:    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
test/helpers/web-route-mocks.ts:115:    env_vars: null,
src/pipeline/service-adapters/shared.ts:14:export async function execInServiceContainer(
test/deploy-build-method-fallback.test.ts:21:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/pipeline/deploy/lifecycle.test.ts:20:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/pipeline/deploy/rollback.test.ts:20:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/pipeline/deploy/rollback.test.ts:75:    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
test/pipeline/deploy/run-step.test.ts:12:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/pipeline/deploy/run-step.test.ts:47:    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
test/pipeline/deploy/run-step.test.ts:51:      (docker.safeRemoveContainer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
test/web-routes.test.ts:572:          env_vars: {
test/web-routes.test.ts:952:        env_vars: null,
test/web-routes.test.ts:1252:        env_vars: customEnv,
test/deploy-lock.test.ts:28:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/start-deploy.test.ts:20:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/start-deploy.test.ts:286:      expect(docker.safeRemoveContainer).toHaveBeenCalled();
test/environments.test.ts:137:      CREATE TABLE env_vars (
test/environments.test.ts:165:      .prepare('INSERT INTO env_vars (id, project_id, key, value) VALUES (?, ?, ?, ?)')
test/environments.test.ts:185:      inspector.prepare("PRAGMA table_info('env_vars')").all() as Array<{ name: string }>
test/volume-minio.test.ts:43:    env_vars: partial.env_vars ?? null,
test/web/tool-result-card.test.tsx:202:        env_vars: { API_KEY: 'secret', PASSWORD: 'pw' },
test/web/tool-result-card.test.tsx:233:  it('renders get_system_stats from percent aliases and set_env_vars fallback keys', () => {
test/web/tool-result-card.test.tsx:254:      toolName: 'set_env_vars',
test/deploy-dockerfile-path.test.ts:19:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/compose-network.test.ts:55:      safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/compose-network.test.ts:93:      safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/compose-network.test.ts:135:      safeRemoveContainer: removeContainerMock,
test/network-service-integration.test.ts:23:    env_vars: partial.env_vars ?? null,
test/network-service-integration.test.ts:401:describe('reconcileServiceNetworks', () => {
test/network-service-integration.test.ts:432:    await manager.reconcileServiceNetworks();
test/network-service-integration.test.ts:474:    await manager.reconcileServiceNetworks();
test/network-service-integration.test.ts:506:    await expect(manager.reconcileServiceNetworks()).resolves.toBeUndefined();
test/network-service-integration.test.ts:538:    await manager.reconcileServiceNetworks();
test/network-service-integration.test.ts:590:    await manager.reconcileServiceNetworks();
test/redeploy-build-method.test.ts:21:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/service-manager-extended.test.ts:30:    env_vars: partial.env_vars ?? null,
test/mcp/tool-registry-snapshot.test.ts:58:  'list_env_vars',
test/mcp/tool-registry-snapshot.test.ts:79:  'set_env_vars',
test/tool-registry.test.ts:21:  'list_env_vars',
test/tool-registry.test.ts:22:  'set_env_vars',
test/tool-registry.test.ts:295:  it('set_env_vars redeploys only when env changed and project is running', async () => {
test/tool-registry.test.ts:312:    const setEnvVars = getTool(ctx, 'set_env_vars');
test/tool-registry.test.ts:344:  it('list_env_vars returns masked variables for a project', async () => {
test/tool-registry.test.ts:360:    const listEnvVars = getTool(ctx, 'list_env_vars');
test/tool-registry.test.ts:377:  it('set_env_vars throws on malformed JSON and does not redeploy', async () => {
test/tool-registry.test.ts:393:    const setEnvVars = getTool(ctx, 'set_env_vars');
test/compose.test.ts:34:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/compose.test.ts:517:        safeRemoveContainer: removeContainerMock,
test/compose.test.ts:591:        safeRemoveContainer: removeContainerMock,
test/compose.test.ts:653:          safeRemoveContainer: removeContainerMock,
test/compose.test.ts:737:      safeRemoveContainer: removeContainerMock,
test/mcp-service-tools.test.ts:25:    env_vars: partial.env_vars ?? null,
test/mcp-service-tools.test.ts:165:          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
test/mcp-service-tools.test.ts:219:          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
test/mcp-service-tools.test.ts:268:          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
test/deploy-environment.test.ts:32:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/domain-routes.test.ts:121:            await onEvent({ type: 'tool_call', toolName: 'list_env_vars', arguments: {} });
test/deploy-crash-log.test.ts:19:    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
test/tools/env-source.test.ts:12:describe('list_env_vars tool', () => {
test/tools/env-source.test.ts:25:    listEnvVarsTool = envToolDefs.find((tool) => tool.name === 'list_env_vars')!;
test/tools/platform-actions.test.ts:39:  const safeRemoveContainer = vi.fn(async (_id: string) => undefined);
test/tools/platform-actions.test.ts:51:      safeRemoveContainer,
test/tools/platform-actions.test.ts:68:      safeRemoveContainer,
test/tools/image-schema.test.ts:111:      env_vars: '{"NODE_ENV":"production","DEBUG":"false"}',
test/tools/image-schema.test.ts:122:      expect(result.data.env_vars).toBe('{"NODE_ENV":"production","DEBUG":"false"}');
test/infra-analyzer.test.ts:20:    env_vars: partial.env_vars ?? null,

exec
/bin/bash -lc "rg -n \"timeout|truncated|maxOutputBytes|exec timeout|partial output\" test | sed -n '1,200p'" in /home/lee/OpenLander
succeeded in 0ms:
test/docker.test.ts:573:  it('returns timeout checks from waitForHealthy final inspection fallback', async () => {
test/docker.test.ts:582:        throw new Error('timeout inspect error');
test/docker.test.ts:593:    await expect(docker.waitForHealthy('timeout-no-health', 0)).resolves.toEqual({
test/docker.test.ts:596:      error: 'Container did not become healthy within timeout',
test/docker.test.ts:598:    await expect(docker.waitForHealthy('timeout-restart', 0)).resolves.toMatchObject({
test/docker.test.ts:603:    await expect(docker.waitForHealthy('timeout-error', 0)).resolves.toEqual({
test/pipeline/approval-gate.test.ts:56:  it('resolves timed_out after approval timeout', async () => {
test/pipeline/approval-gate.test.ts:59:      'run-timeout',
test/pipeline/approval-gate.test.ts:60:      createMetadata({ actionRunId: 'run-timeout' }),
test/pipeline/approval-gate.test.ts:74:  it('returns already-processed when approving after timeout has already resolved', async () => {
test/pipeline/approval-gate.test.ts:77:      'run-timeout-approve',
test/pipeline/approval-gate.test.ts:78:      createMetadata({ actionRunId: 'run-timeout-approve' }),
test/pipeline/approval-gate.test.ts:84:    expect(gate.approve('run-timeout-approve')).toBe('already-processed');
test/pipeline/docker-methods.test.ts:305:        stdout.write(Buffer.from('partial output'));
test/pipeline/docker-methods.test.ts:318:    expect(result.stdout).toBe('partial output');
test/rollback-watcher.test.ts:238:  it('watch duration timeout stops watching after 60 seconds', async () => {
test/rollback-watcher.test.ts:253:    // Health checks after timeout should be ignored
test/pipeline/docker-sandbox.test.ts:118:  it('safeRemoveContainer timeout logs warning but does not throw', async () => {
test/recovery-dispatch.test.ts:42:    const plan = dispatchRecovery('clone', 'Failed to clone: timeout');
test/recovery-dispatch.test.ts:142:      dispatchRecovery('clone', 'Failed to clone: timeout').category,
test/recovery-dispatch.test.ts:197:      dispatchRecovery('clone', 'Failed to clone: timeout'),
test/recovery-dispatch.test.ts:216:      dispatchRecovery('clone', 'Failed to clone: timeout'),
test/recovery-dispatch.test.ts:267:      dispatchRecovery('clone', 'Failed to clone: timeout'),
test/deploy-stream-routes.test.ts:37:async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
test/deploy-stream-routes.test.ts:40:    if (Date.now() - start > timeoutMs) {
test/deploy-stream-routes.test.ts:289:      new Error('question bridge timeout'),
test/pipeline/readiness-gate.test.ts:52:  it('health check timeout logs warning and deploy proceeds', async () => {
test/pipeline/readiness-gate.test.ts:69:          { serviceName: service.name, error: 'timeout' },
test/pipeline/readiness-gate.test.ts:83:      { serviceName: 'api', error: 'timeout' },
test/mcp/session-heartbeat.test.ts:72:  it('clearTimeout is called during cleanup when TTL timeout exists', () => {
test/mcp/session-heartbeat.test.ts:115:  it('TTL timeout is set to 5 minutes during session close', () => {
test/pipeline/auto-recovery.test.ts:592:      // Let recovery complete (agent stream ended; wait for outcome timeout)
test/deploy-timeline-stream.test.ts:402:    it('clears stream timeout on stream abort', () => {
test/deploy-timeline-stream.test.ts:410:    it('sets 5-minute stream timeout on stream start', () => {
test/terminal.test.ts:50:// Terminal idle timeout tests
test/terminal.test.ts:53:describe('Terminal idle timeout', () => {
test/terminal.test.ts:54:  it('idle timeout is configured to 30 minutes', () => {
test/compose.test.ts:1052:      timeout: 10s
test/compose.test.ts:1065:      timeout: '10s',
test/compose.test.ts:1210:      timeout: 10s
test/ops-drift.test.ts:199:        inspect: vi.fn().mockRejectedValue(new Error('daemon timeout')),
test/monitor/recovery-coordinator.test.ts:186:      lastError: 'timeout',
test/monitor/recovery-coordinator.test.ts:323:      lastError: 'timeout',
test/diff-analysis.test.ts:20:  opts?: { cwd?: string; timeout?: number },
test/domain-routes.test.ts:11:async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
test/domain-routes.test.ts:14:    if (Date.now() - start > timeoutMs) {
test/deploy-flow-unification.integration.test.ts:12:  it('keeps QuestionBridge timeout safety for pending ask sessions', () => {
test/deploy-flow-unification.integration.test.ts:41:  it('keeps agent-driven deploy route without timeout fallback while preserving no-agent path', () => {
test/question-bridge.test.ts:19:describe('QuestionBridge timeout handling', () => {
test/question-bridge.test.ts:28:  it('rejects ask() after 5 minutes with a clear timeout message', async () => {
test/question-bridge.test.ts:40:  it('clears timeout when reply() resolves the pending question', async () => {
test/question-bridge.test.ts:53:  it('clears timeout when reject() resolves with empty answers', async () => {
test/job-manager.test.ts:133:    jm.updatePhase('p3', 'failed', 'timeout');
test/job-manager.test.ts:138:    expect(jm.getStatus('p3')!.errorSummary).toBe('timeout');
test/deploy-plan-db.test.ts:72:          { name: 'build', command: 'docker build', timeout: 3600 },
test/deploy-plan-db.test.ts:143:      db.updateDeployPlan('plan-1', { errorMessage: 'Build failed: timeout' });
test/deploy-plan-db.test.ts:146:      expect(updated!.error_message).toBe('Build failed: timeout');
test/deploy-plan-db.test.ts:302:            timeout: 300,
test/deploy-plan-db.test.ts:313:            timeout: 3600,
test/tools/project-ops-restart.test.ts:46:      new Promise((resolve) => setTimeout(() => resolve('timeout'), 25)),
test/tools/project-ops-restart.test.ts:49:    expect(result).not.toBe('timeout');
test/build-recovery.test.ts:40:  it('classifies network timeout as Tier 1 network-error', () => {
test/health-monitor.test.ts:76:    return new HealthMonitor(docker, db, events, { maxRetries: 1, timeoutMs: 20 });
test/postmortem.test.ts:114:async function waitForAssertion(assertion: () => void, timeoutMs = 500): Promise<void> {
test/postmortem.test.ts:118:  while (Date.now() - startedAt < timeoutMs) {
test/deploy-lock.test.ts:297:        { project_name: 'status-app', wait: true, timeout: 15 },
test/deploy-lock.test.ts:315:      expect(result).not.toHaveProperty('timeout');
test/deploy-lock.test.ts:335:        { project_name: 'old-log-app', wait: true, timeout: 2 },
test/deploy-lock.test.ts:339:      expect(result).toHaveProperty('timeout', true);
test/deploy-lock.test.ts:356:        { project_name: 'locked-status-app', wait: true, timeout: 30 },
test/deploy-lock.test.ts:381:        { project_name: 'evented-status-app', wait: true, timeout: 30 },
test/deploy-lock.test.ts:402:        { project_name: 'evented-status-app', wait: true, timeout: 30 },
test/web/log-viewer-ui.test.tsx:327:        error: 'socket timeout',
test/web/log-viewer-ui.test.tsx:332:    expect(normalizeText(tree)).toContain('socket timeout');

exec
/bin/bash -lc "nl -ba src/pipeline/service-adapters/shared.ts | sed -n '1,120p'" in /home/lee/OpenLander
succeeded in 0ms:
   1	import type { ServiceRow } from '../../db/index.js';
   2	import type { Docker } from '../docker.js';
   3	import type { ContainerExecResult, ServiceCredentials } from './types.js';
   4
   5	const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
   6	const DEFAULT_MAX_OUTPUT_BYTES = 1_024 * 1_024; // 1 MB
   7
   8	export interface ExecOptions {
   9	  throwOnNonZeroExit?: boolean;
  10	  timeoutMs?: number;
  11	  maxOutputBytes?: number;
  12	}
  13
  14	export async function execInServiceContainer(
  15	  docker: Docker,
  16	  service: ServiceRow,
  17	  command: string[],
  18	  options?: ExecOptions,
  19	): Promise<ContainerExecResult> {
  20	  const containerId = service.container_id ?? service.container_name;
  21	  const timeoutMs = options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  22	  const maxBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  23
  24	  let execResult: { exitCode: number; stdout: string; stderr: string };
  25	  let timedOut = false;
  26
  27	  try {
  28	    const timeoutPromise = new Promise<never>((_, reject) => {
  29	      setTimeout(() => {
  30	        reject(new Error('exec timeout'));
  31	      }, timeoutMs);
  32	    });
  33
  34	    execResult = await Promise.race([docker.execSimple(containerId, command), timeoutPromise]);
  35	  } catch (error) {
  36	    if (error instanceof Error && error.message === 'exec timeout') {
  37	      timedOut = true;
  38	      execResult = { exitCode: -1, stdout: '', stderr: '' };
  39	    } else {
  40	      throw error;
  41	    }
  42	  }
  43
  44	  if (timedOut) {
  45	    return { stdout: '', stderr: '', exitCode: -1, truncated: true };
  46	  }
  47
  48	  const truncated = execResult.stdout.length > maxBytes || execResult.stderr.length > maxBytes;
  49	  const stdout =
  50	    execResult.stdout.length > maxBytes ? execResult.stdout.slice(0, maxBytes) : execResult.stdout;
  51	  const stderr =
  52	    execResult.stderr.length > maxBytes ? execResult.stderr.slice(0, maxBytes) : execResult.stderr;
  53
  54	  if (options?.throwOnNonZeroExit !== false && execResult.exitCode !== 0) {
  55	    const commandText = command.join(' ');
  56	    const output = stderr.trim() || stdout.trim();
  57	    throw new Error(
  58	      `Container command failed (${commandText}) with exit code ${String(execResult.exitCode)}${output ? `: ${output}` : ''}`,
  59	    );
  60	  }
  61
  62	  return {
  63	    stdout,
  64	    stderr,
  65	    exitCode: execResult.exitCode,
  66	    ...(truncated ? { truncated: true } : {}),
  67	  };
  68	}
  69
  70	export function parseServiceCredentials(service: ServiceRow): ServiceCredentials {
  71	  if (!service.credentials) {
  72	    throw new Error(`Service credentials not available: ${service.id}`);
  73	  }
  74
  75	  let parsed: unknown;
  76	  try {
  77	    parsed = JSON.parse(service.credentials);
  78	  } catch (_err) {
  79	    throw new Error(`Invalid service credentials: ${service.id}`);
  80	  }
  81
  82	  if (typeof parsed !== 'object' || parsed === null) {
  83	    throw new Error(`Incomplete service credentials: ${service.id}`);
  84	  }
  85
  86	  const record = parsed as Record<string, unknown>;
  87	  if (
  88	    typeof record['user'] !== 'string' ||
  89	    typeof record['password'] !== 'string' ||
  90	    typeof record['database'] !== 'string'
  91	  ) {
  92	    throw new Error(`Incomplete service credentials: ${service.id}`);
  93	  }
  94
  95	  return {
  96	    user: record['user'],
  97	    password: record['password'],
  98	    database: record['database'],
  99	  };
 100	}
 101
 102	export function assertSafeDatabaseName(name: string): void {
 103	  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
 104	    throw new Error(`Invalid database name: ${name}`);
 105	  }
 106	}
 107
 108	export function assertSafeUserName(username: string): void {
 109	  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(username)) {
 110	    throw new Error(`Invalid username: ${username}`);
 111	  }
 112	}
 113
 114	export function quoteSqlLiteral(value: string): string {
 115	  return `'${value.replace(/'/g, "''")}'`;
 116	}
 117
 118	export { sleep } from '../../lib/sleep.js';

codex
I’ve got enough to call out concrete migration regressions now. I’m pulling exact line references for the recovery path and service env persistence so the findings are grounded in the current code, not just the diff summary.
exec
/bin/bash -lc "nl -ba src/pipeline/recover.ts | sed -n '132,190p'" in /home/lee/OpenLander
succeeded in 0ms:
 132	        Name: vName,
 133	        Labels: {
 134	          [DOCKER_LABELS.MANAGED]: 'true',
 135	          [DOCKER_LABELS.ROLE]: 'service',
 136	          [DOCKER_LABELS.SERVICE]: service.name,
 137	        },
 138	      });
 139	    }
 140
 141	    // Ensure image
 142	    const hasImage = await imageExists(ctx, service.image);
 143	    if (!hasImage) {
 144	      await ctx.docker.pullImage(service.image);
 145	    }
 146
 147	    const rawEnvVars: string[] = service.env_vars ? (JSON.parse(service.env_vars) as string[]) : [];
 148	    const envVars: Record<string, string> = {};
 149	    for (const entry of rawEnvVars) {
 150	      const eqIdx = entry.indexOf('=');
 151	      if (eqIdx > 0) {
 152	        envVars[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
 153	      }
 154	    }
 155
 156	    // Get template config
 157	    const template = SERVICE_TEMPLATES[service.type];
 158	    const containerPort = getServiceContainerPort(service);
 159	    const dataMountPath = getDataMountPath(service.type);
 160
 161	    await ctx.docker.safeRemoveContainer(cName);
 162
 163	    const containerId = await ctx.docker.runContainer({
 164	      imageTag: service.image,
 165	      name: cName,
 166	      port: service.port,
 167	      containerPort,
 168	      envVars,
 169	      cmd: template?.cmd,
 170	      traefikLabels: {
 171	        [DOCKER_LABELS.ROLE]: 'service',
 172	        [DOCKER_LABELS.SERVICE]: service.name,
 173	      },
 174	      network: SHARED_NETWORK_NAME,
 175	      restartPolicy: { Name: 'unless-stopped' },
 176	      extraBinds: [`${vName}:${dataMountPath}`],
 177	    });
 178
 179	    ctx.db.updateService(service.id, { status: 'running', containerId });
 180
 181	    log.info({ service: service.name }, 'Service recovered');
 182	    return { name: service.name, status: 'recreated' };
 183	  } catch (error) {
 184	    const msg = error instanceof Error ? error.message : String(error);
 185	    log.error({ service: service.name, error: msg }, 'Failed to recover service');
 186	    return { name: service.name, status: 'error', error: msg };
 187	  }
 188	}
 189
 190	async function recoverProject(

exec
/bin/bash -lc "nl -ba src/pipeline/service-manager.ts | sed -n '320,505p'" in /home/lee/OpenLander
succeeded in 0ms:
 320	    if (!hasTemplate && !hasImage) {
 321	      throw new Error('Provide at least one of template or image');
 322	    }
 323
 324	    const userEnv = this.toEnvPairs(opts.envVars);
 325	    const userEnvJson = opts.envVars ? JSON.stringify(opts.envVars) : undefined;
 326
 327	    let type: string;
 328	    let image: string;
 329	    let port: number;
 330	    let env: string[];
 331	    let credentialsJson: string | undefined;
 332	    let dataMountPath: string;
 333	    let containerCmd: string[] | undefined;
 334	    let containerHealthcheck: ServiceTemplate['healthcheck'] | undefined;
 335
 336	    if (hasTemplate) {
 337	      const templateId = opts.template as string;
 338	      const template = SERVICE_TEMPLATES[templateId];
 339	      if (!template) {
 340	        throw new Error(`Unsupported service template: ${templateId}`);
 341	      }
 342
 343	      type = template.type;
 344	      // Use provided version or default to first available version
 345	      const version = opts.version ?? AVAILABLE_VERSIONS[templateId]?.[0] ?? 'latest';
 346	      // If custom image is also provided, use it instead of the template default
 347	      image = hasImage ? (opts.image as string) : template.image.replace(/:[^:]+$/, `:${version}`);
 348	      port = template.port;
 349	      dataMountPath = this.getDataMountPath(template.type);
 350	      containerCmd = template.cmd;
 351	      containerHealthcheck = template.healthcheck;
 352
 353	      if (template.type === 'redis') {
 354	        env = [...userEnv];
 355	        credentialsJson = JSON.stringify({
 356	          host: this.getContainerName(opts.name),
 357	          port,
 358	          connectionString: this.getConnectionString(
 359	            'redis',
 360	            this.getContainerName(opts.name),
 361	            port,
 362	          ),
 363	        });
 364	      } else if (template.type === 'minio') {
 365	        const user = 'openlander';
 366	        const password = randomBytes(16).toString('hex');
 367	        const containerName = this.getContainerName(opts.name);
 368	        env = [...template.env({ user, password, database: '' }), ...userEnv];
 369	        credentialsJson = JSON.stringify({
 370	          host: containerName,
 371	          port,
 372	          user,
 373	          password,
 374	          connectionString: this.getConnectionString('minio', containerName, port),
 375	        });
 376	      } else {
 377	        const containerName = this.getContainerName(opts.name);
 378	        const credentials = this.buildCredentials(
 379	          template.type as Exclude<BuiltInServiceType, 'redis' | 'minio'>,
 380	          opts.name,
 381	          containerName,
 382	          port,
 383	        );
 384	        env = [...template.env(credentials), ...userEnv];
 385	        credentialsJson = JSON.stringify(credentials);
 386	      }
 387	    } else {
 388	      if (!opts.image) {
 389	        throw new Error('image is required when template is not provided');
 390	      }
 391	      if (opts.port === undefined) {
 392	        throw new Error('port is required when using custom image');
 393	      }
 394
 395	      type = this.extractTypeFromImage(opts.image);
 396	      image = opts.image;
 397	      port = opts.port;
 398	      env = userEnv;
 399	      credentialsJson = undefined;
 400	      dataMountPath = '/data';
 401	      containerCmd = undefined;
 402	    }
 403
 404	    if (!Number.isInteger(port) || port <= 0) {
 405	      throw new Error(`Invalid service port: ${String(port)}`);
 406	    }
 407
 408	    const containerPort = port;
 409	    // Given no explicit env context, use production port policy for services.
 410	    const hostPort = await allocatePort(this.db, this.docker, {}, 'production');
 411
 412	    const id = nanoid(12);
 413	    const containerName = this.getContainerName(opts.name);
 414	    const volumeName = this.getVolumeName(opts.name);
 415
 416	    await this.docker.pullImage(image);
 417
 418	    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
 419	    const client = this.docker.getClient();
 420	    await client.createVolume({
 421	      Name: volumeName,
 422	      Labels: {
 423	        [DOCKER_LABELS.MANAGED]: 'true',
 424	        [DOCKER_LABELS.ROLE]: 'service',
 425	        [DOCKER_LABELS.SERVICE]: opts.name,
 426	      },
 427	    });
 428
 429	    // Raw createContainer: incompatible with docker.runContainer() — service containers
 430	    // need different labels (ROLE/SERVICE vs PROJECT), custom healthcheck support,
 431	    // explicit volume binds, and 'unless-stopped' restart policy. Consolidation deferred.
 432	    const container = await client.createContainer({
 433	      Image: image,
 434	      name: containerName,
 435	      Env: env,
 436	      ...(containerCmd ? { Cmd: containerCmd } : {}),
 437	      ...(containerHealthcheck
 438	        ? {
 439	            Healthcheck: {
 440	              Test: containerHealthcheck.test,
 441	              Interval: containerHealthcheck.interval * 1_000_000_000,
 442	              Timeout: containerHealthcheck.timeout * 1_000_000_000,
 443	              Retries: containerHealthcheck.retries,
 444	              StartPeriod: containerHealthcheck.startPeriod * 1_000_000_000,
 445	            },
 446	          }
 447	        : {}),
 448	      Labels: {
 449	        [DOCKER_LABELS.MANAGED]: 'true',
 450	        [DOCKER_LABELS.ROLE]: 'service',
 451	        [DOCKER_LABELS.SERVICE]: opts.name,
 452	      },
 453	      ExposedPorts: {
 454	        [`${String(containerPort)}/tcp`]: {},
 455	      },
 456	      NetworkingConfig: {
 457	        EndpointsConfig: {
 458	          [SHARED_NETWORK_NAME]: { Aliases: [opts.name] },
 459	        },
 460	      },
 461	      HostConfig: {
 462	        NetworkMode: this.docker.getNetworkName(),
 463	        RestartPolicy: { Name: 'unless-stopped' },
 464	        Binds: [`${volumeName}:${dataMountPath}`],
 465	        PortBindings: {
 466	          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
 467	        },
 468	        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
 469	      },
 470	    });
 471
 472	    await container.start();
 473
 474	    const primaryNetwork = this.docker.getNetworkName();
 475	    const additionalNetworks = [SHARED_NETWORK_NAME].filter(
 476	      (networkName) => networkName !== primaryNetwork,
 477	    );
 478
 479	    for (const networkName of additionalNetworks) {
 480	      try {
 481	        await this.docker.connectContainerToNetwork(container.id, networkName, [opts.name]);
 482	      } catch (err) {
 483	        log.warn(
 484	          { err, networkName, containerName },
 485	          'Failed to connect service to additional network',
 486	        );
 487	      }
 488	    }
 489
 490	    this.db.createService({
 491	      id,
 492	      name: opts.name,
 493	      type,
 494	      image,
 495	      containerName,
 496	      port: hostPort,
 497	      envVars: userEnvJson,
 498	      credentials: credentialsJson,
 499	    });
 500
 501	    this.db.updateService(id, { status: 'running', containerId: container.id });
 502	    this.invalidateServiceCardSummaryCache();
 503	    const created = this.db.getService(id);
 504	    if (!created) {
 505	      throw new Error(`Failed to create service: ${id}`);

exec
/bin/bash -lc "nl -ba src/pipeline/docker.ts | sed -n '432,910p'" in /home/lee/OpenLander
succeeded in 0ms:
 432	  async runContainer(options: RunContainerOptions): Promise<string> {
 433	    const envArray = Object.entries(options.envVars).map(([k, v]) => `${k}=${v}`);
 434	    const cPort = options.containerPort ?? options.port;
 435	    const extraHosts = await this.resolveExtraHosts();
 436	    const secretBinds = this.writeSecretFiles(options.name, options.secretFiles ?? []);
 437	    const projectName = stripContainerPrefix(options.name);
 438	    const networkMode = options.network ?? this.networkName;
 439	    const networkingConfig =
 440	      networkMode === SHARED_NETWORK_NAME
 441	        ? {
 442	            EndpointsConfig: {
 443	              [SHARED_NETWORK_NAME]: {
 444	                Aliases: [projectName],
 445	              },
 446	            },
 447	          }
 448	        : undefined;
 449	    const volumeBinds = await this.getProjectVolumeBinds(projectName);
 450	    const binds = [...secretBinds, ...volumeBinds, ...(options.extraBinds ?? [])];
 451
 452	    const container = await this.client.createContainer({
 453	      Image: options.imageTag,
 454	      name: options.name,
 455	      Env: envArray,
 456	      Labels: {
 457	        [DOCKER_LABELS.MANAGED]: 'true',
 458	        [DOCKER_LABELS.PROJECT]: stripContainerPrefix(options.name),
 459	        ...options.traefikLabels,
 460	      },
 461	      ExposedPorts: {
 462	        [`${String(cPort)}/tcp`]: {},
 463	      },
 464	      Cmd: options.cmd,
 465	      NetworkingConfig: networkingConfig,
 466	      HostConfig: {
 467	        PortBindings: {
 468	          [`${String(cPort)}/tcp`]: [{ HostPort: String(options.port) }],
 469	        },
 470	        Binds: binds.length > 0 ? binds : undefined,
 471	        NetworkMode: networkMode,
 472	        RestartPolicy: options.restartPolicy ?? { Name: 'on-failure', MaximumRetryCount: 5 },
 473	        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
 474	        ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
 475	      },
 476	    });
 477
 478	    await container.start();
 479
 480	    if (networkMode !== SHARED_NETWORK_NAME) {
 481	      await this.ensureSharedNetworkAttachment(container.id, projectName);
 482	    }
 483
 484	    return container.id;
 485	  }
 486
 487	  async runComposeService(opts: RunComposeServiceOptions): Promise<string> {
 488	    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
 489	    const cPort = opts.containerPort ?? opts.port;
 490	    const extraHosts = await this.resolveExtraHosts();
 491	    const secretBinds = this.writeSecretFiles(opts.name, opts.secretFiles ?? []);
 492	    const projectName = stripContainerPrefix(opts.name);
 493	    const volumeBinds = await this.getProjectVolumeBinds(projectName);
 494	    const binds = [...secretBinds, ...volumeBinds];
 495	    const networkMode = opts.network ?? opts.networks?.[0] ?? this.networkName;
 496	    const networkingConfig =
 497	      networkMode === SHARED_NETWORK_NAME
 498	        ? {
 499	            EndpointsConfig: {
 500	              [SHARED_NETWORK_NAME]: {
 501	                Aliases: [projectName],
 502	              },
 503	            },
 504	          }
 505	        : undefined;
 506
 507	    if (typeof opts.command === 'string' && /[;&|`$(){}]/.test(opts.command)) {
 508	      throw new Error('Command contains disallowed shell metacharacters');
 509	    }
 510
 511	    const command = typeof opts.command === 'string' ? ['sh', '-c', opts.command] : opts.command;
 512	    const restartPolicyName =
 513	      opts.restart === 'no' ||
 514	      opts.restart === 'always' ||
 515	      opts.restart === 'on-failure' ||
 516	      opts.restart === 'unless-stopped'
 517	        ? opts.restart
 518	        : 'unless-stopped';
 519	    const healthcheck = opts.healthcheck
 520	      ? {
 521	          Test:
 522	            typeof opts.healthcheck.test === 'string'
 523	              ? ['CMD-SHELL', opts.healthcheck.test]
 524	              : opts.healthcheck.test,
 525	          ...(opts.healthcheck.interval !== undefined
 526	            ? { Interval: opts.healthcheck.interval * 1_000_000_000 }
 527	            : {}),
 528	          ...(opts.healthcheck.timeout !== undefined
 529	            ? { Timeout: opts.healthcheck.timeout * 1_000_000_000 }
 530	            : {}),
 531	          ...(opts.healthcheck.retries !== undefined ? { Retries: opts.healthcheck.retries } : {}),
 532	          ...(opts.healthcheck.start_period !== undefined
 533	            ? { StartPeriod: opts.healthcheck.start_period * 1_000_000_000 }
 534	            : {}),
 535	        }
 536	      : undefined;
 537
 538	    const container = await this.client.createContainer({
 539	      Image: opts.imageTag,
 540	      name: opts.name,
 541	      Env: envArray,
 542	      Labels: {
 543	        [DOCKER_LABELS.MANAGED]: 'true',
 544	        [DOCKER_LABELS.PROJECT]: stripContainerPrefix(opts.name),
 545	        ...opts.traefikLabels,
 546	      },
 547	      ExposedPorts: {
 548	        [`${String(cPort)}/tcp`]: {},
 549	      },
 550	      Cmd: command,
 551	      Entrypoint: opts.entrypoint,
 552	      Healthcheck: healthcheck,
 553	      NetworkingConfig: networkingConfig,
 554	      HostConfig: {
 555	        PortBindings: {
 556	          [`${String(cPort)}/tcp`]: [{ HostPort: String(opts.port) }],
 557	        },
 558	        Binds: binds.length > 0 ? binds : undefined,
 559	        NetworkMode: networkMode,
 560	        RestartPolicy: { Name: restartPolicyName },
 561	        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
 562	        ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
 563	      },
 564	    });
 565
 566	    await container.start();
 567
 568	    if (networkMode !== SHARED_NETWORK_NAME) {
 569	      await this.ensureSharedNetworkAttachment(container.id, projectName);
 570	    }
 571
 572	    const additionalNetworks =
 573	      opts.networks
 574	        ?.slice(1)
 575	        .filter((networkName, index, arr) => arr.indexOf(networkName) === index) ?? [];
 576	    try {
 577	      for (const networkName of additionalNetworks) {
 578	        await this.client.getNetwork(networkName).connect({ Container: container.id });
 579	      }
 580	    } catch (error) {
 581	      try {
 582	        await container.stop();
 583	      } catch {
 584	        /* best-effort */
 585	      }
 586
 587	      try {
 588	        await container.remove({ force: true });
 589	      } catch {
 590	        /* best-effort */
 591	      }
 592
 593	      throw error;
 594	    }
 595
 596	    return container.id;
 597	  }
 598
 599	  /**
 600	   * Create and start an infrastructure container (e.g. Traefik).
 601	   * Unlike runContainer, this accepts raw Dockerode options for non-project
 602	   * containers that don't follow the standard port/Traefik-label pattern.
 603	   */
 604	  async runInfraContainer(options: Dockerode.ContainerCreateOptions): Promise<string> {
 605	    const container = await this.client.createContainer(options);
 606	    await container.start();
 607	    return container.id;
 608	  }
 609
 610	  public async ensureSharedNetworkAttachment(containerId: string, alias: string): Promise<void> {
 611	    const network = this.client.getNetwork(SHARED_NETWORK_NAME);
 612
 613	    try {
 614	      await network.connect({
 615	        Container: containerId,
 616	        EndpointConfig: { Aliases: [alias] },
 617	      });
 618	    } catch (error) {
 619	      const msg = error instanceof Error ? error.message : String(error);
 620	      if (msg.includes('already exists') || msg.includes('already connected')) {
 621	        return;
 622	      }
 623
 624	      throw error;
 625	    }
 626	  }
 627
 628	  private writeSecretFiles(containerName: string, files: SecretFileMount[]): string[] {
 629	    if (files.length === 0) return [];
 630
 631	    const secretsDir = join(getDataDir(), 'container-secrets', containerName);
 632	    mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
 633
 634	    const binds: string[] = [];
 635	    for (const file of files) {
 636	      const hostPath = join(secretsDir, file.filename);
 637	      writeFileSync(hostPath, file.content, { mode: 0o600 });
 638	      binds.push(`${hostPath}:${file.mountPath}:ro`);
 639	    }
 640	    return binds;
 641	  }
 642
 643	  private async getProjectVolumeBinds(projectName: string): Promise<string[]> {
 644	    try {
 645	      const result = await this.client.listVolumes({
 646	        filters: {
 647	          label: [
 648	            `${DOCKER_LABELS.MANAGED}=true`,
 649	            `${DOCKER_LABELS.ROLE}=volume`,
 650	            `${DOCKER_LABELS.PROJECT}=${projectName}`,
 651	          ],
 652	        },
 653	      });
 654	      const volumes = Array.isArray(result.Volumes) ? result.Volumes : [];
 655	      const volumeBinds: string[] = [];
 656	      for (const vol of volumes) {
 657	        const name = vol.Name;
 658	        const labels = vol.Labels as Record<string, string> | undefined;
 659	        if (!labels) continue;
 660	        const mountPath = labels[DOCKER_LABELS.MOUNT_PATH];
 661	        if (typeof mountPath === 'string' && mountPath.startsWith('/')) {
 662	          volumeBinds.push(`${name}:${mountPath}:rw`);
 663	        }
 664	      }
 665	      return volumeBinds;
 666	    } catch {
 667	      return [];
 668	    }
 669	  }
 670
 671	  cleanupSecretFiles(containerName: string): void {
 672	    const secretsDir = join(getDataDir(), 'container-secrets', containerName);
 673	    try {
 674	      rmSync(secretsDir, { recursive: true, force: true });
 675	    } catch (_) {
 676	      /* best-effort */
 677	    }
 678	  }
 679
 680	  private async resolveExtraHosts(): Promise<string[]> {
 681	    try {
 682	      const info = (await this.client.info()) as {
 683	        OperatingSystem?: string;
 684	      };
 685
 686	      if (info.OperatingSystem?.includes('Docker Desktop')) {
 687	        return [];
 688	      }
 689	    } catch {
 690	      return [];
 691	    }
 692
 693	    // Prefer concrete gateway IP — host-gateway relies on daemon resolution
 694	    // which fails on some configurations (Podman, misconfigured daemons, WSL)
 695	    try {
 696	      const network = (await this.client.getNetwork(this.networkName).inspect()) as {
 697	        IPAM?: { Config?: Array<{ Gateway?: string }> };
 698	      };
 699	      const gateway = network.IPAM?.Config?.[0]?.Gateway;
 700	      if (gateway && /^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
 701	        return [`host.docker.internal:${gateway}`];
 702	      }
 703	    } catch (_) {
 704	      /* network inspect may fail */
 705	    }
 706
 707	    return [];
 708	  }
 709
 710	  /** Get the first EXPOSE port from a Docker image. Returns undefined if none found. */
 711	  async getImageExposedPort(imageTag: string): Promise<number | undefined> {
 712	    try {
 713	      const image = this.client.getImage(imageTag);
 714	      const info = await image.inspect();
 715	      const keys = Object.keys(info.Config.ExposedPorts);
 716	      const first = keys[0]; // e.g. "80/tcp"
 717	      if (!first) return undefined;
 718	      const portStr = first.split('/')[0];
 719	      if (!portStr) return undefined;
 720	      const port = parseInt(portStr, 10);
 721	      return isNaN(port) ? undefined : port;
 722	    } catch (_err) {
 723	      return undefined;
 724	    }
 725	  }
 726
 727	  /** Stop a running container. */
 728	  async stopContainer(containerId: string): Promise<void> {
 729	    try {
 730	      const container = this.client.getContainer(containerId);
 731	      await container.stop();
 732	    } catch (error) {
 733	      const msg = error instanceof Error ? error.message : String(error);
 734	      if (isDockerNotFoundError(error)) {
 735	        throw new ContainerNotFoundError(containerId);
 736	      }
 737	      // Already stopped is not an error
 738	      if (!msg.includes('is not running')) {
 739	        throw error;
 740	      }
 741	    }
 742	  }
 743
 744	  /** Start a stopped container. */
 745	  async startContainer(containerId: string): Promise<void> {
 746	    try {
 747	      const container = this.client.getContainer(containerId);
 748	      await container.start();
 749	    } catch (error) {
 750	      const msg = error instanceof Error ? error.message : String(error);
 751	      if (isDockerNotFoundError(error)) {
 752	        throw new ContainerNotFoundError(containerId);
 753	      }
 754	      // Already running is not an error
 755	      if (!msg.includes('is already running') && !msg.includes('already started')) {
 756	        throw error;
 757	      }
 758	    }
 759	  }
 760
 761	  /** Remove a container (force removes even if running). */
 762	  async removeContainer(containerId: string): Promise<void> {
 763	    try {
 764	      const container = this.client.getContainer(containerId);
 765	      await container.remove({ force: true });
 766	    } catch (error) {
 767	      if (isDockerNotFoundError(error)) {
 768	        return;
 769	      }
 770	      throw error;
 771	    }
 772	  }
 773
 774	  async safeRemoveContainer(containerId: string): Promise<void> {
 775	    await this.removeContainer(containerId);
 776
 777	    const maxAttempts = 5;
 778	    const intervalMs = 200;
 779	    for (let attempt = 0; attempt < maxAttempts; attempt++) {
 780	      try {
 781	        const container = this.client.getContainer(containerId);
 782	        await container.inspect();
 783	        await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
 784	      } catch (error) {
 785	        const msg = error instanceof Error ? error.message : String(error);
 786	        if (
 787	          isDockerNotFoundError(error) ||
 788	          msg.includes('ECONNREFUSED') ||
 789	          msg.includes('ENOENT')
 790	        ) {
 791	          return;
 792	        }
 793
 794	        log.debug({ containerId, err: error }, 'Unexpected error during removal polling');
 795	        return;
 796	      }
 797	    }
 798
 799	    log.warn({ containerId }, 'Container sandbox cleanup polling timed out — proceeding anyway');
 800	  }
 801
 802	  async tagImage(sourceTag: string, repo: string, newTag: string): Promise<void> {
 803	    const image = this.client.getImage(sourceTag);
 804	    await image.tag({ repo, tag: newTag });
 805	  }
 806
 807	  /** Disconnect a container from a network before removal to avoid sandbox cleanup races. */
 808	  async disconnectContainerFromNetwork(containerId: string, networkName: string): Promise<void> {
 809	    try {
 810	      const network = this.client.getNetwork(networkName);
 811	      await network.disconnect({ Container: containerId, Force: true });
 812	    } catch (error) {
 813	      const msg = error instanceof Error ? error.message : String(error);
 814	      if (msg.includes('is not connected') || isDockerNotFoundError(error)) {
 815	        return;
 816	      }
 817	      throw error;
 818	    }
 819	  }
 820
 821	  /** Inspect a container and return full metadata. */
 822	  async inspectContainer(containerId: string): Promise<Dockerode.ContainerInspectInfo> {
 823	    try {
 824	      const container = this.client.getContainer(containerId);
 825	      return await container.inspect();
 826	    } catch (error) {
 827	      if (isDockerNotFoundError(error)) {
 828	        throw new ContainerNotFoundError(containerId);
 829	      }
 830	      throw error;
 831	    }
 832	  }
 833
 834	  /** Connect a container to a network with optional aliases. Silently succeeds if already connected. */
 835	  async connectContainerToNetwork(
 836	    containerId: string,
 837	    networkName: string,
 838	    aliases?: string[],
 839	  ): Promise<void> {
 840	    try {
 841	      const network = this.client.getNetwork(networkName);
 842	      await network.connect({
 843	        Container: containerId,
 844	        EndpointConfig: aliases ? { Aliases: aliases } : undefined,
 845	      });
 846	    } catch (error) {
 847	      const msg = error instanceof Error ? error.message : String(error);
 848	      if (msg.includes('already exists') || msg.includes('already connected')) {
 849	        return;
 850	      }
 851	      throw error;
 852	    }
 853	  }
 854
 855	  /** Restart a running container. */
 856	  async restartContainer(containerId: string): Promise<void> {
 857	    try {
 858	      const container = this.client.getContainer(containerId);
 859	      await container.restart();
 860	    } catch (error) {
 861	      if (isDockerNotFoundError(error)) {
 862	        throw new ContainerNotFoundError(containerId);
 863	      }
 864	      throw error;
 865	    }
 866	  }
 867
 868	  /** Execute a non-interactive command in a container and return structured output. */
 869	  async execSimple(
 870	    containerId: string,
 871	    cmd: string[],
 872	  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
 873	    const container = this.client.getContainer(containerId);
 874	    const exec = await container.exec({
 875	      Cmd: cmd,
 876	      AttachStdout: true,
 877	      AttachStderr: true,
 878	    });
 879
 880	    const stream = await exec.start({ hijack: false, stdin: false });
 881	    const stdoutChunks: Buffer[] = [];
 882	    const stderrChunks: Buffer[] = [];
 883	    const stdoutStream = new PassThrough();
 884	    const stderrStream = new PassThrough();
 885
 886	    stdoutStream.on('data', (chunk: Buffer) => {
 887	      stdoutChunks.push(chunk);
 888	    });
 889	    stderrStream.on('data', (chunk: Buffer) => {
 890	      stderrChunks.push(chunk);
 891	    });
 892
 893	    this.client.modem.demuxStream(stream, stdoutStream, stderrStream);
 894
 895	    await new Promise<void>((resolve, reject) => {
 896	      stream.on('error', reject);
 897	      stream.on('end', resolve);
 898	    });
 899
 900	    const info = await exec.inspect();
 901	    return {
 902	      exitCode: info.ExitCode ?? 0,
 903	      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
 904	      stderr: Buffer.concat(stderrChunks).toString('utf8'),
 905	    };
 906	  }
 907
 908	  /** Inspect a Docker network and return its metadata. */
 909	  async getNetworkInfo(networkName: string): Promise<Dockerode.NetworkInspectInfo> {
 910	    try {

exec
/bin/bash -lc "sed -n '1,220p' test/pipeline/docker-methods.test.ts" in /home/lee/OpenLander
succeeded in 0ms:
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

import { Docker } from '../../src/pipeline/docker.js';

// ---------------------------------------------------------------------------
// Mock setup (same pattern as test/docker.test.ts)
// ---------------------------------------------------------------------------

const mockPing = vi.fn();
const mockListContainers = vi.fn();
const mockBuildImage = vi.fn();
const mockCreateContainer = vi.fn();
const mockGetImage = vi.fn();
const mockGetContainer = vi.fn();
const mockFollowProgress = vi.fn();
const mockGetNetwork = vi.fn();
const mockDemuxStream = vi.fn();

const require = createRequire(import.meta.url);
const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
this.ping = mockPing;
this.listContainers = mockListContainers;
this.buildImage = mockBuildImage;
this.createContainer = mockCreateContainer;
this.getImage = mockGetImage;
this.getContainer = mockGetContainer;
this.getNetwork = mockGetNetwork;
this.modem = {
  followProgress: mockFollowProgress,
  demuxStream: mockDemuxStream,
};
});

const dockerodePath = require.resolve('dockerode');
require.cache[dockerodePath] = {
id: dockerodePath,
filename: dockerodePath,
loaded: true,
exports: mockDockerodeClass,
} as unknown as NodeJS.Module;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetMocks = () => {
mockPing.mockReset().mockResolvedValue('OK');
mockListContainers.mockReset().mockResolvedValue([]);
mockBuildImage.mockReset();
mockCreateContainer.mockReset();
mockGetImage.mockReset();
mockGetContainer.mockReset();
mockFollowProgress.mockReset();
mockGetNetwork.mockReset();
mockDemuxStream.mockReset();
};

/** Creates a Docker "not found" error that matches isDockerNotFoundError. */
const notFoundError = (msg: string) => new Error(`No such container: ${msg}`);
const networkNotFoundError = (msg: string) => new Error(`No such network: ${msg}`);

// ---------------------------------------------------------------------------
// Tests: inspectContainer
// ---------------------------------------------------------------------------

describe('inspectContainer', () => {
beforeEach(resetMocks);
afterEach(() => vi.restoreAllMocks());

it('returns container inspect info on success', async () => {
  const inspectData = {
    Id: 'abc123',
    State: { Running: true, Status: 'running' },
    Config: { Image: 'myapp:latest' },
  };
  mockGetContainer.mockReturnValueOnce({
    inspect: vi.fn().mockResolvedValueOnce(inspectData),
  });

  const docker = new Docker();
  const result = await docker.inspectContainer('abc123');

  expect(result).toEqual(inspectData);
  expect(mockGetContainer).toHaveBeenCalledWith('abc123');
});

it('throws ContainerNotFoundError when container does not exist', async () => {
  mockGetContainer.mockReturnValueOnce({
    inspect: vi.fn().mockRejectedValueOnce(notFoundError('missing-id')),
  });

  const docker = new Docker();
  await expect(docker.inspectContainer('missing-id')).rejects.toMatchObject({
    name: 'ContainerNotFoundError',
  });
});

it('re-throws non-404 errors as-is', async () => {
  mockGetContainer.mockReturnValueOnce({
    inspect: vi.fn().mockRejectedValueOnce(new Error('permission denied')),
  });

  const docker = new Docker();
  await expect(docker.inspectContainer('denied')).rejects.toThrow('permission denied');
});
});

// ---------------------------------------------------------------------------
// Tests: connectContainerToNetwork
// ---------------------------------------------------------------------------

describe('connectContainerToNetwork', () => {
beforeEach(resetMocks);
afterEach(() => vi.restoreAllMocks());

it('connects container to network successfully', async () => {
  const connectFn = vi.fn().mockResolvedValueOnce(undefined);
  mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

  const docker = new Docker();
  await docker.connectContainerToNetwork('c1', 'openlander');

  expect(mockGetNetwork).toHaveBeenCalledWith('openlander');
  expect(connectFn).toHaveBeenCalledWith({
    Container: 'c1',
    EndpointConfig: undefined,
  });
});

it('passes aliases in EndpointConfig when provided', async () => {
  const connectFn = vi.fn().mockResolvedValueOnce(undefined);
  mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

  const docker = new Docker();
  await docker.connectContainerToNetwork('c1', 'openlander', ['myapp', 'api']);

  expect(connectFn).toHaveBeenCalledWith({
    Container: 'c1',
    EndpointConfig: { Aliases: ['myapp', 'api'] },
  });
});

it('silently returns when container is already connected (already exists)', async () => {
  const connectFn = vi
    .fn()
    .mockRejectedValueOnce(
      new Error('endpoint with name c1 already exists in network openlander'),
    );
  mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

  const docker = new Docker();
  await expect(docker.connectContainerToNetwork('c1', 'openlander')).resolves.toBeUndefined();
});

it('silently returns when "already connected" message', async () => {
  const connectFn = vi
    .fn()
    .mockRejectedValueOnce(new Error('container already connected to network'));
  mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

  const docker = new Docker();
  await expect(docker.connectContainerToNetwork('c1', 'net1')).resolves.toBeUndefined();
});

it('re-throws unexpected errors', async () => {
  const connectFn = vi.fn().mockRejectedValueOnce(new Error('network driver failed'));
  mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

  const docker = new Docker();
  await expect(docker.connectContainerToNetwork('c1', 'net1')).rejects.toThrow(
    'network driver failed',
  );
});
});

// ---------------------------------------------------------------------------
// Tests: restartContainer
// ---------------------------------------------------------------------------

describe('restartContainer', () => {
beforeEach(resetMocks);
afterEach(() => vi.restoreAllMocks());

it('restarts container successfully', async () => {
  const restartFn = vi.fn().mockResolvedValueOnce(undefined);
  mockGetContainer.mockReturnValueOnce({ restart: restartFn });

  const docker = new Docker();
  await docker.restartContainer('c1');

  expect(mockGetContainer).toHaveBeenCalledWith('c1');
  expect(restartFn).toHaveBeenCalledTimes(1);
});

it('throws ContainerNotFoundError when container does not exist', async () => {
  mockGetContainer.mockReturnValueOnce({
    restart: vi.fn().mockRejectedValueOnce(notFoundError('gone')),
  });

  const docker = new Docker();
  await expect(docker.restartContainer('gone')).rejects.toMatchObject({
    name: 'ContainerNotFoundError',
  });
});

it('re-throws non-404 errors as-is', async () => {
  mockGetContainer.mockReturnValueOnce({
    restart: vi.fn().mockRejectedValueOnce(new Error('daemon busy')),
  });

  const docker = new Docker();
  await expect(docker.restartContainer('busy')).rejects.toThrow('daemon busy');
});
});

// ---------------------------------------------------------------------------
// Tests: execSimple
// ---------------------------------------------------------------------------

codex
**Findings**

1. High: recovered built-in services lose their Docker healthchecks. The old recovery path recreated the container with `template.healthcheck`; the new path routes through `runContainer()`, which has no healthcheck support and only receives `cmd`. That changes MinIO/RabbitMQ recovery behavior in a real way. [recover.ts:156](/home/lee/OpenLander/src/pipeline/recover.ts#L156) [recover.ts:163](/home/lee/OpenLander/src/pipeline/recover.ts#L163) [service-manager.ts:350](/home/lee/OpenLander/src/pipeline/service-manager.ts#L350) [service-manager.ts:437](/home/lee/OpenLander/src/pipeline/service-manager.ts#L437)

2. High: the `recover.ts` env-var transformation is not safe against the format this codebase actually stores. `ServiceManager.create()` persists `opts.envVars` as JSON for an array of `{ key, value }` objects, but recovery now parses `service.env_vars` as `string[]` and only accepts `KEY=VALUE` entries. In the common created-service path, user env vars will be silently dropped during recovery. [service-manager.ts:324](/home/lee/OpenLander/src/pipeline/service-manager.ts#L324) [service-manager.ts:325](/home/lee/OpenLander/src/pipeline/service-manager.ts#L325) [service-manager.ts:497](/home/lee/OpenLander/src/pipeline/service-manager.ts#L497) [recover.ts:147](/home/lee/OpenLander/src/pipeline/recover.ts#L147)

3. Medium: `execInServiceContainer()` regressed timeout behavior when it moved onto `docker.execSimple()`. The old code destroyed the exec stream on timeout, preserved partial output, and cleared the timer. The new `Promise.race` leaves the underlying exec running, returns empty output on timeout, and never clears the timeout on success. That is both a resource-leak risk and a diagnostics regression. [shared.ts:24](/home/lee/OpenLander/src/pipeline/service-adapters/shared.ts#L24) [shared.ts:28](/home/lee/OpenLander/src/pipeline/service-adapters/shared.ts#L28) [shared.ts:44](/home/lee/OpenLander/src/pipeline/service-adapters/shared.ts#L44) [docker.ts:868](/home/lee/OpenLander/src/pipeline/docker.ts#L868)

**Notes**

The core race fix in [docker.ts:432](/home/lee/OpenLander/src/pipeline/docker.ts#L432) and [docker.ts:774](/home/lee/OpenLander/src/pipeline/docker.ts#L774) is directionally sound. Removing the create-time plus post-start dual attach path is the right fix, and force-remove plus bounded polling is better than pre-disconnect plus remove. Residual caveat: the poll only proves `container.inspect()` reaches 404, not that endpoint cleanup is fully visible in network state.

Leaving the backup/restore helpers on raw `createContainer()` looks justified. Those containers are ephemeral `AutoRemove` tar jobs and do not fit the `runContainer()` contract well. [service-manager.ts:643](/home/lee/OpenLander/src/pipeline/service-manager.ts#L643) [service-manager.ts:690](/home/lee/OpenLander/src/pipeline/service-manager.ts#L690)

Coverage is thin around the risky migrations. I’d add tests for recovery preserving service env vars and healthchecks, plus timeout/truncation semantics for `execInServiceContainer()`. The new Docker-focused tests passed: `npx vitest run test/pipeline/docker-sandbox.test.ts test/pipeline/docker-methods.test.ts`.
tokens used
84,210

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
