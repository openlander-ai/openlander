# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-04-11T02:36:12.360Z

## Original task

You are reviewing the PR2+PR3 Docker layer consolidation for OpenLander. Plan: .sisyphus/plans/docker-layer-pr2-pr3.md. This work follows PR1 which fixed the sandbox bug and added initial wrapper methods.

SCOPE: Eliminate ALL 55 raw getClient() calls across 21 files, add 13 new docker.ts wrapper methods, then REMOVE getClient() entirely.

Commits (5cd9a29..995ab0b): 9 commits adding 13 methods, migrating 21 files, removing getClient, adding tests.

KNOWN ISSUES I've already found:

1. getClient() NOT fully removed — 2 calls remain:
   - deploy-core.ts:966 — transient container for image commit (plan says to migrate)
   - traefik.ts:161 — createNetwork via (this.docker as any).getClient() cast (PR3 was supposed to handle this)

2. eslint-disable no-deprecated comments: 6 remain in mcp/server.ts but those are about MCP SDK Server class, not Docker — may be acceptable.

Please review the full diff for:

- Any OTHER remaining getClient() calls I missed
- New docker.ts methods: correctness of error handling, proper pattern following
- runServiceContainer: does it correctly replicate service-manager.ts createContainer behavior?
- execStream: is the TTY exec pattern safe for WebSocket bridging?
- getEventStream: proper stream lifecycle management?
- Migration regressions: did any file change behavior unintentionally?
- Test coverage: are the 13 new methods adequately tested?
- deploy-core.ts commit pattern: is it safe to use getClient() dynamically like line 960-966?
- traefik.ts createNetwork: should this use ensureProjectNetwork() or a new createNetwork method?

Run: git diff 217a28c..995ab0b -- src/pipeline/docker.ts src/pipeline/deploy-core.ts src/pipeline/traefik.ts src/pipeline/service-manager.ts src/pipeline/recover.ts src/monitor/ src/tools/defs/ src/web/ test/pipeline/docker-methods.test.ts

## Final prompt

You are reviewing the PR2+PR3 Docker layer consolidation for OpenLander. Plan: .sisyphus/plans/docker-layer-pr2-pr3.md. This work follows PR1 which fixed the sandbox bug and added initial wrapper methods.

SCOPE: Eliminate ALL 55 raw getClient() calls across 21 files, add 13 new docker.ts wrapper methods, then REMOVE getClient() entirely.

Commits (5cd9a29..995ab0b): 9 commits adding 13 methods, migrating 21 files, removing getClient, adding tests.

KNOWN ISSUES I've already found:

1. getClient() NOT fully removed — 2 calls remain:
   - deploy-core.ts:966 — transient container for image commit (plan says to migrate)
   - traefik.ts:161 — createNetwork via (this.docker as any).getClient() cast (PR3 was supposed to handle this)

2. eslint-disable no-deprecated comments: 6 remain in mcp/server.ts but those are about MCP SDK Server class, not Docker — may be acceptable.

Please review the full diff for:

- Any OTHER remaining getClient() calls I missed
- New docker.ts methods: correctness of error handling, proper pattern following
- runServiceContainer: does it correctly replicate service-manager.ts createContainer behavior?
- execStream: is the TTY exec pattern safe for WebSocket bridging?
- getEventStream: proper stream lifecycle management?
- Migration regressions: did any file change behavior unintentionally?
- Test coverage: are the 13 new methods adequately tested?
- deploy-core.ts commit pattern: is it safe to use getClient() dynamically like line 960-966?
- traefik.ts createNetwork: should this use ensureProjectNetwork() or a new createNetwork method?

Run: git diff 217a28c..995ab0b -- src/pipeline/docker.ts src/pipeline/deploy-core.ts src/pipeline/traefik.ts src/pipeline/service-manager.ts src/pipeline/recover.ts src/monitor/ src/tools/defs/ src/web/ test/pipeline/docker-methods.test.ts

## Raw output

```text
**Findings**

- High: `inspectVolume()` now turns Docker 404s into a plain `Error("Volume not found: ...")`, but the volume tools still key off `isDockerNotFoundError(error)`. In `995ab0b`, `add_volume` will now fail on a missing volume instead of treating that as the create path, and `remove_volume` will misclassify missing-volume errors. Refs: `src/pipeline/docker.ts:1223-1228`, `src/tools/defs/volume.ts:85-99`, `src/tools/defs/volume.ts:232-241`.

- High: `markRollbackImage()` still depends on a dynamically-probed `getClient()` even though this PR removes `getClient()` from `docker.ts`. Once `getClient()` is gone, this path returns early and rollback image labeling silently stops happening. That makes the consolidation incomplete and changes deploy behavior at runtime. Refs: `src/pipeline/deploy-core.ts:947-966` in `995ab0b`, plus `src/pipeline/docker.ts` in `995ab0b` no longer exposes `getClient()`.

- Medium: `TraefikManager.ensureNetworkByName()` still bypasses the wrapper layer via `(this.docker as any).getClient().createNetwork()`, even though `docker.ensureNetwork()` now exists. So `getClient()` is not actually eliminated, and Traefik remains coupled to raw Dockerode. Refs: `src/pipeline/traefik.ts:159-166`, `src/pipeline/docker.ts:1359-1378`.

- Medium: The added tests are too shallow for the highest-risk wrappers. `runServiceContainer` only checks labels/start and create failure, but not `RestartPolicy`, `PortBindings`, `Binds`, shared-network aliasing, `Cmd`, or healthcheck nanosecond conversion. There are also no tests for `listDanglingImages`, `ensureNetwork`, `getLogStream`, or `execTerminal`. Refs: `test/pipeline/docker-methods.test.ts:722-765`; no matching `describe(...)` blocks for the other wrappers in `995ab0b`.

**Notes**

No other `getClient()` usages showed up in the reviewed scope beyond the two you already found.

`runServiceContainer` itself is very close to the old `service-manager` createContainer behavior. The only semantic drift I noticed is that service env vars now round-trip through a `Record<string,string>`, which collapses duplicate keys and may reorder them.

`execStream` with the default `tty: true` is fine for WebSocket-style terminal bridging because Docker does not multiplex stdout/stderr in TTY mode. The `tty: false` branch is not safe as a generic bridge unless a caller demuxes Docker’s framed stream first.

`getEventStream` is just a pass-through wrapper; the lifecycle logic is still in `src/monitor/docker-events.ts` and is unchanged by this PR. Residual risk remains there: on `error`, the listener logs but only reconnects if the stream also emits `close` or `end`.

Targeted verification: `npx vitest run test/pipeline/docker-methods.test.ts` passes on the current workspace.


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
session id: 019d7a61-5571-74d2-905c-a9f8967decc2
--------
user
You are reviewing the PR2+PR3 Docker layer consolidation for OpenLander. Plan: .sisyphus/plans/docker-layer-pr2-pr3.md. This work follows PR1 which fixed the sandbox bug and added initial wrapper methods.

SCOPE: Eliminate ALL 55 raw getClient() calls across 21 files, add 13 new docker.ts wrapper methods, then REMOVE getClient() entirely.

Commits (5cd9a29..995ab0b): 9 commits adding 13 methods, migrating 21 files, removing getClient, adding tests.

KNOWN ISSUES I've already found:
1. getClient() NOT fully removed — 2 calls remain:
   - deploy-core.ts:966 — transient container for image commit (plan says to migrate)
   - traefik.ts:161 — createNetwork via (this.docker as any).getClient() cast (PR3 was supposed to handle this)

2. eslint-disable no-deprecated comments: 6 remain in mcp/server.ts but those are about MCP SDK Server class, not Docker — may be acceptable.

Please review the full diff for:
- Any OTHER remaining getClient() calls I missed
- New docker.ts methods: correctness of error handling, proper pattern following
- runServiceContainer: does it correctly replicate service-manager.ts createContainer behavior?
- execStream: is the TTY exec pattern safe for WebSocket bridging?
- getEventStream: proper stream lifecycle management?
- Migration regressions: did any file change behavior unintentionally?
- Test coverage: are the 13 new methods adequately tested?
- deploy-core.ts commit pattern: is it safe to use getClient() dynamically like line 960-966?
- traefik.ts createNetwork: should this use ensureProjectNetwork() or a new createNetwork method?

Run: git diff 217a28c..995ab0b -- src/pipeline/docker.ts src/pipeline/deploy-core.ts src/pipeline/traefik.ts src/pipeline/service-manager.ts src/pipeline/recover.ts src/monitor/ src/tools/defs/ src/web/ test/pipeline/docker-methods.test.ts
codex
Reviewing the PR2/PR3 consolidation diff now. I’m checking the targeted files for any remaining `getClient()` usage, wrapper-method correctness, migration regressions, and whether the added tests actually cover the new surface area.
exec
/bin/bash -lc 'git diff 217a28c..995ab0b -- src/pipeline/docker.ts src/pipeline/deploy-core.ts src/pipeline/traefik.ts src/pipeline/service-manager.ts src/pipeline/recover.ts src/monitor/ src/tools/defs/ src/web/ test/pipeline/docker-methods.test.ts' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/src/monitor/alerts.ts b/src/monitor/alerts.ts
index 390f214..6ea6880 100644
--- a/src/monitor/alerts.ts
+++ b/src/monitor/alerts.ts
@@ -276,7 +276,6 @@ export class AlertMonitor {
   }

   private async checkContainerRestartLoops(): Promise<void> {
-    const dockerClient = this.docker.getClient();
     const projects = this.db.listProjects('running');

     for (const project of projects) {
@@ -285,8 +284,7 @@ export class AlertMonitor {
       const key = `restart-loop:${project.container_id}`;

       try {
-        const container = dockerClient.getContainer(project.container_id);
-        const info = await container.inspect();
+        const info = await this.docker.inspectContainer(project.container_id);
         const restartCount: number = (info.RestartCount as number | undefined) ?? 0;

         // Check if container was restarted recently (within 24h)
@@ -329,10 +327,7 @@ export class AlertMonitor {
     const key = 'dangling-images:system';

     try {
-      const dockerClient = this.docker.getClient();
-      const images = await dockerClient.listImages({
-        filters: { dangling: ['true'] },
-      });
+      const images = await this.docker.listDanglingImages();

       if (images.length < DANGLING_IMAGES_THRESHOLD) {
         this.resolveAlert(key, 'dangling-images');
@@ -541,7 +536,6 @@ export class AlertMonitor {
   }

   private async checkContainerCrashes(): Promise<void> {
-    const dockerClient = this.docker.getClient();
     const projects = this.db.listProjects();

     for (const project of projects) {
@@ -551,8 +545,7 @@ export class AlertMonitor {
       const key = `container-crash:${project.container_id}`;

       try {
-        const container = dockerClient.getContainer(project.container_id);
-        const info = await container.inspect();
+        const info = await this.docker.inspectContainer(project.container_id);
         const state = info.State;
         const restartCount: number = (info.RestartCount as number | undefined) ?? 0;

@@ -634,7 +627,6 @@ export class AlertMonitor {
   }

   private async checkContainerMemory(): Promise<void> {
-    const dockerClient = this.docker.getClient();
     const projects = this.db.listProjects('running');

     for (const project of projects) {
@@ -643,9 +635,8 @@ export class AlertMonitor {
       const key = `resource-saturation:${project.container_id}`;

       try {
-        const container = dockerClient.getContainer(project.container_id);
-        const statsStream = await container.stats({ stream: false });
-        const stats = statsStream as unknown as {
+        const statsRaw = await this.docker.getContainerStats(project.container_id);
+        const stats = statsRaw as {
           memory_stats?: { usage?: number; limit?: number };
         };

@@ -691,8 +682,7 @@ export class AlertMonitor {

   private async checkOrphanContainers(): Promise<void> {
     try {
-      const dockerClient = this.docker.getClient();
-      const containers = await dockerClient.listContainers({ all: true });
+      const containers = await this.docker.listAllContainers();

       const projects = this.db.listProjects();
       const services = this.db.listServices();
@@ -707,17 +697,15 @@ export class AlertMonitor {

       const orphans: { id: string; name: string; state: string }[] = [];
       for (const container of containers) {
-        const names = container.Names.map((n: string) => n.replace(/^\//, ''));
-        const isOpenLanderContainer = names.some(
-          (n: string) => n.startsWith('ol-') || n.startsWith('openlander'),
-        );
+        const isOpenLanderContainer =
+          container.name.startsWith('ol-') || container.name.startsWith('openlander');
         if (!isOpenLanderContainer) continue;
-        if (knownContainerIds.has(container.Id)) continue;
+        if (knownContainerIds.has(container.id)) continue;

         orphans.push({
-          id: container.Id.slice(0, 12),
-          name: names[0] || container.Id.slice(0, 12),
-          state: container.State,
+          id: container.id.slice(0, 12),
+          name: container.name || container.id.slice(0, 12),
+          state: container.state,
         });
       }

diff --git a/src/monitor/docker-events.ts b/src/monitor/docker-events.ts
index 460c242..04a0cd8 100644
--- a/src/monitor/docker-events.ts
+++ b/src/monitor/docker-events.ts
@@ -77,17 +77,10 @@ export class DockerEventListener {
   private async watch(): Promise<void> {
     while (this.running) {
       try {
-        const client = this.docker.getClient();
-        const stream = await (
-          client.getEvents as (opts: {
-            filters: Record<string, string[]>;
-          }) => Promise<NodeJS.ReadableStream>
-        )({
-          filters: {
-            type: ['container'],
-            event: ['die', 'oom', 'start'],
-            label: [`${DOCKER_LABELS.MANAGED}=true`],
-          },
+        const stream = await this.docker.getEventStream({
+          type: ['container'],
+          event: ['die', 'oom', 'start'],
+          label: [`${DOCKER_LABELS.MANAGED}=true`],
         });

         this.stream = stream;
diff --git a/src/monitor/health.ts b/src/monitor/health.ts
index 0c64c62..5811d6f 100644
--- a/src/monitor/health.ts
+++ b/src/monitor/health.ts
@@ -191,8 +191,7 @@ export class HealthMonitor {
         const containerRef = service.container_id ?? service.container_name;

         try {
-          const container = this.docker.getClient().getContainer(containerRef);
-          const info = await container.inspect();
+          const info = await this.docker.inspectContainer(containerRef);

           if (!info.State.Running) {
             if (service.status === 'running') {
@@ -319,8 +318,7 @@ export class HealthMonitor {
     const ensuredContainerId = containerId;

     try {
-      const container = this.docker.getClient().getContainer(ensuredContainerId);
-      const info = await container.inspect();
+      const info = await this.docker.inspectContainer(ensuredContainerId);

       const restartCount = info.RestartCount;

@@ -521,15 +519,7 @@ export class HealthMonitor {
     tail = INCIDENT_ERROR_SNIPPET_LINES,
   ): Promise<string | null> {
     try {
-      const container = this.docker.getClient().getContainer(containerId);
-      const logs = await container.logs({
-        stdout: false,
-        stderr: true,
-        tail,
-        follow: false,
-      });
-      const buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(logs as string);
-      const decoded = stripDockerStreamHeaders(buffer).trim();
+      const decoded = (await this.docker.getLogs(containerId, tail)).trim();
       return decoded.length > 0 ? decoded : null;
     } catch (error) {
       log.debug({ containerId, error }, 'Failed to read container stderr snippet');
@@ -587,37 +577,3 @@ export class HealthMonitor {
     }
   }
 }
-
-function stripDockerStreamHeaders(buffer: Buffer): string {
-  if (buffer.length === 0) return '';
-
-  const firstByte = buffer[0];
-  if (firstByte !== 0 && firstByte !== 1 && firstByte !== 2) {
-    return buffer.toString('utf8');
-  }
-
-  const HEADER_SIZE = 8;
-  const chunks: string[] = [];
-  let offset = 0;
-
-  while (offset < buffer.length) {
-    if (offset + HEADER_SIZE > buffer.length) {
-      chunks.push(buffer.subarray(offset).toString('utf8'));
-      break;
-    }
-
-    const payloadSize = buffer.readUInt32BE(offset + 4);
-    const payloadStart = offset + HEADER_SIZE;
-    const payloadEnd = payloadStart + payloadSize;
-
-    if (payloadEnd > buffer.length) {
-      chunks.push(buffer.subarray(payloadStart).toString('utf8'));
-      break;
-    }
-
-    chunks.push(buffer.subarray(payloadStart, payloadEnd).toString('utf8'));
-    offset = payloadEnd;
-  }
-
-  return chunks.join('');
-}
diff --git a/src/monitor/ops-drift.ts b/src/monitor/ops-drift.ts
index b75261c..4539ee7 100644
--- a/src/monitor/ops-drift.ts
+++ b/src/monitor/ops-drift.ts
@@ -62,9 +62,7 @@ export class DriftDetector {
     if (!containerRef) return null;

     try {
-      const client = this.ctx.docker.getClient();
-      const container = client.getContainer(containerRef);
-      const info = await container.inspect();
+      const info = await this.ctx.docker.inspectContainer(containerRef);

       if (!info.State.Running) {
         return {
diff --git a/src/monitor/ops-recovery.ts b/src/monitor/ops-recovery.ts
index 4a2f7ef..94ac116 100644
--- a/src/monitor/ops-recovery.ts
+++ b/src/monitor/ops-recovery.ts
@@ -382,7 +382,7 @@ export class RecoveryPipeline {
     containerId: string,
   ): Promise<{ success: true } | { success: false; reason: string }> {
     try {
-      await this.ctx.docker.getClient().getContainer(containerId).restart();
+      await this.ctx.docker.restartContainer(containerId);
       log.info({ projectId, containerId }, 'Container restart step completed');
       return { success: true };
     } catch (error) {
@@ -664,7 +664,7 @@ export class RecoveryPipeline {

   private async isContainerRunning(containerId: string): Promise<boolean> {
     try {
-      const info = await this.ctx.docker.getClient().getContainer(containerId).inspect();
+      const info = await this.ctx.docker.inspectContainer(containerId);
       return info.State.Running && !info.State.Restarting;
     } catch (error) {
       log.debug({ error, containerId }, 'Container inspect failed during health check');
diff --git a/src/pipeline/deploy-core.ts b/src/pipeline/deploy-core.ts
index 637493c..c903cf4 100644
--- a/src/pipeline/deploy-core.ts
+++ b/src/pipeline/deploy-core.ts
@@ -939,6 +939,11 @@ export class DeployPipeline {
   }

   private async markRollbackImage(imageTag: string): Promise<void> {
+    const [repo, tag] = imageTag.split(':');
+    if (!repo || !tag) {
+      return;
+    }
+
     const dockerWithClient = this.docker as unknown as {
       getClient?: () => {
         createContainer: (opts: {
@@ -952,16 +957,13 @@ export class DeployPipeline {
         }>;
       };
     };
+
     const getClient = dockerWithClient.getClient;
     if (typeof getClient !== 'function') {
       return;
     }
-    const client = getClient();

-    const [repo, tag] = imageTag.split(':');
-    if (!repo || !tag) {
-      return;
-    }
+    const client = getClient();

     const temp = await client.createContainer({
       Image: imageTag,
@@ -1568,8 +1570,7 @@ export class DeployPipeline {

       // Add Traefik labels to the green container so it receives traffic
       const canonicalName = projectContainerName(projectName);
-      const greenContainer = this.docker.getClient().getContainer(greenContainerId);
-      await greenContainer.rename({ name: canonicalName });
+      await this.docker.renameContainer(greenContainerId, canonicalName);
       shouldCleanupGreen = false;

       this.db.updateProject(projectId, {
@@ -1631,8 +1632,7 @@ export class DeployPipeline {
       let blueStillServing = false;
       if (blueContainerId) {
         try {
-          const container = this.docker.getClient().getContainer(blueContainerId);
-          const info = await container.inspect();
+          const info = await this.docker.inspectContainer(blueContainerId);
           blueStillServing = info.State.Running;
         } catch {
           blueStillServing = false;
@@ -1641,8 +1641,7 @@ export class DeployPipeline {

       if (!blueStillServing && blueContainerId) {
         try {
-          const blueContainer = this.docker.getClient().getContainer(blueContainerId);
-          await blueContainer.restart();
+          await this.docker.restartContainer(blueContainerId);
           blueStillServing = true;
           buildLog += '[recovery] Restarted blue container after failed promotion\n';
         } catch (restartErr) {
@@ -1736,8 +1735,7 @@ export class DeployPipeline {

   private async removeStaleGreenContainer(greenName: string): Promise<void> {
     try {
-      const container = this.docker.getClient().getContainer(greenName);
-      await container.inspect();
+      await this.docker.inspectContainer(greenName);
       log.warn({ greenName }, 'Removing stale green container from previous failed deploy');
       await this.docker.safeRemoveContainer(greenName);
     } catch {
diff --git a/src/pipeline/docker.ts b/src/pipeline/docker.ts
index 16dae8a..3f0b2f2 100644
--- a/src/pipeline/docker.ts
+++ b/src/pipeline/docker.ts
@@ -20,6 +20,22 @@ import {
   isDockerNotFoundError,
 } from '../errors.js';

+function isAlreadyConnectedError(msg: string): boolean {
+  return msg.includes('already exists') || msg.includes('already connected');
+}
+
+function isContainerNotRunning(msg: string): boolean {
+  return msg.includes('is not running');
+}
+
+function isContainerAlreadyRunning(msg: string): boolean {
+  return msg.includes('is already running') || msg.includes('already started');
+}
+
+function isNotConnectedToNetwork(msg: string): boolean {
+  return msg.includes('is not connected');
+}
+
 export type DockerStatus =
   | { state: 'running' }
   | { state: 'not_installed' }
@@ -48,6 +64,20 @@ export interface RunContainerOptions {
   restartPolicy?: { Name: string; MaximumRetryCount?: number };
   /** Additional volume or bind mounts (e.g. `["vol:/data"]`). */
   extraBinds?: string[];
+  /** Docker healthcheck configuration (intervals in seconds). */
+  healthcheck?: {
+    test: string | string[];
+    interval?: number;
+    timeout?: number;
+    retries?: number;
+    start_period?: number;
+  };
+  /**
+   * When provided, replaces auto-generated labels entirely.
+   * By default, runContainer adds MANAGED + PROJECT + traefikLabels.
+   * Use this for non-project containers (e.g. services) that need different labels.
+   */
+  labels?: Record<string, string>;
 }

 export interface RunComposeServiceOptions {
@@ -617,7 +647,7 @@ export class Docker {
       });
     } catch (error) {
       const msg = error instanceof Error ? error.message : String(error);
-      if (msg.includes('already exists') || msg.includes('already connected')) {
+      if (isAlreadyConnectedError(msg)) {
         return;
       }

@@ -734,8 +764,7 @@ export class Docker {
       if (isDockerNotFoundError(error)) {
         throw new ContainerNotFoundError(containerId);
       }
-      // Already stopped is not an error
-      if (!msg.includes('is not running')) {
+      if (!isContainerNotRunning(msg)) {
         throw error;
       }
     }
@@ -751,8 +780,7 @@ export class Docker {
       if (isDockerNotFoundError(error)) {
         throw new ContainerNotFoundError(containerId);
       }
-      // Already running is not an error
-      if (!msg.includes('is already running') && !msg.includes('already started')) {
+      if (!isContainerAlreadyRunning(msg)) {
         throw error;
       }
     }
@@ -811,7 +839,7 @@ export class Docker {
       await network.disconnect({ Container: containerId, Force: true });
     } catch (error) {
       const msg = error instanceof Error ? error.message : String(error);
-      if (msg.includes('is not connected') || isDockerNotFoundError(error)) {
+      if (isNotConnectedToNetwork(msg) || isDockerNotFoundError(error)) {
         return;
       }
       throw error;
@@ -845,7 +873,7 @@ export class Docker {
       });
     } catch (error) {
       const msg = error instanceof Error ? error.message : String(error);
-      if (msg.includes('already exists') || msg.includes('already connected')) {
+      if (isAlreadyConnectedError(msg)) {
         return;
       }
       throw error;
@@ -1103,6 +1131,11 @@ export class Docker {
       return [];
     }
   }
+  /** List dangling (untagged) Docker images. */
+  async listDanglingImages(): Promise<Dockerode.ImageInfo[]> {
+    return await this.client.listImages({ filters: { dangling: ['true'] } });
+  }
+
   /**
    * Pull a Docker image from registry.
    * Silently succeeds if the image already exists locally and pull fails
@@ -1133,19 +1166,258 @@ export class Docker {
     }
   }

+  /** Inspect a Docker image. Throws if not found. */
+  async inspectImage(tag: string): Promise<Dockerode.ImageInspectInfo> {
+    try {
+      return await this.client.getImage(tag).inspect();
+    } catch (error) {
+      if (isDockerNotFoundError(error)) throw new Error(`Image not found: ${tag}`);
+      throw error;
+    }
+  }
+
+  /** Remove a Docker image. Silent on 404. */
+  async removeImage(tag: string, force = false): Promise<void> {
+    try {
+      await this.client.getImage(tag).remove({ force });
+    } catch (error) {
+      if (isDockerNotFoundError(error)) return;
+      throw error;
+    }
+  }
+
+  /** Get one-shot container stats (CPU, memory). */
+  async getContainerStats(containerId: string): Promise<unknown> {
+    try {
+      const container = this.client.getContainer(containerId);
+      return await container.stats({ stream: false });
+    } catch (error) {
+      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
+      throw error;
+    }
+  }
+
+  /** Rename a container. */
+  async renameContainer(containerId: string, newName: string): Promise<void> {
+    try {
+      const container = this.client.getContainer(containerId);
+      await container.rename({ name: newName });
+    } catch (error) {
+      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
+      throw error;
+    }
+  }
+
+  /** Wait for a container to exit. Returns exit code. */
+  async waitForContainer(containerId: string): Promise<{ StatusCode: number }> {
+    const container = this.client.getContainer(containerId);
+    return (await container.wait()) as { StatusCode: number };
+  }
+
+  /** Docker system disk usage (images, containers, volumes). */
+  async getDiskUsage(): Promise<unknown> {
+    return await this.client.df();
+  }
+
+  /** Inspect a volume. */
+  async inspectVolume(name: string): Promise<Dockerode.VolumeInspectInfo> {
+    try {
+      return await this.client.getVolume(name).inspect();
+    } catch (error) {
+      if (isDockerNotFoundError(error)) throw new Error(`Volume not found: ${name}`);
+      throw error;
+    }
+  }
+
+  /** List volumes with optional filters. */
+  async listVolumes(filters?: Record<string, string[]>): Promise<Dockerode.VolumeInspectInfo[]> {
+    const result = (await this.client.listVolumes(
+      filters ? { filters } : undefined,
+    )) as unknown as { Volumes?: Dockerode.VolumeInspectInfo[] };
+    return result.Volumes ?? [];
+  }
+
+  /** Create a volume. Always applies MANAGED=true label. */
+  async createVolume(opts: { name: string; labels?: Record<string, string> }): Promise<void> {
+    await this.client.createVolume({
+      Name: opts.name,
+      Labels: {
+        [DOCKER_LABELS.MANAGED]: 'true',
+        ...opts.labels,
+      },
+    });
+  }
+
+  /** Remove a volume. Silent on 404. */
+  async removeVolume(name: string): Promise<void> {
+    try {
+      await this.client.getVolume(name).remove();
+    } catch (error) {
+      if (isDockerNotFoundError(error)) return;
+      throw error;
+    }
+  }
+
+  /** Run a service container (PostgreSQL, Redis, etc.) with SERVICE role labels and unless-stopped restart. */
+  async runServiceContainer(opts: {
+    imageTag: string;
+    name: string;
+    port: number;
+    containerPort?: number;
+    hostPort?: number;
+    envVars: Record<string, string>;
+    serviceName: string;
+    volumeBinds?: string[];
+    healthcheck?: {
+      test: string[];
+      interval: number;
+      timeout: number;
+      retries: number;
+      startPeriod: number;
+    };
+    cmd?: string[];
+  }): Promise<string> {
+    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
+    const containerPort = opts.containerPort ?? opts.port;
+    const hostPort = opts.hostPort ?? opts.port;
+    const networkingConfig = {
+      EndpointsConfig: {
+        [SHARED_NETWORK_NAME]: { Aliases: [opts.serviceName] },
+      },
+    };
+
+    const container = await this.client.createContainer({
+      Image: opts.imageTag,
+      name: opts.name,
+      Env: envArray,
+      ...(opts.cmd ? { Cmd: opts.cmd } : {}),
+      ...(opts.healthcheck
+        ? {
+            Healthcheck: {
+              Test: opts.healthcheck.test,
+              Interval: opts.healthcheck.interval * 1_000_000_000,
+              Timeout: opts.healthcheck.timeout * 1_000_000_000,
+              Retries: opts.healthcheck.retries,
+              StartPeriod: opts.healthcheck.startPeriod * 1_000_000_000,
+            },
+          }
+        : {}),
+      Labels: {
+        [DOCKER_LABELS.MANAGED]: 'true',
+        [DOCKER_LABELS.ROLE]: 'service',
+        [DOCKER_LABELS.SERVICE]: opts.serviceName,
+      },
+      ExposedPorts: { [`${String(containerPort)}/tcp`]: {} },
+      NetworkingConfig: networkingConfig,
+      HostConfig: {
+        NetworkMode: this.networkName,
+        RestartPolicy: { Name: 'unless-stopped' },
+        Binds: opts.volumeBinds ?? [],
+        PortBindings: {
+          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
+        },
+        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
+      },
+    });
+
+    await container.start();
+    return container.id;
+  }
+
+  /** Open an interactive TTY exec stream for WebSocket bridging. Returns duplex stream. */
+  async execStream(
+    containerId: string,
+    cmd: string[],
+    opts?: { tty?: boolean },
+  ): Promise<NodeJS.ReadWriteStream> {
+    const container = this.client.getContainer(containerId);
+    const exec = await container.exec({
+      Cmd: cmd,
+      AttachStdin: true,
+      AttachStdout: true,
+      AttachStderr: true,
+      Tty: opts?.tty ?? true,
+    });
+    return (await exec.start({ hijack: true, stdin: true })) as unknown as NodeJS.ReadWriteStream;
+  }
+
+  /** Get Docker daemon event stream for real-time container events. */
+  async getEventStream(filters: Record<string, string[]>): Promise<NodeJS.ReadableStream> {
+    return await (
+      this.client.getEvents as (opts: {
+        filters: Record<string, string[]>;
+      }) => Promise<NodeJS.ReadableStream>
+    )({
+      filters,
+    });
+  }
+
   getNetworkName(): string {
     return this.networkName;
   }

-  /**
-   * @deprecated Use specific docker.ts methods instead.
-   * This method will be removed once all callers are migrated (PR2/PR3).
-   *
-   * Available methods: inspectContainer, execSimple, connectContainerToNetwork,
-   * restartContainer, getNetworkInfo, runContainer, safeRemoveContainer, etc.
-   */
-  getClient(): Dockerode {
-    return this.client;
+  /** Ensure a Docker network exists, creating it if missing. Returns the network name. */
+  async ensureNetwork(name: string): Promise<string> {
+    try {
+      await this.client.getNetwork(name).inspect();
+      return name;
+    } catch (error) {
+      if (!isDockerNotFoundError(error)) {
+        throw error;
+      }
+    }
+    try {
+      await this.client.createNetwork({ Name: name, Driver: 'bridge' });
+      return name;
+    } catch (error) {
+      const msg = error instanceof Error ? error.message : String(error);
+      if (msg.includes('already exists')) {
+        return name;
+      }
+      throw error;
+    }
+  }
+
+  /** Follow container logs as a readable stream for real-time log tailing. */
+  async getLogStream(
+    containerId: string,
+    opts?: { tail?: number; stdout?: boolean; stderr?: boolean },
+  ): Promise<NodeJS.ReadableStream> {
+    const container = this.client.getContainer(containerId);
+    return (await container.logs({
+      follow: true,
+      stdout: opts?.stdout ?? true,
+      stderr: opts?.stderr ?? true,
+      tail: opts?.tail ?? 50,
+    })) as unknown as NodeJS.ReadableStream;
+  }
+
+  /** Open an interactive terminal exec with resize support. Returns stream and resize function. */
+  async execTerminal(
+    containerId: string,
+    cmd: string[],
+  ): Promise<{
+    stream: NodeJS.ReadWriteStream;
+    resize: (size: { w: number; h: number }) => Promise<void>;
+  }> {
+    const container = this.client.getContainer(containerId);
+    const exec = await container.exec({
+      Cmd: cmd,
+      AttachStdin: true,
+      AttachStdout: true,
+      AttachStderr: true,
+      Tty: true,
+    });
+    const stream = (await exec.start({
+      hijack: true,
+      stdin: true,
+    })) as unknown as NodeJS.ReadWriteStream;
+    return {
+      stream,
+      resize: async (size: { w: number; h: number }) => {
+        await exec.resize(size);
+      },
+    };
   }
 }

diff --git a/src/pipeline/recover.ts b/src/pipeline/recover.ts
index 76b6ce4..9f75ec8 100644
--- a/src/pipeline/recover.ts
+++ b/src/pipeline/recover.ts
@@ -45,8 +45,7 @@ async function containerExists(

 async function imageExists(ctx: AppContext, tag: string): Promise<boolean> {
   try {
-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no image wrapper yet
-    await ctx.docker.getClient().getImage(tag).inspect();
+    await ctx.docker.inspectImage(tag);
     return true;
   } catch {
     return false;
@@ -55,8 +54,7 @@ async function imageExists(ctx: AppContext, tag: string): Promise<boolean> {

 async function volumeExists(ctx: AppContext, name: string): Promise<boolean> {
   try {
-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no volume wrapper yet
-    await ctx.docker.getClient().getVolume(name).inspect();
+    await ctx.docker.inspectVolume(name);
     return true;
   } catch {
     return false;
@@ -68,15 +66,13 @@ async function ensureNetwork(
   name: string,
 ): Promise<RecoverItemResult<NetworkStatus>> {
   try {
-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no network wrapper yet
-    const client = ctx.docker.getClient();
     try {
-      await client.getNetwork(name).inspect();
+      await ctx.docker.getNetworkInfo(name);
       return { name, status: 'existed' };
     } catch {
-      // doesn't exist
+      // Network doesn't exist — will create below
     }
-    await client.createNetwork({ Name: name, Driver: 'bridge' });
+    await ctx.docker.ensureNetwork(name);
     return { name, status: 'created' };
   } catch (error) {
     const msg = error instanceof Error ? error.message : String(error);
@@ -127,11 +123,9 @@ async function recoverService(
     // Ensure volume (preserve existing data!)
     const volExists = await volumeExists(ctx, vName);
     if (!volExists) {
-      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR3: no volume wrapper yet
-      await ctx.docker.getClient().createVolume({
-        Name: vName,
-        Labels: {
-          [DOCKER_LABELS.MANAGED]: 'true',
+      await ctx.docker.createVolume({
+        name: vName,
+        labels: {
           [DOCKER_LABELS.ROLE]: 'service',
           [DOCKER_LABELS.SERVICE]: service.name,
         },
diff --git a/src/pipeline/service-manager.ts b/src/pipeline/service-manager.ts
index cc89325..b7ad589 100644
--- a/src/pipeline/service-manager.ts
+++ b/src/pipeline/service-manager.ts
@@ -222,9 +222,6 @@ export class ServiceManager {
    */
   async reconcileServiceNetworks(): Promise<void> {
     const services = this.db.listServices();
-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-    const client = this.docker.getClient();
-
     let reconciled = 0;
     let migrated = 0;
     let alreadyConnected = 0;
@@ -238,8 +235,7 @@ export class ServiceManager {
       reconciled += 1;

       try {
-        const container = client.getContainer(containerRef);
-        const info = await container.inspect();
+        const info = await this.docker.inspectContainer(containerRef);

         if (!info.State.Running) {
           log.warn(
@@ -415,62 +411,34 @@ export class ServiceManager {

     await this.docker.pullImage(image);

-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-    const client = this.docker.getClient();
-    await client.createVolume({
-      Name: volumeName,
-      Labels: {
-        [DOCKER_LABELS.MANAGED]: 'true',
+    await this.docker.createVolume({
+      name: volumeName,
+      labels: {
         [DOCKER_LABELS.ROLE]: 'service',
         [DOCKER_LABELS.SERVICE]: opts.name,
       },
     });

-    // Raw createContainer: incompatible with docker.runContainer() — service containers
-    // need different labels (ROLE/SERVICE vs PROJECT), custom healthcheck support,
-    // explicit volume binds, and 'unless-stopped' restart policy. Consolidation deferred.
-    const container = await client.createContainer({
-      Image: image,
+    const envRecord: Record<string, string> = {};
+    for (const entry of env) {
+      const eqIdx = entry.indexOf('=');
+      if (eqIdx > 0) {
+        envRecord[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
+      }
+    }
+
+    const containerId = await this.docker.runServiceContainer({
+      imageTag: image,
       name: containerName,
-      Env: env,
-      ...(containerCmd ? { Cmd: containerCmd } : {}),
-      ...(containerHealthcheck
-        ? {
-            Healthcheck: {
-              Test: containerHealthcheck.test,
-              Interval: containerHealthcheck.interval * 1_000_000_000,
-              Timeout: containerHealthcheck.timeout * 1_000_000_000,
-              Retries: containerHealthcheck.retries,
-              StartPeriod: containerHealthcheck.startPeriod * 1_000_000_000,
-            },
-          }
-        : {}),
-      Labels: {
-        [DOCKER_LABELS.MANAGED]: 'true',
-        [DOCKER_LABELS.ROLE]: 'service',
-        [DOCKER_LABELS.SERVICE]: opts.name,
-      },
-      ExposedPorts: {
-        [`${String(containerPort)}/tcp`]: {},
-      },
-      NetworkingConfig: {
-        EndpointsConfig: {
-          [SHARED_NETWORK_NAME]: { Aliases: [opts.name] },
-        },
-      },
-      HostConfig: {
-        NetworkMode: this.docker.getNetworkName(),
-        RestartPolicy: { Name: 'unless-stopped' },
-        Binds: [`${volumeName}:${dataMountPath}`],
-        PortBindings: {
-          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
-        },
-        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
-      },
+      port: containerPort,
+      hostPort,
+      envVars: envRecord,
+      serviceName: opts.name,
+      volumeBinds: [`${volumeName}:${dataMountPath}`],
+      ...(containerHealthcheck ? { healthcheck: containerHealthcheck } : {}),
+      ...(containerCmd ? { cmd: containerCmd } : {}),
     });

-    await container.start();
-
     const primaryNetwork = this.docker.getNetworkName();
     const additionalNetworks = [SHARED_NETWORK_NAME].filter(
       (networkName) => networkName !== primaryNetwork,
@@ -478,7 +446,7 @@ export class ServiceManager {

     for (const networkName of additionalNetworks) {
       try {
-        await this.docker.connectContainerToNetwork(container.id, networkName, [opts.name]);
+        await this.docker.connectContainerToNetwork(containerId, networkName, [opts.name]);
       } catch (err) {
         log.warn(
           { err, networkName, containerName },
@@ -498,7 +466,7 @@ export class ServiceManager {
       credentials: credentialsJson,
     });

-    this.db.updateService(id, { status: 'running', containerId: container.id });
+    this.db.updateService(id, { status: 'running', containerId });
     this.invalidateServiceCardSummaryCache();
     const created = this.db.getService(id);
     if (!created) {
@@ -572,15 +540,7 @@ export class ServiceManager {
     }

     const volumeName = this.getVolumeName(service.name);
-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-    const client = this.docker.getClient();
-    try {
-      await client.getVolume(volumeName).remove();
-    } catch (error) {
-      if (!isDockerNotFoundError(error)) {
-        throw error;
-      }
-    }
+    await this.docker.removeVolume(volumeName);

     this.db.deleteService(id);
     this.invalidateServiceCardSummaryCache();
@@ -639,11 +599,7 @@ export class ServiceManager {

     await this.docker.pullImage('alpine');

-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-    const client = this.docker.getClient();
-    // Raw createContainer: ephemeral backup container (AutoRemove, no port/network/labels)
-    // is incompatible with docker.runContainer(). Consolidation deferred.
-    const container = await client.createContainer({
+    const backupContainerId = await this.docker.runInfraContainer({
       Image: 'alpine',
       Cmd: ['tar', 'czf', `/backup/${backupId}.tar.gz`, '-C', '/data', '.'],
       HostConfig: {
@@ -652,12 +608,7 @@ export class ServiceManager {
       },
     });

-    await container.start();
-    const waitResult: unknown = await container.wait();
-    const backupExitCode =
-      waitResult && typeof waitResult === 'object' && 'StatusCode' in waitResult
-        ? (waitResult as { StatusCode: number }).StatusCode
-        : 1;
+    const { StatusCode: backupExitCode } = await this.docker.waitForContainer(backupContainerId);
     if (backupExitCode !== 0) {
       throw new Error(
         `Backup failed with exit code ${String(backupExitCode)} for service: ${service.id}`,
@@ -686,11 +637,8 @@ export class ServiceManager {

     try {
       await this.docker.pullImage('alpine');
-      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-      const client = this.docker.getClient();
-      // Raw createContainer: ephemeral restore container (AutoRemove, no port/network/labels)
-      // is incompatible with docker.runContainer(). Consolidation deferred.
-      const container = await client.createContainer({
+
+      const restoreContainerId = await this.docker.runInfraContainer({
         Image: 'alpine',
         Cmd: ['sh', '-c', `rm -rf /data/* && tar xzf /backup/${backupFilename} -C /data`],
         HostConfig: {
@@ -699,12 +647,8 @@ export class ServiceManager {
         },
       });

-      await container.start();
-      const waitResult: unknown = await container.wait();
-      const restoreExitCode =
-        waitResult && typeof waitResult === 'object' && 'StatusCode' in waitResult
-          ? (waitResult as { StatusCode: number }).StatusCode
-          : 1;
+      const { StatusCode: restoreExitCode } =
+        await this.docker.waitForContainer(restoreContainerId);
       if (restoreExitCode !== 0) {
         throw new Error(
           `Restore failed with exit code ${String(restoreExitCode)} for service: ${service.id}`,
@@ -771,8 +715,7 @@ export class ServiceManager {

     const containerId = service.container_id ?? service.container_name;
     try {
-      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-      const info = await this.docker.getClient().getContainer(containerId).inspect();
+      const info = await this.docker.inspectContainer(containerId);
       const status: ServiceRow['status'] = info.State.Running ? 'running' : 'stopped';
       const containerIdFromDocker = info.Id;

@@ -899,8 +842,7 @@ export class ServiceManager {

     const containerRef = service.container_id ?? service.container_name;
     try {
-      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-      const info = await this.docker.getClient().getContainer(containerRef).inspect();
+      const info = await this.docker.inspectContainer(containerRef);
       const status: ServiceRow['status'] = info.State.Running ? 'running' : 'stopped';
       const healthRaw: unknown = info.State.Health?.Status;
       const startedAtRaw: unknown = info.State.StartedAt;
@@ -996,19 +938,24 @@ export class ServiceManager {
     let memoryLimitBytes: number | null = null;
     try {
       const containerId = service.container_id ?? service.container_name;
-      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-      const container = this.docker.getClient().getContainer(containerId);
-      const rawStats = await container.stats({ stream: false });
+      const rawStats = (await this.docker.getContainerStats(containerId)) as {
+        cpu_stats: {
+          cpu_usage: { total_usage: number; percpu_usage?: number[] };
+          system_cpu_usage: number;
+        };
+        precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
+        memory_stats: { usage?: number; limit?: number };
+      };
       const cpuDelta =
         rawStats.cpu_stats.cpu_usage.total_usage - rawStats.precpu_stats.cpu_usage.total_usage;
       const systemDelta =
         rawStats.cpu_stats.system_cpu_usage - rawStats.precpu_stats.system_cpu_usage;
-      const percpuUsage = rawStats.cpu_stats.cpu_usage.percpu_usage as number[] | undefined;
+      const percpuUsage = rawStats.cpu_stats.cpu_usage.percpu_usage;
       const numCpus = percpuUsage ? percpuUsage.length : 1;
       cpuPercent =
         systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * numCpus * 100 * 10) / 10 : 0;
-      memoryUsageBytes = (rawStats.memory_stats.usage as number | undefined) ?? null;
-      memoryLimitBytes = (rawStats.memory_stats.limit as number | undefined) ?? null;
+      memoryUsageBytes = rawStats.memory_stats.usage ?? null;
+      memoryLimitBytes = rawStats.memory_stats.limit ?? null;
     } catch {
       // container stats unavailable — non-fatal
     }
@@ -1263,8 +1210,7 @@ export class ServiceManager {
   private async ensureServiceContainerRunning(service: ServiceRow): Promise<void> {
     const containerId = service.container_id ?? service.container_name;
     try {
-      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-      const info = await this.docker.getClient().getContainer(containerId).inspect();
+      const info = await this.docker.inspectContainer(containerId);
       if (!info.State.Running) {
         throw new Error(`Service container is not running: ${service.id}`);
       }
diff --git a/src/pipeline/traefik.ts b/src/pipeline/traefik.ts
index 5df1117..a7f676b 100644
--- a/src/pipeline/traefik.ts
+++ b/src/pipeline/traefik.ts
@@ -52,12 +52,10 @@ export class TraefikManager {

   async isRunning(): Promise<boolean> {
     try {
-      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-      const client = this.docker.getClient();
-      const containers = await client.listContainers({
-        filters: { label: [`${DOCKER_LABELS.ROLE}=traefik`] },
-      });
-      return containers.length > 0;
+      const containers = await this.docker.listAllContainers();
+      return containers.some(
+        (c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik' && c.state === 'running',
+      );
     } catch (err) {
       log.warn({ err }, 'Failed to check Traefik running status');
       return false;
@@ -66,10 +64,7 @@ export class TraefikManager {

   private async hasCurrentConfig(): Promise<boolean> {
     try {
-      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-      const client = this.docker.getClient();
-      const container = client.getContainer(this.containerName);
-      const info = await container.inspect();
+      const info = await this.docker.inspectContainer(this.containerName);
       const cmd: string[] = (info.Config.Cmd as string[] | null) ?? [];
       const hasHttpProvider = cmd.some((arg: string) => arg.includes('providers.http.endpoint'));
       const hasCorrectNetwork = cmd.some(
@@ -113,29 +108,24 @@ export class TraefikManager {
   }

   private async tryAdoptExistingTraefik(): Promise<boolean> {
-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-    const client = this.docker.getClient();
-    const containers = await client.listContainers({
-      filters: { label: [`${DOCKER_LABELS.ROLE}=traefik`], status: ['running'] },
-    });
+    const containers = await this.docker.listAllContainers();
+    const running = containers.filter(
+      (c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik' && c.state === 'running',
+    );

-    const candidate = containers.find((c) => {
-      const name = (c.Names[0] ?? '').replace(/^\//, '');
-      return name !== this.containerName;
-    });
+    const candidate = running.find((c) => c.name !== this.containerName);

     if (!candidate) {
       return false;
     }

-    const candidateName = (candidate.Names[0] ?? '').replace(/^\//, '');
     log.info(
-      { existingContainer: candidateName, managedContainer: this.containerName },
+      { existingContainer: candidate.name, managedContainer: this.containerName },
       'Found legacy OpenLander Traefik — adopting',
     );

     const connected = await this.connectContainerToNetworkByName(
-      candidateName,
+      candidate.name,
       SHARED_NETWORK_NAME,
     );
     if (!connected) {
@@ -146,8 +136,7 @@ export class TraefikManager {
     }

     try {
-      const stale = client.getContainer(this.containerName);
-      await stale.remove({ force: true });
+      await this.docker.removeContainer(this.containerName);
       log.debug({ containerName: this.containerName }, 'Removed stale managed Traefik container');
     } catch {
       // Container doesn't exist — expected
@@ -157,19 +146,20 @@ export class TraefikManager {
   }

   private async ensureNetworkByName(name: string): Promise<void> {
-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-    const client = this.docker.getClient();
-
     try {
-      await client.getNetwork(name).inspect();
+      await this.docker.getNetworkInfo(name);
       return;
     } catch (error) {
-      if (!isDockerNotFoundError(error)) {
+      const msg = error instanceof Error ? error.message : String(error);
+      if (!msg.includes('not found') && !isDockerNotFoundError(error)) {
         throw error;
       }
     }

     try {
+      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- TODO: createNetwork not yet in docker.ts wrapper (PR3 deferred)
+      const client = (this.docker as any).getClient();
+      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- PR3 deferred
       await client.createNetwork({
         Name: name,
         Driver: 'bridge',
@@ -198,20 +188,15 @@ export class TraefikManager {
       return;
     }

-    // eslint-disable-next-line @typescript-eslint/no-deprecated -- PR2: scheduled for docker.ts wrapper migration
-    const client = this.docker.getClient();
-
     try {
-      const existing = await client.listContainers({
-        all: true,
-        filters: { label: [`${DOCKER_LABELS.ROLE}=traefik`] },
-      });
-      for (const c of existing) {
-        await client.getContainer(c.Id).remove({ force: true });
+      const existing = await this.docker.listAllContainers();
+      const traefikContainers = existing.filter((c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik');
+      for (const c of traefikContainers) {
+        await this.docker.removeContainer(c.id);
       }
-      if (existing.length > 0) {
+      if (traefikContainers.length > 0) {
         log.debug(
-          `Removed ${existing.length.toString()} existing Traefik container(s) before recreation`,
+          `Removed ${traefikContainers.length.toString()} existing Traefik container(s) before recreation`,
         );
       }
     } catch (_err) {
@@ -219,16 +204,7 @@ export class TraefikManager {
     }

     try {
-      const stream = await client.pull(TRAEFIK_IMAGE);
-      await new Promise<void>((resolve, reject) => {
-        client.modem.followProgress(stream, (err: Error | null) => {
-          if (err) {
-            reject(err);
-          } else {
-            resolve();
-          }
-        });
-      });
+      await this.docker.pullImage(TRAEFIK_IMAGE);
     } catch (err) {
       log.debug({ err }, 'Traefik image pull failed — may already exist locally');
     }
diff --git a/src/tools/defs/deploy-plan.ts b/src/tools/defs/deploy-plan.ts
index 25e420d..78967bc 100644
--- a/src/tools/defs/deploy-plan.ts
+++ b/src/tools/defs/deploy-plan.ts
@@ -9,6 +9,7 @@ import { containerName as projectContainerName } from '../../pipeline/helpers.js
 import { getProjectUrls } from '../../pipeline/traefik.js';
 import { markMcpDeploy } from '../../pipeline/auto-recovery.js';
 import { SHARED_NETWORK_NAME } from '../../config/index.js';
+import { buildDeployLockedResponse, tryAcquireDeployLockOrResponse } from './helpers.js';

 import {
   createDeployPlanSchema,
@@ -18,32 +19,6 @@ import {
   validateDeployPlanSchema,
 } from './schemas.js';

-function buildDeployLockedResponse(error: DeployLockedError) {
-  return {
-    success: false,
-    error: 'DEPLOY_LOCKED',
-    message: error.message,
-    _agent_guidance: {
-      message: 'Another deploy is in progress for this project.',
-      next_steps: ['Wait 30 seconds and try again', 'Check deploy status with get_deploy_status'],
-    },
-  };
-}
-
-function tryAcquireDeployLockOrResponse(
-  projectId: string,
-  sessionId: string,
-  context: Parameters<ToolDef['execute']>[1],
-) {
-  const locked = context.appCtx.db.acquireDeployLock(projectId, sessionId);
-  if (locked) {
-    return null;
-  }
-  const lockInfo = context.appCtx.db.getDeployLockInfo(projectId);
-  const error = new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
-  return buildDeployLockedResponse(error);
-}
-
 export const deployPlanToolDefs: ToolDef[] = [
   {
     name: 'create_deploy_plan',
diff --git a/src/tools/defs/deploy.ts b/src/tools/defs/deploy.ts
index 59d7dd9..4be3446 100644
--- a/src/tools/defs/deploy.ts
+++ b/src/tools/defs/deploy.ts
@@ -5,6 +5,7 @@ import { createModuleLogger } from '../../lib/logger.js';
 import { getDockerHostType } from '../../pipeline/docker.js';
 import { containerName as projectContainerName } from '../../pipeline/helpers.js';
 import { getProjectUrls } from '../../pipeline/traefik.js';
+import { buildDeployLockedResponse, tryAcquireDeployLockOrResponse } from './helpers.js';
 import type { ToolDef } from './types.js';
 import {
   cleanupPreviewSchema,
@@ -18,32 +19,6 @@ import {

 const log = createModuleLogger('tools-defs-deploy');

-function buildDeployLockedResponse(error: DeployLockedError) {
-  return {
-    success: false,
-    error: 'DEPLOY_LOCKED',
-    message: error.message,
-    _agent_guidance: {
-      message: 'Another deploy is in progress for this project.',
-      next_steps: ['Wait 30 seconds and try again', 'Check deploy status with get_deploy_status'],
-    },
-  };
-}
-
-function tryAcquireDeployLockOrResponse(
-  projectId: string,
-  sessionId: string,
-  context: Parameters<ToolDef['execute']>[1],
-) {
-  const locked = context.appCtx.db.acquireDeployLock(projectId, sessionId);
-  if (locked) {
-    return null;
-  }
-  const lockInfo = context.appCtx.db.getDeployLockInfo(projectId);
-  const error = new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
-  return buildDeployLockedResponse(error);
-}
-
 export const deployToolDefs: ToolDef[] = [
   {
     name: 'preview_deploy',
diff --git a/src/tools/defs/env.ts b/src/tools/defs/env.ts
index 89c5f0a..6e5b630 100644
--- a/src/tools/defs/env.ts
+++ b/src/tools/defs/env.ts
@@ -1,5 +1,5 @@
 import type { ToolDef } from './types.js';
-import { ProjectNotFoundError } from '../../errors.js';
+import { getProjectByName, getProductionEnvironmentId } from './helpers.js';
 import {
   getEnvVarSchema,
   listEnvVarsSchema,
@@ -12,21 +12,6 @@ import {
   uploadSecretFileSchema,
 } from './schemas.js';

-function getProjectByName(appCtx: Parameters<ToolDef['execute']>[1]['appCtx'], name: string) {
-  const project = appCtx.db.getProjectByName(name);
-  if (!project) {
-    throw new ProjectNotFoundError(name);
-  }
-  return project;
-}
-
-function getProductionEnvironmentId(
-  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
-  projectId: string,
-): string | undefined {
-  return appCtx.db.getEnvironmentsByProject(projectId).find((e) => e.type === 'production')?.id;
-}
-
 export const envToolDefs: ToolDef[] = [
   {
     name: 'list_env_vars',
diff --git a/src/tools/defs/helpers.ts b/src/tools/defs/helpers.ts
new file mode 100644
index 0000000..125e098
--- /dev/null
+++ b/src/tools/defs/helpers.ts
@@ -0,0 +1,46 @@
+import { DeployLockedError, ProjectNotFoundError } from '../../errors.js';
+import type { ToolDef } from './types.js';
+
+export function getProjectByName(
+  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
+  name: string,
+) {
+  const project = appCtx.db.getProjectByName(name);
+  if (!project) {
+    throw new ProjectNotFoundError(name);
+  }
+  return project;
+}
+
+export function getProductionEnvironmentId(
+  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
+  projectId: string,
+): string | undefined {
+  return appCtx.db.getEnvironmentsByProject(projectId).find((e) => e.type === 'production')?.id;
+}
+
+export function buildDeployLockedResponse(error: DeployLockedError) {
+  return {
+    success: false,
+    error: 'DEPLOY_LOCKED',
+    message: error.message,
+    _agent_guidance: {
+      message: 'Another deploy is in progress for this project.',
+      next_steps: ['Wait 30 seconds and try again', 'Check deploy status with get_deploy_status'],
+    },
+  };
+}
+
+export function tryAcquireDeployLockOrResponse(
+  projectId: string,
+  sessionId: string,
+  context: Parameters<ToolDef['execute']>[1],
+) {
+  const locked = context.appCtx.db.acquireDeployLock(projectId, sessionId);
+  if (locked) {
+    return null;
+  }
+  const lockInfo = context.appCtx.db.getDeployLockInfo(projectId);
+  const error = new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
+  return buildDeployLockedResponse(error);
+}
diff --git a/src/tools/defs/monitoring.ts b/src/tools/defs/monitoring.ts
index 57892ef..e2dabef 100644
--- a/src/tools/defs/monitoring.ts
+++ b/src/tools/defs/monitoring.ts
@@ -111,16 +111,21 @@ export const monitoringToolDefs: ToolDef[] = [
       }

       try {
-        const container = appCtx.docker.getClient().getContainer(project.container_id);
-        const stats = await container.stats({ stream: false });
-        const inspect = await container.inspect();
+        const stats = (await appCtx.docker.getContainerStats(project.container_id)) as {
+          cpu_stats: {
+            cpu_usage: { total_usage: number; percpu_usage?: unknown };
+            system_cpu_usage: number;
+          };
+          precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
+          memory_stats: { usage: number; limit: number };
+        };
+        const inspect = await appCtx.docker.inspectContainer(project.container_id);
         // Calculate CPU percentage
         const cpuDelta =
           stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
         const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
         const cpuCount =
-          (stats.cpu_stats.cpu_usage.percpu_usage as unknown as { length?: number } | undefined)
-            ?.length ?? 1;
+          (stats.cpu_stats.cpu_usage.percpu_usage as { length?: number } | undefined)?.length ?? 1;
         const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
         // Convert bytes to MB
         const memoryUsageMb = Math.round((stats.memory_stats.usage / 1024 / 1024) * 10) / 10;
diff --git a/src/tools/defs/platform-actions.ts b/src/tools/defs/platform-actions.ts
index 6f078e8..30bc38c 100644
--- a/src/tools/defs/platform-actions.ts
+++ b/src/tools/defs/platform-actions.ts
@@ -108,8 +108,6 @@ export const platformActionToolDefs: ToolDef[] = [
         (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
         context.appCtx.db.listServices(),
       );
-      const dockerClient = context.appCtx.docker.getClient();
-
       const actions: Array<{ type: 'mark_error' | 'stop_orphan'; target: string; detail: string }> =
         [];

@@ -119,7 +117,7 @@ export const platformActionToolDefs: ToolDef[] = [
         }

         try {
-          await dockerClient.getContainer(project.container_id).inspect();
+          await context.appCtx.docker.inspectContainer(project.container_id);
           continue;
         } catch (error) {
           if (!isDockerNotFoundError(error)) {
@@ -196,11 +194,9 @@ export const platformActionToolDefs: ToolDef[] = [
       const confirm = args['confirm'] as boolean;
       ensureConfirmed(confirm, 'platform_force_remove');

-      const container = context.appCtx.docker.getClient().getContainer(containerId);
-
       let inspected: { Name?: string; Config?: { Labels?: Record<string, string> } };
       try {
-        inspected = (await container.inspect()) as {
+        inspected = (await context.appCtx.docker.inspectContainer(containerId)) as {
           Name?: string;
           Config?: { Labels?: Record<string, string> };
         };
diff --git a/src/tools/defs/platform-debug.ts b/src/tools/defs/platform-debug.ts
index 76c85af..ec82d6b 100644
--- a/src/tools/defs/platform-debug.ts
+++ b/src/tools/defs/platform-debug.ts
@@ -19,22 +19,6 @@ const PINO_LEVEL_MAP: Record<string, number> = {

 const FORBIDDEN_TABLES = new Set(['global_secrets', 'oauth_tokens', 'secret_files', 'env_vars']);

-interface DockerPsContainer {
-  Id: string;
-  Names?: string[];
-  Image: string;
-  Status: string;
-  State: string;
-  Created: number;
-  Labels?: Record<string, string>;
-  Ports?: Array<{
-    IP?: string;
-    PrivatePort?: number;
-    PublicPort?: number;
-    Type?: string;
-  }>;
-}
-
 function mapManagedContainer(container: {
   id: string;
   name: string;
@@ -58,19 +42,6 @@ function mapManagedContainer(container: {
   };
 }

-function mapDockerPsContainer(container: DockerPsContainer) {
-  return {
-    id: container.Id,
-    name: container.Names?.[0]?.replace(/^\//, '') ?? 'unknown',
-    image: container.Image,
-    status: container.Status,
-    state: container.State,
-    created: container.Created,
-    labels: container.Labels ?? {},
-    ports: container.Ports ?? [],
-  };
-}
-
 function applyLimit<T>(rows: T[], limit: number): T[] {
   if (limit <= 0) {
     return [];
@@ -134,8 +105,7 @@ export const platformDebugToolDefs: ToolDef[] = [
       const containerId = args['container_id'] as string;

       try {
-        const container = context.appCtx.docker.getClient().getContainer(containerId);
-        return await container.inspect();
+        return await context.appCtx.docker.inspectContainer(containerId);
       } catch (error) {
         if (isDockerNotFoundError(error)) {
           throw new Error(`CONTAINER_NOT_FOUND: ${containerId}`);
@@ -162,10 +132,18 @@ export const platformDebugToolDefs: ToolDef[] = [
         return { count: containers.length, containers };
       }

-      const listed = (await context.appCtx.docker
-        .getClient()
-        .listContainers({ all })) as DockerPsContainer[];
-      const containers = listed.map(mapDockerPsContainer);
+      const allContainers = await context.appCtx.docker.listAllContainers();
+      const filtered = all ? allContainers : allContainers.filter((c) => c.state === 'running');
+      const containers = filtered.map((c) => ({
+        id: c.id,
+        name: c.name,
+        image: c.image,
+        status: c.status,
+        state: c.state,
+        created: c.created,
+        labels: c.labels,
+        ports: c.ports,
+      }));

       return {
         count: containers.length,
diff --git a/src/tools/defs/project-ops.ts b/src/tools/defs/project-ops.ts
index 6612f43..9f11de5 100644
--- a/src/tools/defs/project-ops.ts
+++ b/src/tools/defs/project-ops.ts
@@ -4,6 +4,7 @@ import { createModuleLogger } from '../../lib/logger.js';
 import { containerName as projectContainerName } from '../../pipeline/helpers.js';
 import { getProjectUrl, getProjectUrls } from '../../pipeline/traefik.js';
 import { SHARED_NETWORK_NAME } from '../../config/index.js';
+import { tryAcquireDeployLockOrResponse } from './helpers.js';
 import {
   emptySchema,
   archiveProjectSchema,
@@ -18,40 +19,7 @@ import type { ToolDef } from './types.js';

 const log = createModuleLogger('tools-defs-project-ops');

-function buildDeployLockedResponse(error: DeployLockedError) {
-  return {
-    success: false,
-    error: 'DEPLOY_LOCKED',
-    message: error.message,
-    _agent_guidance: {
-      message: 'Another deploy is in progress for this project.',
-      next_steps: ['Wait 30 seconds and try again', 'Check deploy status with get_deploy_status'],
-    },
-  };
-}
-
-function tryAcquireDeployLockOrResponse(
-  projectId: string,
-  sessionId: string,
-  context: Parameters<ToolDef['execute']>[1],
-) {
-  const locked = context.appCtx.db.acquireDeployLock(projectId, sessionId);
-  if (locked) {
-    return null;
-  }
-  const lockInfo = context.appCtx.db.getDeployLockInfo(projectId);
-  const error = new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
-  return buildDeployLockedResponse(error);
-}
-
 async function reconcileRunningProjects(appCtx: Parameters<ToolDef['execute']>[1]['appCtx']) {
-  let client: ReturnType<typeof appCtx.docker.getClient>;
-  try {
-    client = appCtx.docker.getClient();
-  } catch {
-    return;
-  }
-
   const projects = appCtx.db.listProjects();

   for (const project of projects) {
@@ -60,7 +28,7 @@ async function reconcileRunningProjects(appCtx: Parameters<ToolDef['execute']>[1
     }

     try {
-      const info = await client.getContainer(project.container_id).inspect();
+      const info = await appCtx.docker.inspectContainer(project.container_id);
       const status = info.State.Running ? 'running' : 'stopped';

       if (status !== project.status || info.Id !== project.container_id) {
diff --git a/src/tools/defs/service.ts b/src/tools/defs/service.ts
index 533e9bd..bd43095 100644
--- a/src/tools/defs/service.ts
+++ b/src/tools/defs/service.ts
@@ -308,7 +308,7 @@ export const serviceToolDefs: ToolDef[] = [
       const containerId = service.container_id ?? service.container_name;
       if (containerId) {
         try {
-          const info = (await appCtx.docker.getClient().getContainer(containerId).inspect()) as {
+          const info = (await appCtx.docker.inspectContainer(containerId)) as {
             State?: { Health?: { Status?: string } };
           };
           const dockerHealth = info.State?.Health?.Status;
diff --git a/src/tools/defs/volume.ts b/src/tools/defs/volume.ts
index 734dab8..45ad52c 100644
--- a/src/tools/defs/volume.ts
+++ b/src/tools/defs/volume.ts
@@ -80,12 +80,10 @@ export const volumeToolDefs: ToolDef[] = [
       const mountPath = args['mount_path'] as string;
       const dockerVolumeName = getDockerVolumeName(projectName, volumeName);

-      const client = appCtx.docker.getClient();
-
       // Docker createVolume is idempotent — it silently returns existing volumes.
       // We must inspect first to detect duplicates and reject foreign volumes.
       try {
-        const existing = await client.getVolume(dockerVolumeName).inspect();
+        const existing = await appCtx.docker.inspectVolume(dockerVolumeName);
         const existingLabels = getLabels(existing);
         if (existingLabels[DOCKER_LABELS.MANAGED] === 'true') {
           throw new Error(
@@ -109,8 +107,7 @@ export const volumeToolDefs: ToolDef[] = [
           `${DOCKER_LABELS.ROLE}=volume`,
           `${DOCKER_LABELS.PROJECT}=${projectName}`,
         ];
-        const result = await client.listVolumes({ filters: { label: labels } });
-        const existingVolumes = Array.isArray(result.Volumes) ? result.Volumes : [];
+        const existingVolumes = await appCtx.docker.listVolumes({ label: labels });

         for (const volumeInfo of existingVolumes) {
           const volumeLabels = getLabels(volumeInfo);
@@ -136,10 +133,9 @@ export const volumeToolDefs: ToolDef[] = [
       }

       try {
-        await client.createVolume({
-          Name: dockerVolumeName,
-          Labels: {
-            [DOCKER_LABELS.MANAGED]: 'true',
+        await appCtx.docker.createVolume({
+          name: dockerVolumeName,
+          labels: {
             [DOCKER_LABELS.ROLE]: 'volume',
             [DOCKER_LABELS.PROJECT]: projectName,
             [DOCKER_LABELS.VOLUME]: volumeName,
@@ -168,7 +164,6 @@ export const volumeToolDefs: ToolDef[] = [
     inputSchema: listVolumesSchema,
     execute: async (args, { appCtx }) => {
       const projectName = args['project_name'] as string | undefined;
-      const client = appCtx.docker.getClient();

       const labels = projectName
         ? [
@@ -178,8 +173,7 @@ export const volumeToolDefs: ToolDef[] = [
           ]
         : [`${DOCKER_LABELS.MANAGED}=true`, `${DOCKER_LABELS.ROLE}=volume`];

-      const result = await client.listVolumes({ filters: { label: labels } });
-      const listedVolumes = Array.isArray(result.Volumes) ? result.Volumes : [];
+      const listedVolumes = await appCtx.docker.listVolumes({ label: labels });

       const volumes = await Promise.all(
         listedVolumes.map(async (volumeInfo) => {
@@ -191,7 +185,7 @@ export const volumeToolDefs: ToolDef[] = [

           if (name) {
             try {
-              const inspectedVolume = await client.getVolume(name).inspect();
+              const inspectedVolume = await appCtx.docker.inspectVolume(name);
               sizeBytes = getVolumeUsageSizeBytes(inspectedVolume) ?? sizeBytes;
               const inspectedLabels = getLabels(inspectedVolume);
               if (Object.keys(inspectedLabels).length > 0) {
@@ -234,12 +228,9 @@ export const volumeToolDefs: ToolDef[] = [
       const volumeName = args['volume_name'] as string;
       const dockerVolumeName = getDockerVolumeName(projectName, volumeName);

-      const client = appCtx.docker.getClient();
-      const volume = client.getVolume(dockerVolumeName);
-
       let inspected: unknown;
       try {
-        inspected = await volume.inspect();
+        inspected = await appCtx.docker.inspectVolume(dockerVolumeName);
       } catch (error) {
         if (isDockerNotFoundError(error)) {
           throw new Error(
@@ -258,7 +249,7 @@ export const volumeToolDefs: ToolDef[] = [
       }

       try {
-        await volume.remove();
+        await appCtx.docker.removeVolume(dockerVolumeName);
       } catch (error) {
         const message = getErrorMessage(error);
         if (message.toLowerCase().includes('in use')) {
@@ -285,7 +276,7 @@ export const volumeToolDefs: ToolDef[] = [
     mcpDescription: 'Get Docker disk usage totals and managed volume sizes.',
     inputSchema: getDiskUsageSchema,
     execute: async (_args, { appCtx }) => {
-      const diskUsageData: unknown = await appCtx.docker.getClient().df();
+      const diskUsageData: unknown = await appCtx.docker.getDiskUsage();
       if (!isRecord(diskUsageData)) {
         return {
           images: { count: 0, totalSizeBytes: 0 },
diff --git a/src/tools/defs/webhook.ts b/src/tools/defs/webhook.ts
index 5ce7732..9d48ce8 100644
--- a/src/tools/defs/webhook.ts
+++ b/src/tools/defs/webhook.ts
@@ -1,17 +1,9 @@
 import { nanoid } from 'nanoid';

-import { ProjectNotFoundError } from '../../errors.js';
 import type { ToolDef } from './types.js';
+import { getProjectByName } from './helpers.js';
 import { disableWebhookSchema, enableWebhookSchema, getWebhookConfigSchema } from './schemas.js';

-function getProjectByName(appCtx: Parameters<ToolDef['execute']>[1]['appCtx'], name: string) {
-  const project = appCtx.db.getProjectByName(name);
-  if (!project) {
-    throw new ProjectNotFoundError(name);
-  }
-  return project;
-}
-
 const enableWebhookTool: ToolDef = {
   name: 'enable_webhook',
   riskLevel: 'medium',
diff --git a/src/web/api/project-routes.ts b/src/web/api/project-routes.ts
index dc1f35f..e8bc1fd 100644
--- a/src/web/api/project-routes.ts
+++ b/src/web/api/project-routes.ts
@@ -235,8 +235,15 @@ export function createProjectRoutes(ctx: AppContext): Hono {

     if (project.container_id && project.status === 'running') {
       try {
-        const container = ctx.docker.getClient().getContainer(project.container_id);
-        const stats = await container.stats({ stream: false });
+        const stats = (await ctx.docker.getContainerStats(project.container_id)) as {
+          cpu_stats: {
+            cpu_usage: { total_usage: number };
+            system_cpu_usage: number;
+            online_cpus?: number;
+          };
+          precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
+          memory_stats: { usage: number; limit: number };
+        };

         const cpuDelta =
           stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
@@ -943,12 +950,10 @@ export function createProjectRoutes(ctx: AppContext): Hono {
             c.id !== project.container_id &&
             c.status === 'running',
         );
-        const client = ctx.docker.getClient();
         for (const container of stale) {
           try {
-            const dockerContainer = client.getContainer(container.id);
-            await dockerContainer.stop();
-            await dockerContainer.remove();
+            await ctx.docker.stopContainer(container.id);
+            await ctx.docker.removeContainer(container.id);
           } catch (err) {
             log.warn({ err, containerId: container.id }, 'Failed to remove stale container');
           }
@@ -1026,13 +1031,7 @@ export function createProjectRoutes(ctx: AppContext): Hono {
         c.header('Content-Type', 'application/x-ndjson');

         try {
-          const container = ctx.docker.getClient().getContainer(containerId);
-          const logStream = await container.logs({
-            follow: true,
-            stdout: true,
-            stderr: true,
-            tail: 50,
-          });
+          const logStream = await ctx.docker.getLogStream(containerId, { tail: 50 });

           logStream.on('data', (chunk: Buffer) => {
             const headerSize = 8;
diff --git a/src/web/api/terminal-routes.ts b/src/web/api/terminal-routes.ts
index c168a08..863c959 100644
--- a/src/web/api/terminal-routes.ts
+++ b/src/web/api/terminal-routes.ts
@@ -5,6 +5,7 @@ import type { Duplex } from 'node:stream';
 import type { AppContext } from '../../app.js';
 import { AuthService } from '../../auth/auth-service.js';
 import { createModuleLogger } from '../../lib/logger.js';
+import { parseCookie } from '../middleware/cookies.js';
 import { getProjectOrThrow } from './helpers/project-helpers.js';

 const log = createModuleLogger('terminal');
@@ -13,12 +14,6 @@ type TerminalExec = {
   resize: (opts: { w: number; h: number }) => Promise<void>;
 };

-function parseCookie(cookieHeader: string | undefined, name: string): string | null {
-  if (!cookieHeader) return null;
-  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
-  return match?.[1] ?? null;
-}
-
 export function createTerminalRoutes(
   ctx: AppContext,
   upgradeWebSocket?: NodeWebSocket['upgradeWebSocket'],
@@ -116,8 +111,8 @@ export function createTerminalRoutes(
                 return;
               }

-              const container = ctx.docker.getClient().getContainer(project.container_id);
-              const containerInfo = await container.inspect();
+              const containerId = project.container_id;
+              const containerInfo = await ctx.docker.inspectContainer(containerId);
               if (!containerInfo.State.Running) {
                 closeWithError(ws, 'Container is not running');
                 return;
@@ -125,25 +120,8 @@ export function createTerminalRoutes(

               const probeShell = async (shell: string): Promise<boolean> => {
                 try {
-                  const probeExec = await container.exec({
-                    Cmd: [shell, '-c', 'exit 0'],
-                    AttachStdin: false,
-                    AttachStdout: true,
-                    AttachStderr: true,
-                    Tty: false,
-                  });
-                  const probeStream = await probeExec.start({ hijack: false, stdin: false });
-
-                  await new Promise<void>((resolve) => {
-                    probeStream.on('data', () => {});
-                    probeStream.on('end', resolve);
-                    probeStream.on('error', () => {
-                      resolve();
-                    });
-                  });
-
-                  const info = await probeExec.inspect();
-                  return info.ExitCode === 0;
+                  const result = await ctx.docker.execSimple(containerId, [shell, '-c', 'exit 0']);
+                  return result.exitCode === 0;
                 } catch (_err) {
                   return false;
                 }
@@ -163,15 +141,9 @@ export function createTerminalRoutes(
                 return;
               }

-              const shellExec = await container.exec({
-                Cmd: [shellCmd],
-                AttachStdin: true,
-                AttachStdout: true,
-                AttachStderr: true,
-                Tty: true,
-              });
-              const exec = shellExec as TerminalExec;
-              const stream = await shellExec.start({ hijack: true, stdin: true });
+              const terminal = await ctx.docker.execTerminal(containerId, [shellCmd]);
+              const exec: TerminalExec = terminal;
+              const stream = terminal.stream as unknown as Duplex;

               const idleTimer = setTimeout(() => {
                 ws.send(JSON.stringify({ type: 'error', message: 'Terminal idle timeout (30m)' }));
diff --git a/src/web/middleware/auth.ts b/src/web/middleware/auth.ts
index 0ad9375..d9f5629 100644
--- a/src/web/middleware/auth.ts
+++ b/src/web/middleware/auth.ts
@@ -1,10 +1,6 @@
 import type { Context, Next } from 'hono';
 import type { AuthService } from '../../auth/auth-service.js';
-
-function parseCookie(cookieHeader: string, name: string): string | null {
-  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
-  return match?.[1] ?? null;
-}
+import { parseCookie } from './cookies.js';

 const EXEMPT_PREFIXES = [
   '/api/webhooks/',
diff --git a/src/web/middleware/cookies.ts b/src/web/middleware/cookies.ts
new file mode 100644
index 0000000..690b483
--- /dev/null
+++ b/src/web/middleware/cookies.ts
@@ -0,0 +1,5 @@
+export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
+  if (!cookieHeader) return null;
+  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
+  return match?.[1] ?? null;
+}
diff --git a/src/web/server.ts b/src/web/server.ts
index 4de75a6..ec49c59 100644
--- a/src/web/server.ts
+++ b/src/web/server.ts
@@ -109,9 +109,7 @@ function createApp(

     let dockerContainers = 0;
     try {
-      const containers = await ctx.docker.getClient().listContainers({
-        filters: { label: ['openlander.managed=true'] },
-      });
+      const containers = await ctx.docker.listManagedContainers();
       dockerContainers = containers.length;
     } catch (err) {
       log.debug({ err }, 'Docker container list failed during health check');
diff --git a/test/pipeline/docker-methods.test.ts b/test/pipeline/docker-methods.test.ts
index d603b86..54b5d5e 100644
--- a/test/pipeline/docker-methods.test.ts
+++ b/test/pipeline/docker-methods.test.ts
@@ -17,6 +17,11 @@ const mockGetContainer = vi.fn();
 const mockFollowProgress = vi.fn();
 const mockGetNetwork = vi.fn();
 const mockDemuxStream = vi.fn();
+const mockDf = vi.fn();
+const mockGetVolume = vi.fn();
+const mockListVolumes = vi.fn();
+const mockCreateVolume = vi.fn();
+const mockGetEvents = vi.fn();

 const require = createRequire(import.meta.url);
 const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
@@ -27,6 +32,11 @@ const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
   this.getImage = mockGetImage;
   this.getContainer = mockGetContainer;
   this.getNetwork = mockGetNetwork;
+  this.df = mockDf;
+  this.getVolume = mockGetVolume;
+  this.listVolumes = mockListVolumes;
+  this.createVolume = mockCreateVolume;
+  this.getEvents = mockGetEvents;
   this.modem = {
     followProgress: mockFollowProgress,
     demuxStream: mockDemuxStream,
@@ -55,6 +65,11 @@ const resetMocks = () => {
   mockFollowProgress.mockReset();
   mockGetNetwork.mockReset();
   mockDemuxStream.mockReset();
+  mockDf.mockReset();
+  mockGetVolume.mockReset();
+  mockListVolumes.mockReset();
+  mockCreateVolume.mockReset();
+  mockGetEvents.mockReset();
 };

 /** Creates a Docker "not found" error that matches isDockerNotFoundError. */
@@ -366,3 +381,458 @@ describe('getNetworkInfo', () => {
     await expect(docker.getNetworkInfo('broken')).rejects.toThrow('driver error');
   });
 });
+
+// ---------------------------------------------------------------------------
+// Tests: inspectImage
+// ---------------------------------------------------------------------------
+
+describe('inspectImage', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns image inspect info on success', async () => {
+    const imageData = { Id: 'sha256:abc123', RepoTags: ['myapp:latest'], Size: 150_000_000 };
+    mockGetImage.mockReturnValueOnce({
+      inspect: vi.fn().mockResolvedValueOnce(imageData),
+    });
+
+    const docker = new Docker();
+    const result = await docker.inspectImage('myapp:latest');
+
+    expect(result).toEqual(imageData);
+    expect(mockGetImage).toHaveBeenCalledWith('myapp:latest');
+  });
+
+  it('throws "Image not found" error when image does not exist', async () => {
+    mockGetImage.mockReturnValueOnce({
+      inspect: vi.fn().mockRejectedValueOnce(new Error('No such image: missing:latest')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.inspectImage('missing:latest')).rejects.toThrow(
+      'Image not found: missing:latest',
+    );
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: removeImage
+// ---------------------------------------------------------------------------
+
+describe('removeImage', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('removes image successfully', async () => {
+    const removeFn = vi.fn().mockResolvedValueOnce(undefined);
+    mockGetImage.mockReturnValueOnce({ remove: removeFn });
+
+    const docker = new Docker();
+    await expect(docker.removeImage('old:v1')).resolves.toBeUndefined();
+
+    expect(mockGetImage).toHaveBeenCalledWith('old:v1');
+    expect(removeFn).toHaveBeenCalledWith({ force: false });
+  });
+
+  it('silently returns when image is not found (404)', async () => {
+    mockGetImage.mockReturnValueOnce({
+      remove: vi.fn().mockRejectedValueOnce(new Error('No such image: gone:v1')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.removeImage('gone:v1')).resolves.toBeUndefined();
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: getContainerStats
+// ---------------------------------------------------------------------------
+
+describe('getContainerStats', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns container stats on success', async () => {
+    const statsData = {
+      cpu_stats: { cpu_usage: { total_usage: 100 } },
+      memory_stats: { usage: 50_000_000 },
+    };
+    mockGetContainer.mockReturnValueOnce({
+      stats: vi.fn().mockResolvedValueOnce(statsData),
+    });
+
+    const docker = new Docker();
+    const result = await docker.getContainerStats('c1');
+
+    expect(result).toEqual(statsData);
+    expect(mockGetContainer).toHaveBeenCalledWith('c1');
+  });
+
+  it('throws ContainerNotFoundError when container does not exist', async () => {
+    mockGetContainer.mockReturnValueOnce({
+      stats: vi.fn().mockRejectedValueOnce(notFoundError('missing')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.getContainerStats('missing')).rejects.toMatchObject({
+      name: 'ContainerNotFoundError',
+    });
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: getDiskUsage
+// ---------------------------------------------------------------------------
+
+describe('getDiskUsage', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns disk usage data on success', async () => {
+    const diskData = {
+      LayersSize: 1_000_000_000,
+      Images: [{ Id: 'sha256:abc' }],
+      Containers: [],
+      Volumes: [],
+    };
+    mockDf.mockResolvedValueOnce(diskData);
+
+    const docker = new Docker();
+    const result = await docker.getDiskUsage();
+
+    expect(result).toEqual(diskData);
+  });
+
+  it('propagates errors from Docker daemon', async () => {
+    mockDf.mockRejectedValueOnce(new Error('daemon unavailable'));
+
+    const docker = new Docker();
+    await expect(docker.getDiskUsage()).rejects.toThrow('daemon unavailable');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: inspectVolume
+// ---------------------------------------------------------------------------
+
+describe('inspectVolume', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns volume inspect info on success', async () => {
+    const volumeData = {
+      Name: 'my-vol',
+      Driver: 'local',
+      Mountpoint: '/var/lib/docker/volumes/my-vol/_data',
+    };
+    mockGetVolume.mockReturnValueOnce({
+      inspect: vi.fn().mockResolvedValueOnce(volumeData),
+    });
+
+    const docker = new Docker();
+    const result = await docker.inspectVolume('my-vol');
+
+    expect(result).toEqual(volumeData);
+    expect(mockGetVolume).toHaveBeenCalledWith('my-vol');
+  });
+
+  it('throws "Volume not found" error when volume does not exist', async () => {
+    mockGetVolume.mockReturnValueOnce({
+      inspect: vi.fn().mockRejectedValueOnce(new Error('No such volume: missing-vol')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.inspectVolume('missing-vol')).rejects.toThrow(
+      'Volume not found: missing-vol',
+    );
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: listVolumes
+// ---------------------------------------------------------------------------
+
+describe('listVolumes', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns array of volumes', async () => {
+    const volumes = [
+      { Name: 'vol-a', Driver: 'local' },
+      { Name: 'vol-b', Driver: 'local' },
+    ];
+    mockListVolumes.mockResolvedValueOnce({ Volumes: volumes });
+
+    const docker = new Docker();
+    const result = await docker.listVolumes();
+
+    expect(result).toEqual(volumes);
+  });
+
+  it('returns empty array when no volumes exist', async () => {
+    mockListVolumes.mockResolvedValueOnce({ Volumes: undefined });
+
+    const docker = new Docker();
+    const result = await docker.listVolumes();
+
+    expect(result).toEqual([]);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: createVolume
+// ---------------------------------------------------------------------------
+
+describe('createVolume', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('creates volume with MANAGED=true label and extra labels', async () => {
+    mockCreateVolume.mockResolvedValueOnce(undefined);
+
+    const docker = new Docker();
+    await docker.createVolume({ name: 'my-data', labels: { custom: 'value' } });
+
+    expect(mockCreateVolume).toHaveBeenCalledWith(
+      expect.objectContaining({
+        Name: 'my-data',
+        Labels: expect.objectContaining({
+          'openlander.managed': 'true',
+          custom: 'value',
+        }),
+      }),
+    );
+  });
+
+  it('creates volume with only MANAGED label when no extra labels provided', async () => {
+    mockCreateVolume.mockResolvedValueOnce(undefined);
+
+    const docker = new Docker();
+    await docker.createVolume({ name: 'plain-vol' });
+
+    expect(mockCreateVolume).toHaveBeenCalledWith(
+      expect.objectContaining({
+        Name: 'plain-vol',
+        Labels: expect.objectContaining({
+          'openlander.managed': 'true',
+        }),
+      }),
+    );
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: removeVolume
+// ---------------------------------------------------------------------------
+
+describe('removeVolume', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('removes volume successfully', async () => {
+    const removeFn = vi.fn().mockResolvedValueOnce(undefined);
+    mockGetVolume.mockReturnValueOnce({ remove: removeFn });
+
+    const docker = new Docker();
+    await expect(docker.removeVolume('my-vol')).resolves.toBeUndefined();
+
+    expect(mockGetVolume).toHaveBeenCalledWith('my-vol');
+    expect(removeFn).toHaveBeenCalledTimes(1);
+  });
+
+  it('silently returns when volume is not found (404)', async () => {
+    mockGetVolume.mockReturnValueOnce({
+      remove: vi.fn().mockRejectedValueOnce(new Error('No such volume: gone-vol')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.removeVolume('gone-vol')).resolves.toBeUndefined();
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: renameContainer
+// ---------------------------------------------------------------------------
+
+describe('renameContainer', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('renames container successfully', async () => {
+    const renameFn = vi.fn().mockResolvedValueOnce(undefined);
+    mockGetContainer.mockReturnValueOnce({ rename: renameFn });
+
+    const docker = new Docker();
+    await docker.renameContainer('c1', 'new-name');
+
+    expect(mockGetContainer).toHaveBeenCalledWith('c1');
+    expect(renameFn).toHaveBeenCalledWith({ name: 'new-name' });
+  });
+
+  it('throws ContainerNotFoundError when container does not exist', async () => {
+    mockGetContainer.mockReturnValueOnce({
+      rename: vi.fn().mockRejectedValueOnce(notFoundError('missing')),
+    });
+
+    const docker = new Docker();
+    await expect(docker.renameContainer('missing', 'new-name')).rejects.toMatchObject({
+      name: 'ContainerNotFoundError',
+    });
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: waitForContainer
+// ---------------------------------------------------------------------------
+
+describe('waitForContainer', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns StatusCode 0 on successful exit', async () => {
+    const waitFn = vi.fn().mockResolvedValueOnce({ StatusCode: 0 });
+    mockGetContainer.mockReturnValueOnce({ wait: waitFn });
+
+    const docker = new Docker();
+    const result = await docker.waitForContainer('c1');
+
+    expect(result).toEqual({ StatusCode: 0 });
+    expect(mockGetContainer).toHaveBeenCalledWith('c1');
+  });
+
+  it('returns non-zero StatusCode on container failure', async () => {
+    const waitFn = vi.fn().mockResolvedValueOnce({ StatusCode: 137 });
+    mockGetContainer.mockReturnValueOnce({ wait: waitFn });
+
+    const docker = new Docker();
+    const result = await docker.waitForContainer('crashed');
+
+    expect(result).toEqual({ StatusCode: 137 });
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: runServiceContainer
+// ---------------------------------------------------------------------------
+
+describe('runServiceContainer', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('creates and starts a service container, returns container id', async () => {
+    const containerHandle = {
+      id: 'svc-container-id',
+      start: vi.fn().mockResolvedValueOnce(undefined),
+    };
+    mockCreateContainer.mockResolvedValueOnce(containerHandle);
+
+    const docker = new Docker();
+    const id = await docker.runServiceContainer({
+      imageTag: 'postgres:15',
+      name: 'ol-svc-postgres',
+      port: 5432,
+      envVars: { POSTGRES_PASSWORD: 'secret' },
+      serviceName: 'postgres',
+    });
+
+    expect(id).toBe('svc-container-id');
+    expect(containerHandle.start).toHaveBeenCalledTimes(1);
+    expect(mockCreateContainer).toHaveBeenCalledWith(
+      expect.objectContaining({
+        Image: 'postgres:15',
+        name: 'ol-svc-postgres',
+        Labels: expect.objectContaining({
+          'openlander.managed': 'true',
+          'openlander.role': 'service',
+          'openlander.service': 'postgres',
+        }),
+      }),
+    );
+  });
+
+  it('propagates errors from createContainer', async () => {
+    mockCreateContainer.mockRejectedValueOnce(new Error('image not found'));
+
+    const docker = new Docker();
+    await expect(
+      docker.runServiceContainer({
+        imageTag: 'bad:image',
+        name: 'ol-svc-bad',
+        port: 5432,
+        envVars: {},
+        serviceName: 'bad',
+      }),
+    ).rejects.toThrow('image not found');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: execStream
+// ---------------------------------------------------------------------------
+
+describe('execStream', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns a readable/writable stream with default tty=true', async () => {
+    const mockStream = new PassThrough();
+    const execStart = vi.fn().mockResolvedValueOnce(mockStream);
+    const containerExec = vi.fn().mockResolvedValueOnce({ start: execStart });
+    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
+
+    const docker = new Docker();
+    const result = await docker.execStream('c1', ['/bin/bash']);
+
+    expect(result).toBe(mockStream);
+    expect(containerExec).toHaveBeenCalledWith({
+      Cmd: ['/bin/bash'],
+      AttachStdin: true,
+      AttachStdout: true,
+      AttachStderr: true,
+      Tty: true,
+    });
+    expect(execStart).toHaveBeenCalledWith({ hijack: true, stdin: true });
+  });
+
+  it('respects tty option when set to false', async () => {
+    const mockStream = new PassThrough();
+    const execStart = vi.fn().mockResolvedValueOnce(mockStream);
+    const containerExec = vi.fn().mockResolvedValueOnce({ start: execStart });
+    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
+
+    const docker = new Docker();
+    await docker.execStream('c1', ['ls', '-la'], { tty: false });
+
+    expect(containerExec).toHaveBeenCalledWith(expect.objectContaining({ Tty: false }));
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Tests: getEventStream
+// ---------------------------------------------------------------------------
+
+describe('getEventStream', () => {
+  beforeEach(resetMocks);
+  afterEach(() => vi.restoreAllMocks());
+
+  it('returns event stream with filters applied', async () => {
+    const mockStream = new PassThrough();
+    mockGetEvents.mockResolvedValueOnce(mockStream);
+
+    const docker = new Docker();
+    const filters = { type: ['container'], event: ['start', 'die'] };
+    const result = await docker.getEventStream(filters);
+
+    expect(result).toBe(mockStream);
+    expect(mockGetEvents).toHaveBeenCalledWith({ filters });
+  });
+
+  it('propagates errors from Docker daemon', async () => {
+    mockGetEvents.mockRejectedValueOnce(new Error('connection refused'));
+
+    const docker = new Docker();
+    await expect(docker.getEventStream({ type: ['container'] })).rejects.toThrow(
+      'connection refused',
+    );
+  });
+});

exec
/bin/bash -lc "rg -n \"getClient\\(\" src/pipeline src/monitor src/tools src/web test" in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/traefik.ts:161:      const client = (this.docker as any).getClient();
src/pipeline/deploy-core.ts:966:    const client = getClient();

exec
/bin/bash -lc 'git rev-list --count 5cd9a29..995ab0b && git log --oneline --reverse 5cd9a29..995ab0b' in /home/lee/OpenLander
 succeeded in 0ms:
10
7e2e53a refactor(pipeline): migrate deploy-core, lifecycle, rollback, image-utils, traefik from raw dockerode
861b5c1 refactor(monitor): migrate monitor modules from raw dockerode to docker.ts
1ebc98e refactor: extract shared retry utility and tool helpers (#47)
63f2e0f refactor(monitor,pipeline): migrate docker-events to getEventStream, add PR3 suppression in deploy-core
0507771 refactor(tools): migrate tool defs from raw dockerode to docker.ts
a8879d8 refactor(web,pipeline): migrate web routes, service-manager, recover from raw dockerode
c700bca refactor(pipeline): remove getClient() — docker.ts is now the sole Docker API entry point
666b4fa test(pipeline): add tests for PR2+PR3 Docker wrapper methods
78ce84d test: fix mock regressions after getClient() removal
995ab0b merge: integrate PR #47 — resolve terminal-routes.ts and terminal-shell.test.ts conflicts

codex
I found only the two remaining `getClient()` references you already identified. Next I’m checking the actual wrapper implementations against the old call sites to see whether behavior changed in subtle ways, especially around service containers, exec streams, and Docker event/log stream cleanup.
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
        const info = await this.docker.inspectContainer(containerRef);

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
          await this.docker.connectContainerToNetwork(info.Id, SHARED_NETWORK_NAME, [service.name]);
          migrated += 1;
          log.info(
            { serviceId: service.id, serviceName: service.name, containerId: info.Id },

exec
/bin/bash -lc "sed -n '1,420p' src/pipeline/docker.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('docker');

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { getDataDir, getPolicy, SHARED_NETWORK_NAME, DOCKER_LABELS } from '../config/index.js';
import { sleep } from '../lib/sleep.js';
import { containerName, stripContainerPrefix } from './helpers.js';
import type Dockerode from 'dockerode';

import {
  DockerNotRunningError,
  DockerBuildError,
  ContainerNotFoundError,
  isDockerNotFoundError,
} from '../errors.js';

function isAlreadyConnectedError(msg: string): boolean {
  return msg.includes('already exists') || msg.includes('already connected');
}

function isContainerNotRunning(msg: string): boolean {
  return msg.includes('is not running');
}

function isContainerAlreadyRunning(msg: string): boolean {
  return msg.includes('is already running') || msg.includes('already started');
}

function isNotConnectedToNetwork(msg: string): boolean {
  return msg.includes('is not connected');
}

export type DockerStatus =
  | { state: 'running' }
  | { state: 'not_installed' }
  | { state: 'not_running' }
  | { state: 'permission_denied'; groupFixed?: boolean };

export interface SecretFileMount {
  filename: string;
  content: string;
  mountPath: string;
}

export interface RunContainerOptions {
  imageTag: string;
  name: string;
  /** Host port for external access. */
  port: number;
  /** Container-internal port the app listens on (default: same as port). */
  containerPort?: number;
  envVars: Record<string, string>;
  cmd?: string[];
  traefikLabels: Record<string, string>;
  network?: string;
  secretFiles?: SecretFileMount[];
  /** Docker restart policy (default: on-failure with MaximumRetryCount: 5). */
  restartPolicy?: { Name: string; MaximumRetryCount?: number };
  /** Additional volume or bind mounts (e.g. `["vol:/data"]`). */
  extraBinds?: string[];
  /** Docker healthcheck configuration (intervals in seconds). */
  healthcheck?: {
    test: string | string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    start_period?: number;
  };
  /**
   * When provided, replaces auto-generated labels entirely.
   * By default, runContainer adds MANAGED + PROJECT + traefikLabels.
   * Use this for non-project containers (e.g. services) that need different labels.
   */
  labels?: Record<string, string>;
}

export interface RunComposeServiceOptions {
  imageTag: string;
  name: string;
  port: number;
  containerPort?: number;
  envVars: Record<string, string>;
  traefikLabels: Record<string, string>;
  secretFiles?: SecretFileMount[];
  command?: string | string[];
  entrypoint?: string | string[];
  restart?: string;
  healthcheck?: {
    test: string | string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    start_period?: number;
  };
  network?: string;
  networks?: string[];
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  port?: number;
  imageTag?: string;
  labels?: Record<string, string>;
}

export interface PortInfo {
  IP?: string;
  PrivatePort?: number;
  PublicPort?: number;
  Type?: string;
}

/** Extended container info for all containers (including non-OpenLander managed). */
export interface AllContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: PortInfo[];
  labels: Record<string, string>;
  managedByOpenLander: boolean;
  composeProject: string | null;
  created: number;
}

export interface BuildImageOptions {
  noCache?: boolean;
  buildArgs?: Record<string, string>;
  target?: string;
  dockerfile?: string;
  onProgress?: (event: { stream?: string; error?: string }) => void;
  /** When provided, the build stream is tracked in activeBuilds so it can be cancelled via cancelBuild(). */
  projectId?: string;
}

export interface BuildComposeServiceOptions {
  contextPath: string;
  dockerfile?: string;
  tag: string;
  buildArgs?: Record<string, string>;
  target?: string;
  noCache?: boolean;
  cacheFrom?: string[];
  onProgress?: (event: { stream?: string; error?: string }) => void;
}

/** Health check result from post-deploy container monitoring. */
export interface WaitForHealthyResult {
  healthy: boolean;
  exitCode?: number;
  error?: string;
}

function stripDockerStreamHeaders(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  const firstByte = buffer[0];
  if (firstByte !== 0 && firstByte !== 1 && firstByte !== 2) {
    return buffer.toString('utf8');
  }

  const HEADER_SIZE = 8;
  const chunks: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + HEADER_SIZE > buffer.length) {
      chunks.push(buffer.subarray(offset).toString('utf8'));
      break;
    }

    const payloadSize = buffer.readUInt32BE(offset + 4);
    const payloadStart = offset + HEADER_SIZE;
    const payloadEnd = payloadStart + payloadSize;

    if (payloadEnd > buffer.length) {
      chunks.push(buffer.subarray(payloadStart).toString('utf8'));
      break;
    }

    chunks.push(buffer.subarray(payloadStart, payloadEnd).toString('utf8'));
    offset = payloadEnd;
  }

  return chunks.join('');
}

/**
 * Docker control layer using dockerode.
 *
 * Wraps all Docker operations with proper error handling
 * and user-friendly error messages.
 */
export class Docker {
  private readonly client: Dockerode;
  private readonly networkName: string;
  private readonly activeBuilds = new Map<string, Readable>();

  constructor(socketPath?: string, networkName?: string) {
    const require = createRequire(import.meta.url);

    // docker-modem eagerly requires its SSH transport, which pulls in ssh2's
    // native crypto addon at startup. On this runtime that addon can segfault
    // during module load even though OpenLander uses Unix socket transport.
    // Stub the SSH transport module so dockerode startup stays on the socket path.
    const dockerSshModulePath = require.resolve('docker-modem/lib/ssh.js');
    if (!require.cache[dockerSshModulePath]) {
      const dockerSshStub = {
        id: dockerSshModulePath,
        filename: dockerSshModulePath,
        loaded: true,
        exports: () => {
          throw new Error('Docker SSH transport is unavailable in this runtime');
        },
      } as unknown as NodeJS.Module;
      require.cache[dockerSshModulePath] = dockerSshStub;
    }

    const dockerodeModule = require('dockerode') as
      | { default?: new (options?: unknown) => Dockerode }
      | (new (options?: unknown) => Dockerode);
    const DockerodeClass =
      typeof dockerodeModule === 'function' ? dockerodeModule : dockerodeModule.default;
    if (!DockerodeClass) {
      throw new Error('Failed to load dockerode constructor');
    }

    this.networkName = networkName ?? getPolicy('production').networkName;
    if (socketPath) {
      this.client = new DockerodeClass({ socketPath });
    } else {
      const resolved = resolveDockerSocket();
      this.client = resolved ? new DockerodeClass({ socketPath: resolved }) : new DockerodeClass();
    }
  }

  /** Verify Docker daemon is accessible. */
  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (err) {
      log.debug({ err }, 'Docker ping failed');
      return false;
    }
  }

  /** Detailed Docker status: not_installed / not_running / permission_denied / running. */
  async status(): Promise<DockerStatus> {
    // 1. Check if docker binary exists
    try {
      execSync('docker --version', { stdio: 'pipe' });
    } catch (err) {
      log.debug({ err }, 'Docker binary check failed');
      return { state: 'not_installed' };
    }

    // 2. Try dockerode ping (works if current process has docker group)
    try {
      await this.client.ping();
      return { state: 'running' };
    } catch (err) {
      log.debug({ err }, 'Dockerode ping failed — trying sg docker');
      // fall through
    }

    // 3. Try `sg docker` — Linux only (macOS Docker Desktop doesn't use groups)
    if (process.platform !== 'darwin') {
      try {
        execSync('sg docker -c "docker info"', { stdio: 'pipe', timeout: 5000 });
        return { state: 'running' };
      } catch (err) {
        log.debug({ err }, 'sg docker check failed');
      }
    }

    // 4. Determine permission vs daemon-not-running
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000, encoding: 'utf8' });
      return { state: 'running' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
      const combined = msg + stderr;
      if (
        combined.includes('permission denied') ||
        combined.includes('Permission denied') ||
        combined.includes('EACCES')
      ) {
        const groupFixed = isUserInDockerGroup();
        return { state: 'permission_denied', groupFixed };
      }
    }

    return { state: 'not_running' };
  }

  /** Verify Docker is running, throw typed error if not. */
  async ensureRunning(): Promise<void> {
    const ok = await this.ping();
    if (!ok) {
      throw new DockerNotRunningError();
    }
  }

  /** Build a Docker image from a directory containing a Dockerfile. */
  async buildImage(contextPath: string, tag: string, options?: BuildImageOptions): Promise<void> {
    const trackingId = options?.projectId;

    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.client.buildImage(
        { context: contextPath, src: ['.'] },
        {
          t: tag,
          nocache: options?.noCache === true,
          buildargs: options?.buildArgs,
          target: options?.target,
          dockerfile: options?.dockerfile,
        },
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new DockerBuildError(
        tag,
        `Build failed for ${tag} (context: ${contextPath}): ${errMsg}`,
      );
    }

    if (trackingId) {
      this.activeBuilds.set(trackingId, stream as Readable);
    }

    let buildLog = '';
    let buildError = '';
    try {
      await new Promise<void>((resolve, reject) => {
        this.client.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (err) {
              const reason = [buildLog, buildError, err.message].filter(Boolean).join('\n');
              reject(
                new DockerBuildError(
                  tag,
                  `Build failed for ${tag} (context: ${contextPath}): ${reason}`,
                ),
              );
            } else if (buildError) {
              const reason = [buildLog, buildError].filter(Boolean).join('\n');
              reject(
                new DockerBuildError(
                  tag,
                  `Build failed for ${tag} (context: ${contextPath}): ${reason}`,
                ),
              );
            } else {
              resolve();
            }
          },
          (event: { stream?: string; error?: string }) => {
            if (event.stream) buildLog += event.stream;
            if (event.error) {
              buildError += event.error + '\n';
              buildLog += `ERROR: ${event.error}\n`;
            }
            options?.onProgress?.(event);
          },
        );
      });
    } finally {
      if (trackingId) {
        this.activeBuilds.delete(trackingId);
      }
    }
  }

  cancelBuild(projectId: string): boolean {
    const stream = this.activeBuilds.get(projectId);
    if (!stream) {
      return false;
    }
    stream.destroy();
    this.activeBuilds.delete(projectId);
    log.info({ projectId }, 'Build cancelled');
    return true;
  }

  async buildComposeService(opts: BuildComposeServiceOptions): Promise<void> {
    const dockerfile = opts.dockerfile ?? 'Dockerfile';

    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.client.buildImage(
        { context: opts.contextPath, src: ['.'] },
        {
          t: opts.tag,
          dockerfile,
          buildargs: opts.buildArgs,
          target: opts.target,
          nocache: opts.noCache === true,
          ...(opts.cacheFrom &&
            opts.cacheFrom.length > 0 && { cachefrom: JSON.stringify(opts.cacheFrom) }),
        },
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new DockerBuildError(
        opts.tag,
        `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${errMsg}`,
      );

exec
/bin/bash -lc "sed -n '420,900p' src/pipeline/docker.ts" in /home/lee/OpenLander
 succeeded in 0ms:
      );
    }

    let buildLog = '';
    let buildError = '';
    await new Promise<void>((resolve, reject) => {
      this.client.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            const reason = [buildLog, buildError, err.message].filter(Boolean).join('\n');
            reject(
              new DockerBuildError(
                opts.tag,
                `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${reason}`,
              ),
            );
          } else if (buildError) {
            const reason = [buildLog, buildError].filter(Boolean).join('\n');
            reject(
              new DockerBuildError(
                opts.tag,
                `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${reason}`,
              ),
            );
          } else {
            resolve();
          }
        },
        (event: { stream?: string; error?: string }) => {
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

    const healthcheck = options.healthcheck
      ? {
          Test:
            typeof options.healthcheck.test === 'string'
              ? ['CMD-SHELL', options.healthcheck.test]
              : options.healthcheck.test,
          ...(options.healthcheck.interval !== undefined
            ? { Interval: options.healthcheck.interval * 1_000_000_000 }
            : {}),
          ...(options.healthcheck.timeout !== undefined
            ? { Timeout: options.healthcheck.timeout * 1_000_000_000 }
            : {}),
          ...(options.healthcheck.retries !== undefined
            ? { Retries: options.healthcheck.retries }
            : {}),
          ...(options.healthcheck.start_period !== undefined
            ? { StartPeriod: options.healthcheck.start_period * 1_000_000_000 }
            : {}),
        }
      : undefined;

    const container = await this.client.createContainer({
      Image: options.imageTag,
      name: options.name,
      Env: envArray,
      Labels: options.labels ?? {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.PROJECT]: stripContainerPrefix(options.name),
        ...options.traefikLabels,
      },
      ExposedPorts: {
        [`${String(cPort)}/tcp`]: {},
      },
      Cmd: options.cmd,
      Healthcheck: healthcheck,
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
      if (isAlreadyConnectedError(msg)) {
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
      if (!isContainerNotRunning(msg)) {
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
      if (!isContainerAlreadyRunning(msg)) {
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
      if (isNotConnectedToNetwork(msg) || isDockerNotFoundError(error)) {
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
      if (isAlreadyConnectedError(msg)) {
        return;
      }

exec
/bin/bash -lc "sed -n '900,1400p' src/pipeline/docker.ts" in /home/lee/OpenLander
 succeeded in 0ms:
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
          };
        }

        if (info.State.Running) {
          // If health check is defined, wait for healthy status
          if (info.State.Health?.Status === 'healthy') {
            return { healthy: true };
          }
          // No health check defined — running is good enough
          if (!info.State.Health) {
            return { healthy: true };
          }
          // Health check exists but not yet healthy — keep waiting
        }
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          return { healthy: false, error: 'Container not found' };
        }
      }

      await sleep(checkInterval);
    }

    // Timeout — do a final check
    try {
      const container = this.client.getContainer(containerId);
      const info = await container.inspect();
      if (info.State.Restarting) {
        return {
          healthy: false,
          exitCode: info.State.ExitCode,
          error: `Container entered restart loop (exit code: ${String(info.State.ExitCode)})`,
        };
      }
      return {
        healthy: info.State.Running,
        exitCode: info.State.ExitCode,
        error: info.State.Running ? undefined : 'Container did not become healthy within timeout',
      };
    } catch (_err) {
      return { healthy: false, error: 'Container check timed out' };
    }
  }

  /** List all OpenLander-managed containers. */
  async listManagedContainers(): Promise<ContainerInfo[]> {
    const containers = await this.client.listContainers({
      all: true,
      filters: { label: [`${DOCKER_LABELS.MANAGED}=true`] },
    });

    return containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, '') ?? 'unknown',
      status: c.State,
      port: c.Ports[0]?.PublicPort,
      imageTag: c.Image,
      labels: (c.Labels as Record<string, string> | undefined) ?? {},
    }));
  }

  /** List all containers on the server (including non-OpenLander managed). */
  async listAllContainers(): Promise<AllContainerInfo[]> {
    try {
      const containers = await this.client.listContainers({ all: true });

      return containers.map((c) => {
        // Labels may be undefined at runtime despite dockerode types
        const labels = (c.Labels as Record<string, string> | undefined) ?? {};
        return {
          id: c.Id,
          name: c.Names[0]?.replace(/^\//, '') ?? 'unknown',
          image: c.Image,
          state: c.State,
          status: c.Status,
          ports: c.Ports.map((p) => ({
            IP: p.IP,
            PrivatePort: p.PrivatePort,
            PublicPort: p.PublicPort,
            Type: p.Type,
          })),
          labels,
          managedByOpenLander: labels[DOCKER_LABELS.MANAGED] === 'true',
          composeProject: labels['com.docker.compose.project'] ?? null,
          created: c.Created,
        };
      });
    } catch (error) {
      // Docker daemon not running or connection error
      log.warn({ error }, 'Failed to list all containers, returning empty array');
      return [];
    }
  }
  /** List dangling (untagged) Docker images. */
  async listDanglingImages(): Promise<Dockerode.ImageInfo[]> {
    return await this.client.listImages({ filters: { dangling: ['true'] } });
  }

  /**
   * Pull a Docker image from registry.
   * Silently succeeds if the image already exists locally and pull fails
   * (e.g. no network).
   */
  async pullImage(imageTag: string): Promise<void> {
    try {
      const stream = await this.client.pull(imageTag);
      await new Promise<void>((resolve, reject) => {
        this.client.modem.followProgress(stream, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      // Check if image exists locally — if so, swallow the pull error
      try {
        await this.client.getImage(imageTag).inspect();
        log.debug({ err, imageTag }, 'Image pull failed but image exists locally');
      } catch (_inspectErr) {
        throw new Error(
          `Failed to pull image "${imageTag}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Inspect a Docker image. Throws if not found. */
  async inspectImage(tag: string): Promise<Dockerode.ImageInspectInfo> {
    try {
      return await this.client.getImage(tag).inspect();
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new Error(`Image not found: ${tag}`);
      throw error;
    }
  }

  /** Remove a Docker image. Silent on 404. */
  async removeImage(tag: string, force = false): Promise<void> {
    try {
      await this.client.getImage(tag).remove({ force });
    } catch (error) {
      if (isDockerNotFoundError(error)) return;
      throw error;
    }
  }

  /** Get one-shot container stats (CPU, memory). */
  async getContainerStats(containerId: string): Promise<unknown> {
    try {
      const container = this.client.getContainer(containerId);
      return await container.stats({ stream: false });
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
      throw error;
    }
  }

  /** Rename a container. */
  async renameContainer(containerId: string, newName: string): Promise<void> {
    try {
      const container = this.client.getContainer(containerId);
      await container.rename({ name: newName });
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
      throw error;
    }
  }

  /** Wait for a container to exit. Returns exit code. */
  async waitForContainer(containerId: string): Promise<{ StatusCode: number }> {
    const container = this.client.getContainer(containerId);
    return (await container.wait()) as { StatusCode: number };
  }

  /** Docker system disk usage (images, containers, volumes). */
  async getDiskUsage(): Promise<unknown> {
    return await this.client.df();
  }

  /** Inspect a volume. */
  async inspectVolume(name: string): Promise<Dockerode.VolumeInspectInfo> {
    try {
      return await this.client.getVolume(name).inspect();
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new Error(`Volume not found: ${name}`);
      throw error;
    }
  }

  /** List volumes with optional filters. */
  async listVolumes(filters?: Record<string, string[]>): Promise<Dockerode.VolumeInspectInfo[]> {
    const result = (await this.client.listVolumes(
      filters ? { filters } : undefined,
    )) as unknown as { Volumes?: Dockerode.VolumeInspectInfo[] };
    return result.Volumes ?? [];
  }

  /** Create a volume. Always applies MANAGED=true label. */
  async createVolume(opts: { name: string; labels?: Record<string, string> }): Promise<void> {
    await this.client.createVolume({
      Name: opts.name,
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        ...opts.labels,
      },
    });
  }

  /** Remove a volume. Silent on 404. */
  async removeVolume(name: string): Promise<void> {
    try {
      await this.client.getVolume(name).remove();
    } catch (error) {
      if (isDockerNotFoundError(error)) return;
      throw error;
    }
  }

  /** Run a service container (PostgreSQL, Redis, etc.) with SERVICE role labels and unless-stopped restart. */
  async runServiceContainer(opts: {
    imageTag: string;
    name: string;
    port: number;
    containerPort?: number;
    hostPort?: number;
    envVars: Record<string, string>;
    serviceName: string;
    volumeBinds?: string[];
    healthcheck?: {
      test: string[];
      interval: number;
      timeout: number;
      retries: number;
      startPeriod: number;
    };
    cmd?: string[];
  }): Promise<string> {
    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
    const containerPort = opts.containerPort ?? opts.port;
    const hostPort = opts.hostPort ?? opts.port;
    const networkingConfig = {
      EndpointsConfig: {
        [SHARED_NETWORK_NAME]: { Aliases: [opts.serviceName] },
      },
    };

    const container = await this.client.createContainer({
      Image: opts.imageTag,
      name: opts.name,
      Env: envArray,
      ...(opts.cmd ? { Cmd: opts.cmd } : {}),
      ...(opts.healthcheck
        ? {
            Healthcheck: {
              Test: opts.healthcheck.test,
              Interval: opts.healthcheck.interval * 1_000_000_000,
              Timeout: opts.healthcheck.timeout * 1_000_000_000,
              Retries: opts.healthcheck.retries,
              StartPeriod: opts.healthcheck.startPeriod * 1_000_000_000,
            },
          }
        : {}),
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.ROLE]: 'service',
        [DOCKER_LABELS.SERVICE]: opts.serviceName,
      },
      ExposedPorts: { [`${String(containerPort)}/tcp`]: {} },
      NetworkingConfig: networkingConfig,
      HostConfig: {
        NetworkMode: this.networkName,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: opts.volumeBinds ?? [],
        PortBindings: {
          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
        },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      },
    });

    await container.start();
    return container.id;
  }

  /** Open an interactive TTY exec stream for WebSocket bridging. Returns duplex stream. */
  async execStream(
    containerId: string,
    cmd: string[],
    opts?: { tty?: boolean },
  ): Promise<NodeJS.ReadWriteStream> {
    const container = this.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: opts?.tty ?? true,
    });
    return (await exec.start({ hijack: true, stdin: true })) as unknown as NodeJS.ReadWriteStream;
  }

  /** Get Docker daemon event stream for real-time container events. */
  async getEventStream(filters: Record<string, string[]>): Promise<NodeJS.ReadableStream> {
    return await (
      this.client.getEvents as (opts: {
        filters: Record<string, string[]>;
      }) => Promise<NodeJS.ReadableStream>
    )({
      filters,
    });
  }

  getNetworkName(): string {
    return this.networkName;
  }

  /** Ensure a Docker network exists, creating it if missing. Returns the network name. */
  async ensureNetwork(name: string): Promise<string> {
    try {
      await this.client.getNetwork(name).inspect();
      return name;
    } catch (error) {
      if (!isDockerNotFoundError(error)) {
        throw error;
      }
    }
    try {
      await this.client.createNetwork({ Name: name, Driver: 'bridge' });
      return name;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) {
        return name;
      }
      throw error;
    }

exec
/bin/bash -lc "sed -n '1400,1560p' src/pipeline/docker.ts" in /home/lee/OpenLander
 succeeded in 0ms:
    }
  }

  /** Follow container logs as a readable stream for real-time log tailing. */
  async getLogStream(
    containerId: string,
    opts?: { tail?: number; stdout?: boolean; stderr?: boolean },
  ): Promise<NodeJS.ReadableStream> {
    const container = this.client.getContainer(containerId);
    return (await container.logs({
      follow: true,
      stdout: opts?.stdout ?? true,
      stderr: opts?.stderr ?? true,
      tail: opts?.tail ?? 50,
    })) as unknown as NodeJS.ReadableStream;
  }

  /** Open an interactive terminal exec with resize support. Returns stream and resize function. */
  async execTerminal(
    containerId: string,
    cmd: string[],
  ): Promise<{
    stream: NodeJS.ReadWriteStream;
    resize: (size: { w: number; h: number }) => Promise<void>;
  }> {
    const container = this.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = (await exec.start({
      hijack: true,
      stdin: true,
    })) as unknown as NodeJS.ReadWriteStream;
    return {
      stream,
      resize: async (size: { w: number; h: number }) => {
        await exec.resize(size);
      },
    };
  }
}

/** Check if current user is in the docker group (reads /etc/group). */
function isUserInDockerGroup(): boolean {
  try {
    const user = execSync('whoami', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const groups = execSync(`groups ${user}`, { encoding: 'utf8', stdio: 'pipe' });
    return groups.includes('docker');
  } catch (err) {
    log.debug({ err }, 'Failed to check docker group membership');
    return false;
  }
}

/**
 * Resolve the Docker socket path for the current platform.
 * Priority: DOCKER_HOST env → common paths → docker context inspect
 */
export function resolveDockerSocket(): string | undefined {
  // 1. DOCKER_HOST env var (set by Colima, Docker Desktop, etc.)
  const dockerHost = process.env['DOCKER_HOST'];
  if (dockerHost?.startsWith('unix://')) {
    return dockerHost.replace('unix://', '');
  }

  // 2. Common socket file paths
  const candidates = [
    '/var/run/docker.sock',
    `${homedir()}/.docker/run/docker.sock`,
    `${homedir()}/.colima/default/docker.sock`,
  ];
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;

  // 3. Fallback: ask docker CLI for the active context socket
  try {
    const host = execSync('docker context inspect --format "{{.Endpoints.docker.Host}}"', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
    }).trim();
    if (host.startsWith('unix://')) {
      const sockPath = host.replace('unix://', '');
      if (existsSync(sockPath)) return sockPath;
      // Socket file might not pass existsSync on some runtimes (Bun),
      // but docker CLI confirmed it — trust it.
      return sockPath;
    }
  } catch (_err) {
    // docker CLI not available or context not configured
  }

  return undefined;
}

export function getDockerHostType(): 'local' | 'remote' {
  const dockerHost = process.env['DOCKER_HOST'];
  if (!dockerHost) return 'local';
  try {
    const url = new URL(dockerHost);
    if (url.protocol === 'unix:') return 'local';
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local';
    return 'remote';
  } catch {
    return 'local';
  }
}

exec
/bin/bash -lc "sed -n '260,520p' src/pipeline/service-manager.ts" in /home/lee/OpenLander
 succeeded in 0ms:
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

    await this.docker.createVolume({
      name: volumeName,
      labels: {
        [DOCKER_LABELS.ROLE]: 'service',
        [DOCKER_LABELS.SERVICE]: opts.name,
      },
    });

    const envRecord: Record<string, string> = {};
    for (const entry of env) {
      const eqIdx = entry.indexOf('=');
      if (eqIdx > 0) {
        envRecord[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
      }
    }

    const containerId = await this.docker.runServiceContainer({
      imageTag: image,
      name: containerName,
      port: containerPort,
      hostPort,
      envVars: envRecord,
      serviceName: opts.name,
      volumeBinds: [`${volumeName}:${dataMountPath}`],
      ...(containerHealthcheck ? { healthcheck: containerHealthcheck } : {}),
      ...(containerCmd ? { cmd: containerCmd } : {}),
    });

    const primaryNetwork = this.docker.getNetworkName();
    const additionalNetworks = [SHARED_NETWORK_NAME].filter(
      (networkName) => networkName !== primaryNetwork,
    );

    for (const networkName of additionalNetworks) {
      try {
        await this.docker.connectContainerToNetwork(containerId, networkName, [opts.name]);
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

    this.db.updateService(id, { status: 'running', containerId });
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

exec
/bin/bash -lc "rg -n \"runServiceContainer|execStream\\(|getEventStream\\(|getLogStream\\(|ensureNetwork\\(\" src/pipeline src/monitor src/tools src/web" in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/recover.ts:64:async function ensureNetwork(
src/pipeline/recover.ts:75:    await ctx.docker.ensureNetwork(name);
src/pipeline/recover.ts:312:      result.networks.push(await ensureNetwork(ctx, name));
src/monitor/docker-events.ts:80:        const stream = await this.docker.getEventStream({
src/pipeline/traefik.ts:79:  async ensureNetwork(): Promise<void> {
src/web/api/project-routes.ts:1034:          const logStream = await ctx.docker.getLogStream(containerId, { tail: 50 });
src/pipeline/service-manager.ts:430:    const containerId = await this.docker.runServiceContainer({
src/pipeline/docker.ts:1284:  async runServiceContainer(opts: {
src/pipeline/docker.ts:1350:  async execStream(
src/pipeline/docker.ts:1367:  async getEventStream(filters: Record<string, string[]>): Promise<NodeJS.ReadableStream> {
src/pipeline/docker.ts:1382:  async ensureNetwork(name: string): Promise<string> {
src/pipeline/docker.ts:1404:  async getLogStream(

exec
/bin/bash -lc "git show 217a28c:src/pipeline/service-manager.ts | sed -n '260,520p'" in /home/lee/OpenLander
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

codex
I’ve confirmed `runServiceContainer` is intended as a straight extraction of the old `service-manager` logic, so I’m now looking for edge cases rather than wholesale behavior drift. The bigger risk area looks like wrappers that expose raw streams because correctness there depends on how callers clean them up.
exec
/bin/bash -lc "sed -n '1,220p' src/monitor/docker-events.ts" in /home/lee/OpenLander
 succeeded in 0ms:
/**
 * Docker Event Stream Listener.
 *
 * Subscribes to Docker /events for real-time crash detection (<100ms),
 * replacing the 30s polling gap that missed crashes recovered by restart policies.
 *
 * Key behaviors:
 * - Label-filtered to openlander.managed=true (server-side)
 * - exitCode=0 die events ignored (graceful stops)
 * - 'building' status projects skipped (deploy pipeline handles those)
 * - Per-container debounce (TTL-based, survives start events during crash loops)
 * - OOM→die dedup (OOM fires first, subsequent die suppressed)
 * - NDJSON stream parsing (handles partial/multi-event chunks)
 */

import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { DOCKER_LABELS } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('docker-events');

const DEBOUNCE_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** OOM event always fires before die — suppress die within this window */
const OOM_DIE_DEDUP_MS = 5_000;
const TTL_PRUNE_INTERVAL_MS = 60_000;

interface DockerEvent {
  Type: string;
  Action: string;
  Actor: {
    ID: string;
    Attributes: Record<string, string>;
  };
  time: number;
  timeNano: number;
}

export class DockerEventListener {
  private readonly docker: Docker;
  private readonly db: Database;
  private readonly events: EventBus;
  private stream: NodeJS.ReadableStream | null = null;
  private running = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private readonly recentCrashes = new Map<string, number>();
  private readonly recentOoms = new Map<string, number>();
  private lineBuf = '';
  private lastPruneAt = Date.now();

  constructor(docker: Docker, db: Database, events: EventBus) {
    this.docker = docker;
    this.db = db;
    this.events = events;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.watch();
    log.info('DockerEventListener started');
  }

  stop(): void {
    this.running = false;
    this.destroyStream();
    log.info('DockerEventListener stopped');
  }

  private isStopped(): boolean {
    return !this.running;
  }

  private async watch(): Promise<void> {
    while (this.running) {
      try {
        const stream = await this.docker.getEventStream({
          type: ['container'],
          event: ['die', 'oom', 'start'],
          label: [`${DOCKER_LABELS.MANAGED}=true`],
        });

        this.stream = stream;

        if (this.isStopped()) {
          this.destroyStream();
          break;
        }
        this.lineBuf = '';
        this.backoffMs = INITIAL_BACKOFF_MS;
        log.debug('Docker event stream connected');

        this.stream.on('data', (chunk: Buffer) => {
          this.processChunk(chunk);
        });

        this.stream.on('error', (err: Error) => {
          log.warn({ err }, 'Docker event stream error');
        });

        const currentStream = this.stream;
        await new Promise<void>((resolve) => {
          const done = () => {
            resolve();
          };
          currentStream.on('end', done);
          currentStream.on('close', done);
        });

        if (this.isStopped()) break;
        log.info('Docker event stream ended — reconnecting');
      } catch (err) {
        if (this.isStopped()) break;
        log.warn(
          { err, backoffMs: this.backoffMs },
          'Docker event stream connection failed — retrying',
        );
      }

      const jitter = Math.random() * 1000;
      await new Promise<void>((r) => {
        setTimeout(r, this.backoffMs + jitter);
      });
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  private destroyStream(): void {
    if (!this.stream) return;
    const s = this.stream as NodeJS.ReadableStream & { destroy?: () => void };
    s.destroy?.();
    this.stream = null;
  }

  /**
   * Docker /events emits newline-delimited JSON. A single chunk can contain
   * a partial line, a full line, or multiple lines. Buffer and split on '\n'.
   */
  private processChunk(chunk: Buffer): void {
    this.lineBuf += chunk.toString();
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as DockerEvent;
        void this.handleEvent(event);
      } catch (err) {
        log.debug({ err, line: trimmed.slice(0, 200) }, 'Failed to parse Docker event line');
      }
    }

    this.pruneStaleEntries();
  }

  private pruneStaleEntries(): void {
    const now = Date.now();
    if (now - this.lastPruneAt < TTL_PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;

    for (const [id, ts] of this.recentCrashes) {
      if (now - ts > DEBOUNCE_MS) this.recentCrashes.delete(id);
    }
    for (const [id, ts] of this.recentOoms) {
      if (now - ts > OOM_DIE_DEDUP_MS) this.recentOoms.delete(id);
    }
  }

  private async handleEvent(event: DockerEvent): Promise<void> {
    const containerId = event.Actor.ID;
    const attrs = event.Actor.Attributes;
    const containerName = (attrs['name'] ?? '').replace(/^\//, '');

    switch (event.Action) {
      case 'oom':
        await this.handleOom(containerId, containerName, attrs);
        break;
      case 'die':
        await this.handleDie(containerId, containerName, attrs);
        break;
      case 'start':
        this.handleStart(containerId);
        break;
    }
  }

  private async handleOom(
    containerId: string,
    containerName: string,
    attrs: Record<string, string>,
  ): Promise<void> {
    this.recentOoms.set(containerId, Date.now());

    const projectId = this.resolveProjectId(attrs);
    if (!projectId) return;

    const project = this.db.getProject(projectId);
    if (!project || project.status !== 'running' || project.archived_at) return;

    await this.events.emit('container:oom', {
      projectId,
      containerId,
      containerName,
    });

    log.info({ projectId, containerId, containerName }, 'Container OOM detected');
  }

  private async handleDie(
    containerId: string,
    containerName: string,
    attrs: Record<string, string>,
  ): Promise<void> {
    const exitCode = parseInt(attrs['exitCode'] ?? '0', 10);


exec
/bin/bash -lc "sed -n '1,260p' src/web/api/terminal-routes.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import type { NodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import type { Duplex } from 'node:stream';

import type { AppContext } from '../../app.js';
import { AuthService } from '../../auth/auth-service.js';
import { createModuleLogger } from '../../lib/logger.js';
import { parseCookie } from '../middleware/cookies.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

const log = createModuleLogger('terminal');

type TerminalExec = {
  resize: (opts: { w: number; h: number }) => Promise<void>;
};

export function createTerminalRoutes(
  ctx: AppContext,
  upgradeWebSocket?: NodeWebSocket['upgradeWebSocket'],
): Hono {
  const api = new Hono();
  const authService = new AuthService(ctx.db);
  const sessions = new WeakMap<
    object,
    {
      stream: Duplex;
      exec: TerminalExec;
      projectId: string;
      idleTimer: NodeJS.Timeout;
      messageCount: number;
      rateResetTimer: ReturnType<typeof setInterval>;
    }
  >();

  const MAX_MESSAGE_BYTES = 4096;
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

  const closeWithError = (
    ws: { send: (data: string) => void; close: () => void },
    message: string,
  ): void => {
    ws.send(JSON.stringify({ type: 'error', message }));
    ws.close();
  };

  const clearSession = (ws: object): void => {
    const session = sessions.get(ws);
    if (!session) return;
    clearTimeout(session.idleTimer);
    clearInterval(session.rateResetTimer);
    session.stream.destroy();
    sessions.delete(ws);
  };

  const toBuffer = (data: unknown): Buffer | null => {
    if (typeof data === 'string') return Buffer.from(data, 'utf8');
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return null;
  };

  if (!upgradeWebSocket) return api;

  api.get(
    '/projects/:id/terminal',
    upgradeWebSocket((c) => {
      const id = c.req.param('id') ?? '';
      return {
        onOpen(_evt, ws) {
          void (async () => {
            try {
              // Auth check: validate session cookie
              if (authService.isPasswordSet()) {
                const cookieHeader = c.req.header('cookie');
                const sessionToken = parseCookie(cookieHeader, 'ol_session');
                if (!sessionToken || !authService.validateSession(sessionToken)) {
                  closeWithError(ws, 'Unauthorized');
                  return;
                }
              }

              const originHeader = c.req.header('origin');
              const hostHeader = c.req.header('host');
              const serverHost = ctx.config.server.host.trim().toLowerCase();
              const isLocalhostServer =
                serverHost === 'localhost' || serverHost === '127.0.0.1' || serverHost === '::1';

              if (!isLocalhostServer) {
                if (!originHeader || !hostHeader) {
                  closeWithError(ws, 'Forbidden');
                  return;
                }
                let originHost: string;
                try {
                  originHost = new URL(originHeader).host.toLowerCase();
                } catch (_err) {
                  closeWithError(ws, 'Forbidden');
                  return;
                }
                if (originHost !== hostHeader.toLowerCase()) {
                  closeWithError(ws, 'Forbidden');
                  return;
                }
              }

              const project = getProjectOrThrow(c, ctx);

              if (!project.container_id || project.status !== 'running') {
                closeWithError(ws, 'Container is not running');
                return;
              }

              const containerId = project.container_id;
              const containerInfo = await ctx.docker.inspectContainer(containerId);
              if (!containerInfo.State.Running) {
                closeWithError(ws, 'Container is not running');
                return;
              }

              const probeShell = async (shell: string): Promise<boolean> => {
                try {
                  const result = await ctx.docker.execSimple(containerId, [shell, '-c', 'exit 0']);
                  return result.exitCode === 0;
                } catch (_err) {
                  return false;
                }
              };

              const shellCmd = (await probeShell('/bin/bash'))
                ? '/bin/bash'
                : (await probeShell('/bin/sh'))
                  ? '/bin/sh'
                  : null;

              if (!shellCmd) {
                closeWithError(
                  ws,
                  'No shell available (/bin/bash and /bin/sh not found). This container may be a distroless image.',
                );
                return;
              }

              const terminal = await ctx.docker.execTerminal(containerId, [shellCmd]);
              const exec: TerminalExec = terminal;
              const stream = terminal.stream as unknown as Duplex;

              const idleTimer = setTimeout(() => {
                ws.send(JSON.stringify({ type: 'error', message: 'Terminal idle timeout (30m)' }));
                ws.close();
              }, IDLE_TIMEOUT_MS);

              const rateResetTimer = setInterval(() => {
                const s = sessions.get(ws);
                if (s) s.messageCount = 0;
              }, 1000);

              sessions.set(ws, {
                stream,
                exec,
                projectId: project.id,
                idleTimer,
                messageCount: 0,
                rateResetTimer,
              });

              log.info({ projectId: project.id }, 'Terminal session opened');

              stream.on('data', (data: Buffer) => {
                ws.send(new Uint8Array(data));
              });
              stream.on('error', () => {
                ws.close();
              });
              stream.on('close', () => {
                ws.close();
              });
            } catch (err) {
              log.debug({ err, projectId: id }, 'Failed to open terminal session');
              closeWithError(ws, 'Failed to open terminal session');
            }
          })();
        },
        onMessage(evt, ws) {
          const session = sessions.get(ws);
          if (!session) return;

          session.messageCount += 1;
          if (session.messageCount > 100) {
            closeWithError(ws, 'Rate limit exceeded');
            return;
          }

          const payload = toBuffer((evt as { data: unknown }).data);
          if (!payload) return;
          if (payload.byteLength > MAX_MESSAGE_BYTES) return;

          clearTimeout(session.idleTimer);
          session.idleTimer = setTimeout(() => {
            ws.send(JSON.stringify({ type: 'error', message: 'Terminal idle timeout (30m)' }));
            ws.close();
          }, IDLE_TIMEOUT_MS);

          const text = payload.toString('utf8');
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            if (parsed['type'] === 'resize') {
              const cols = parsed['cols'];
              const rows = parsed['rows'];
              if (typeof cols === 'number' && typeof rows === 'number') {
                void session.exec.resize({ w: cols, h: rows });
              }
              return;
            }
            if (parsed['type'] === 'input') {
              const input = parsed['data'];
              if (typeof input === 'string') session.stream.write(input);
              return;
            }
          } catch (err) {
            log.debug({ err, projectId: session.projectId }, 'Failed to parse WebSocket message');
            session.stream.write(payload);
            return;
          }
          session.stream.write(payload);
        },
        onClose(_evt, ws) {
          const session = sessions.get(ws);
          if (session) {
            log.info({ projectId: session.projectId }, 'Terminal session closed');
          }
          clearSession(ws);
        },
        onError(err, ws) {
          console.error('Terminal WebSocket error:', err);
          clearSession(ws);
        },
      };
    }),
  );

  return api;
}

exec
/bin/bash -lc "sed -n '1000,1085p' src/web/api/project-routes.ts" in /home/lee/OpenLander
 succeeded in 0ms:

  api.delete('/projects/:id/purge', async (c) => {
    const confirm = c.req.query('confirm');
    if (confirm !== 'true') {
      return c.json(
        { error: 'Confirmation required. Add ?confirm=true to permanently delete.' },
        400,
      );
    }
    const project = getProjectOrThrow(c, ctx);
    ctx.coordinator.suppressProject(project.id, 60_000);
    await ctx.pipeline.remove(project.id, ctx.cloudflare);
    return c.json({ success: true, message: 'Project permanently deleted' });
  });

  api.delete('/projects/:id', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    ctx.coordinator.suppressProject(project.id, 60_000);
    await ctx.pipeline.archive(project.id);
    return c.json({ status: 'archived', project: project.name });
  });

  api.get('/projects/:id/logs', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    const follow = c.req.query('follow');

    if (follow && project.container_id) {
      const containerId = project.container_id;
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        try {
          const logStream = await ctx.docker.getLogStream(containerId, { tail: 50 });

          logStream.on('data', (chunk: Buffer) => {
            const headerSize = 8;
            const streamType = chunk[0] === 1 ? 'stdout' : 'stderr';
            const line = chunk.subarray(headerSize).toString('utf8').trim();

            if (line) {
              const logEntry = {
                line,
                stream: streamType,
                time: new Date().toISOString(),
              };
              void s.write(JSON.stringify(logEntry) + '\n');
            }
          });

          logStream.on('end', () => {
            void s.close();
          });

          logStream.on('error', () => {
            void s.close();
          });

          s.onAbort(() => {
            // Stream will be cleaned up automatically on abort
          });
        } catch (err) {
          log.debug({ err, projectId: project.id }, 'Log streaming failed');
          void s.write(JSON.stringify({ error: 'Failed to stream logs' }) + '\n');
          void s.close();
        }
      });
    }

    const lines = parseInt(c.req.query('lines') ?? '50', 10);
    const logs = await ctx.pipeline.getLogs(project.id, lines);

    return c.json({ project: project.name, logs });
  });

  api.get('/projects/:id/env', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const vars = ctx.env.getAll(project.id);
    return c.json({ project: project.name, envVars: vars });
  });

  api.get('/projects/:id/env-example', async (c) => {
    const project = getProjectOrThrow(c, ctx);
    if (!project.repo_url) {

exec
/bin/bash -lc "rg -n \"describe\\('|describe\\(\" test/pipeline/docker-methods.test.ts && rg -n \"inspectImage|removeImage|getContainerStats|getDiskUsage|inspectVolume|listVolumes|createVolume|removeVolume|renameContainer|waitForContainer|runServiceContainer|execStream|getEventStream|getLogStream|ensureNetwork|execTerminal|listDanglingImages\" test/pipeline/docker-methods.test.ts" in /home/lee/OpenLander
 succeeded in 0ms:
83:describe('inspectContainer', () => {
129:describe('connectContainerToNetwork', () => {
197:describe('restartContainer', () => {
237:describe('execSimple', () => {
342:describe('getNetworkInfo', () => {
389:describe('inspectImage', () => {
422:describe('removeImage', () => {
451:describe('getContainerStats', () => {
487:describe('getDiskUsage', () => {
518:describe('inspectVolume', () => {
555:describe('listVolumes', () => {
586:describe('createVolume', () => {
628:describe('removeVolume', () => {
657:describe('renameContainer', () => {
688:describe('waitForContainer', () => {
718:describe('runServiceContainer', () => {
773:describe('execStream', () => {
814:describe('getEventStream', () => {
37:  this.listVolumes = mockListVolumes;
38:  this.createVolume = mockCreateVolume;
242:    const execStream = new PassThrough();
244:    const execStart = vi.fn().mockResolvedValueOnce(execStream);
261:    setTimeout(() => execStream.emit('end'), 5);
279:    const execStream = new PassThrough();
281:    const execStart = vi.fn().mockResolvedValueOnce(execStream);
297:    setTimeout(() => execStream.emit('end'), 5);
308:    const execStream = new PassThrough();
310:    const execStart = vi.fn().mockResolvedValueOnce(execStream);
327:    setTimeout(() => execStream.emit('end'), 5);
386:// Tests: inspectImage
389:describe('inspectImage', () => {
400:    const result = await docker.inspectImage('myapp:latest');
412:    await expect(docker.inspectImage('missing:latest')).rejects.toThrow(
419:// Tests: removeImage
422:describe('removeImage', () => {
431:    await expect(docker.removeImage('old:v1')).resolves.toBeUndefined();
443:    await expect(docker.removeImage('gone:v1')).resolves.toBeUndefined();
448:// Tests: getContainerStats
451:describe('getContainerStats', () => {
465:    const result = await docker.getContainerStats('c1');
477:    await expect(docker.getContainerStats('missing')).rejects.toMatchObject({
484:// Tests: getDiskUsage
487:describe('getDiskUsage', () => {
501:    const result = await docker.getDiskUsage();
510:    await expect(docker.getDiskUsage()).rejects.toThrow('daemon unavailable');
515:// Tests: inspectVolume
518:describe('inspectVolume', () => {
533:    const result = await docker.inspectVolume('my-vol');
545:    await expect(docker.inspectVolume('missing-vol')).rejects.toThrow(
552:// Tests: listVolumes
555:describe('listVolumes', () => {
567:    const result = await docker.listVolumes();
576:    const result = await docker.listVolumes();
583:// Tests: createVolume
586:describe('createVolume', () => {
594:    await docker.createVolume({ name: 'my-data', labels: { custom: 'value' } });
611:    await docker.createVolume({ name: 'plain-vol' });
625:// Tests: removeVolume
628:describe('removeVolume', () => {
637:    await expect(docker.removeVolume('my-vol')).resolves.toBeUndefined();
649:    await expect(docker.removeVolume('gone-vol')).resolves.toBeUndefined();
654:// Tests: renameContainer
657:describe('renameContainer', () => {
666:    await docker.renameContainer('c1', 'new-name');
678:    await expect(docker.renameContainer('missing', 'new-name')).rejects.toMatchObject({
685:// Tests: waitForContainer
688:describe('waitForContainer', () => {
697:    const result = await docker.waitForContainer('c1');
708:    const result = await docker.waitForContainer('crashed');
715:// Tests: runServiceContainer
718:describe('runServiceContainer', () => {
730:    const id = await docker.runServiceContainer({
758:      docker.runServiceContainer({
770:// Tests: execStream
773:describe('execStream', () => {
784:    const result = await docker.execStream('c1', ['/bin/bash']);
804:    await docker.execStream('c1', ['ls', '-la'], { tty: false });
811:// Tests: getEventStream
814:describe('getEventStream', () => {
824:    const result = await docker.getEventStream(filters);
834:    await expect(docker.getEventStream({ type: ['container'] })).rejects.toThrow(

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
      const containers = await this.docker.listAllContainers();
      return containers.some(
        (c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik' && c.state === 'running',
      );
    } catch (err) {
      log.warn({ err }, 'Failed to check Traefik running status');
      return false;
    }
  }

  private async hasCurrentConfig(): Promise<boolean> {
    try {
      const info = await this.docker.inspectContainer(this.containerName);
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
    const containers = await this.docker.listAllContainers();
    const running = containers.filter(
      (c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik' && c.state === 'running',
    );

    const candidate = running.find((c) => c.name !== this.containerName);

    if (!candidate) {
      return false;
    }

    log.info(
      { existingContainer: candidate.name, managedContainer: this.containerName },
      'Found legacy OpenLander Traefik — adopting',
    );

    const connected = await this.connectContainerToNetworkByName(
      candidate.name,
      SHARED_NETWORK_NAME,
    );
    if (!connected) {
      log.warn(
        'Failed to connect adopted Traefik to shared network — falling back to new container',
      );
      return false;
    }

    try {
      await this.docker.removeContainer(this.containerName);
      log.debug({ containerName: this.containerName }, 'Removed stale managed Traefik container');
    } catch {
      // Container doesn't exist — expected
    }

    return true;
  }

  private async ensureNetworkByName(name: string): Promise<void> {
    try {
      await this.docker.getNetworkInfo(name);
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('not found') && !isDockerNotFoundError(error)) {
        throw error;
      }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- TODO: createNetwork not yet in docker.ts wrapper (PR3 deferred)
      const client = (this.docker as any).getClient();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- PR3 deferred
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

    try {
      const existing = await this.docker.listAllContainers();
      const traefikContainers = existing.filter((c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik');
      for (const c of traefikContainers) {
        await this.docker.removeContainer(c.id);
      }
      if (traefikContainers.length > 0) {
        log.debug(
          `Removed ${traefikContainers.length.toString()} existing Traefik container(s) before recreation`,
        );
      }
    } catch (_err) {
      // Container doesn't exist — expected on first run
    }

    try {
      await this.docker.pullImage(TRAEFIK_IMAGE);
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

exec
/bin/bash -lc "git show 217a28c:src/pipeline/traefik.ts | sed -n '1,240p'" in /home/lee/OpenLander
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

exec
/bin/bash -lc "sed -n '920,990p' src/pipeline/deploy-core.ts" in /home/lee/OpenLander
 succeeded in 0ms:
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg, buildLogTail);
      return {
        success: false,
        projectId,
        projectName,
        error: errorMsg,
        buildLogTail,
        buildDurationMs: Date.now() - startTime,
      };
    } finally {
      if (clonePath) {
        try {
          const { rmSync } = await import('node:fs');
          rmSync(clonePath, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  private async markRollbackImage(imageTag: string): Promise<void> {
    const [repo, tag] = imageTag.split(':');
    if (!repo || !tag) {
      return;
    }

    const dockerWithClient = this.docker as unknown as {
      getClient?: () => {
        createContainer: (opts: {
          Image: string;
          Labels?: Record<string, string>;
          Cmd?: string[];
        }) => Promise<{
          id: string;
          commit: (opts: { repo: string; tag: string; changes?: string[] }) => Promise<unknown>;
          remove: (opts: { force: boolean }) => Promise<void>;
        }>;
      };
    };

    const getClient = dockerWithClient.getClient;
    if (typeof getClient !== 'function') {
      return;
    }

    const client = getClient();

    const temp = await client.createContainer({
      Image: imageTag,
      Labels: { 'ol.rollback': 'true' },
      Cmd: ['true'],
    });

    try {
      await temp.commit({
        repo,
        tag,
        changes: ['LABEL ol.rollback=true'],
      });
    } finally {
      try {
        await temp.remove({ force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  private createOrchestrationDeps(): DeployOrchestrationDeps {
    return {

exec
/bin/bash -lc "git show 217a28c:src/pipeline/deploy-core.ts | sed -n '920,990p'" in /home/lee/OpenLander
 succeeded in 0ms:
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg, buildLogTail);
      return {
        success: false,
        projectId,
        projectName,
        error: errorMsg,
        buildLogTail,
        buildDurationMs: Date.now() - startTime,
      };
    } finally {
      if (clonePath) {
        try {
          const { rmSync } = await import('node:fs');
          rmSync(clonePath, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  private async markRollbackImage(imageTag: string): Promise<void> {
    const dockerWithClient = this.docker as unknown as {
      getClient?: () => {
        createContainer: (opts: {
          Image: string;
          Labels?: Record<string, string>;
          Cmd?: string[];
        }) => Promise<{
          id: string;
          commit: (opts: { repo: string; tag: string; changes?: string[] }) => Promise<unknown>;
          remove: (opts: { force: boolean }) => Promise<void>;
        }>;
      };
    };
    const getClient = dockerWithClient.getClient;
    if (typeof getClient !== 'function') {
      return;
    }
    const client = getClient();

    const [repo, tag] = imageTag.split(':');
    if (!repo || !tag) {
      return;
    }

    const temp = await client.createContainer({
      Image: imageTag,
      Labels: { 'ol.rollback': 'true' },
      Cmd: ['true'],
    });

    try {
      await temp.commit({
        repo,
        tag,
        changes: ['LABEL ol.rollback=true'],
      });
    } finally {
      try {
        await temp.remove({ force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  private createOrchestrationDeps(): DeployOrchestrationDeps {
    return {
      docker: this.docker,
      db: this.db,

codex
I’ve got enough context to start calling out concrete risks. Before I write findings, I’m running the focused Docker-method test file once to see whether the added coverage at least passes as written and whether there are obvious blind spots around the untested wrappers.
exec
/bin/bash -lc 'npx vitest run test/pipeline/docker-methods.test.ts' in /home/lee/OpenLander
 succeeded in 526ms:

 RUN  v4.1.0 /home/lee/OpenLander


 Test Files  1 passed (1)
      Tests  43 passed (43)
   Start at  11:32:16
   Duration  201ms (transform 69ms, setup 17ms, import 79ms, tests 34ms, environment 0ms)


exec
/bin/bash -lc "rg -n \"markRollbackImage\\(|ol\\.rollback|rollback image\" src/pipeline/deploy-core.ts src/pipeline -g'*.ts'" in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/deploy-core.ts:729:          await this.markRollbackImage(previousTag);
src/pipeline/deploy-core.ts:941:  private async markRollbackImage(imageTag: string): Promise<void> {
src/pipeline/deploy-core.ts:970:      Labels: { 'ol.rollback': 'true' },
src/pipeline/deploy-core.ts:978:        changes: ['LABEL ol.rollback=true'],
src/pipeline/deploy-core.ts:729:          await this.markRollbackImage(previousTag);
src/pipeline/deploy-core.ts:941:  private async markRollbackImage(imageTag: string): Promise<void> {
src/pipeline/deploy-core.ts:970:      Labels: { 'ol.rollback': 'true' },
src/pipeline/deploy-core.ts:978:        changes: ['LABEL ol.rollback=true'],

exec
/bin/bash -lc "git show 217a28c:src/web/api/project-routes.ts | sed -n '1018,1075p'" in /home/lee/OpenLander
 succeeded in 0ms:
  api.get('/projects/:id/logs', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    const follow = c.req.query('follow');

    if (follow && project.container_id) {
      const containerId = project.container_id;
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        try {
          const container = ctx.docker.getClient().getContainer(containerId);
          const logStream = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: 50,
          });

          logStream.on('data', (chunk: Buffer) => {
            const headerSize = 8;
            const streamType = chunk[0] === 1 ? 'stdout' : 'stderr';
            const line = chunk.subarray(headerSize).toString('utf8').trim();

            if (line) {
              const logEntry = {
                line,
                stream: streamType,
                time: new Date().toISOString(),
              };
              void s.write(JSON.stringify(logEntry) + '\n');
            }
          });

          logStream.on('end', () => {
            void s.close();
          });

          logStream.on('error', () => {
            void s.close();
          });

          s.onAbort(() => {
            // Stream will be cleaned up automatically on abort
          });
        } catch (err) {
          log.debug({ err, projectId: project.id }, 'Log streaming failed');
          void s.write(JSON.stringify({ error: 'Failed to stream logs' }) + '\n');
          void s.close();
        }
      });
    }

    const lines = parseInt(c.req.query('lines') ?? '50', 10);
    const logs = await ctx.pipeline.getLogs(project.id, lines);

    return c.json({ project: project.name, logs });
  });

exec
/bin/bash -lc "rg -n \"ol\\.rollback|rollback.*label|listImages|rollback image|rollback\" src test | head -n 80" in /home/lee/OpenLander
 succeeded in 0ms:
test/setup-llm-routes.test.ts:126:      rollbackSuggestion: { enabled: true },
test/config/ai-features.test.ts:48:  rollbackSuggestion: { enabled: true },
test/config/ai-features.test.ts:59:  'rollbackSuggestion',
test/config/ai-features.test.ts:92:    expect(ai.rollbackSuggestion.enabled).toBe(true);
test/web-routes.test.ts:816:  // POST /api/projects/:id/rollback
test/web-routes.test.ts:819:  it('POST /api/projects/:id/rollback rolls back to previous image', async () => {
test/web-routes.test.ts:822:    const res = await app.request('/api/projects/p1/rollback', { method: 'POST' });
test/web-routes.test.ts:827:    expect(ctx.pipeline.rollback).toHaveBeenCalledWith('p1');
test/web-routes.test.ts:830:  it('POST /api/projects/:id/rollback returns 404 for unknown project', async () => {
test/web-routes.test.ts:831:    const res = await app.request('/api/projects/nonexistent/rollback', { method: 'POST' });
test/web-routes.test.ts:835:  it('POST /api/projects/:id/rollback returns 500 on failure', async () => {
test/web-routes.test.ts:837:    (ctx.pipeline.rollback as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
test/web-routes.test.ts:842:    const res = await app.request('/api/projects/p1/rollback', { method: 'POST' });
test/web-routes.test.ts:1793:    db.updateActionRunApproval(activePendingId, 'pending', 'rollback');
test/web-routes.test.ts:1801:    db.updateActionRunApproval(stalePendingId, 'pending', 'rollback');
test/orchestrator.test.ts:121:      rollbackService: async () => {},
test/orchestrator.test.ts:131:  it('executeOrdered performs atomic rollback when a later service fails', async () => {
test/orchestrator.test.ts:144:    const rollbackSpy = vi
test/orchestrator.test.ts:145:      .fn<OrchestrationPipeline['rollbackService']>()
test/orchestrator.test.ts:154:      rollbackService: rollbackSpy,
test/orchestrator.test.ts:160:    expect(rollbackSpy).toHaveBeenCalledOnce();
test/orchestrator.test.ts:161:    expect(rollbackSpy).toHaveBeenCalledWith({
test/orchestrator.test.ts:178:      rollbackService: async () => {},
src/pipeline/auto-recovery.ts:32:  rollback_project: 'rollback',
src/pipeline/auto-recovery.ts:33:  remove_project: 'rollback',
src/pipeline/auto-recovery.ts:34:  platform_force_remove: 'rollback',
src/pipeline/auto-recovery.ts:35:  remove_service: 'rollback',
src/pipeline/auto-recovery.ts:81:  handleRollbackSuggested(payload: EventPayload['rollback:suggested']): Promise<void>;
src/pipeline/auto-recovery.ts:872:  function handleRollbackSuggested(payload: EventPayload['rollback:suggested']): Promise<void> {
src/pipeline/auto-recovery.ts:873:    if (!config.ai.rollbackSuggestion.enabled) return Promise.resolve();
src/pipeline/auto-recovery.ts:877:        category: 'rollback_suggested',
src/pipeline/auto-recovery.ts:882:            label: `Review rollback to previous image ${payload.previousImageTag}`,
src/pipeline/auto-recovery.ts:888:    const message = `Health checks are failing for ${payload.projectName} after deployment. ${String(payload.consecutiveFailures)} consecutive failures. Previous version available (${payload.previousImageTag}). Ask the user if they want to rollback.`;
src/pipeline/auto-recovery.ts:899:          `rollback-${payload.projectId}`,
src/pipeline/auto-recovery.ts:903:      { projectId: payload.projectId, eventType: 'rollback:suggested' },
test/pipeline/approval-gate.test.ts:13:    toolName: 'rollback_project',
test/pipeline/approval-gate.test.ts:103:      toolName: 'rollback_project',
test/pipeline/approval-gate.test.ts:121:    ).toBe('rollback_project');
test/helpers/web-route-mocks.ts:48:    rollback: vi.fn().mockResolvedValue({ success: true }),
test/tool-registry.test.ts:26:  'rollback_project',
test/pipeline/event-golden.test.ts:46:  'deploy:rollback',
test/pipeline/event-golden.test.ts:224:  it('captures rollback event sequence and payload shapes', async () => {
test/pipeline/event-golden.test.ts:228:      id: 'rollback-project',
test/pipeline/event-golden.test.ts:229:      name: 'rollback-app',
test/pipeline/event-golden.test.ts:230:      repoUrl: 'https://github.com/openlander/rollback-app',
test/pipeline/event-golden.test.ts:233:    db.updateProject('rollback-project', {
test/pipeline/event-golden.test.ts:236:      imageTag: 'openlander/rollback-app:v2',
test/pipeline/event-golden.test.ts:237:      previousImageTag: 'openlander/rollback-app:v1',
test/pipeline/event-golden.test.ts:241:      const result = await pipeline.rollback('rollback-project');
test/pipeline/event-golden.test.ts:245:    expect(eventTypes(events)).toEqual(['deploy:rollback']);
test/llm/agent-decision.test.ts:87:    rollback_project: { execute: toolExecuteMock },
test/llm/agent-decision.test.ts:149:    scenario.toolName = 'rollback_project';
test/llm/agent-decision.test.ts:168:      'rollback now',
test/llm/agent-decision.test.ts:181:    scenario.toolName = 'rollback_project';
test/llm/agent-decision.test.ts:200:      'rollback now',
test/llm/agent-decision.test.ts:213:        event.toolName === 'rollback_project' &&
test/llm/decision.test.ts:19:  it('rollback_project → REQUIRE_APPROVAL', () => {
test/llm/decision.test.ts:20:    expect(engine.classify('rollback_project')).toBe('REQUIRE_APPROVAL');
src/pipeline/compose.ts:844:        rollbackService: async (service) => {
src/pipeline/compose.ts:1015:              'Failed to stop compose service during rollback',
src/pipeline/compose.ts:1024:            'Failed to remove compose service container during rollback',
test/pipeline/__snapshots__/event-golden.test.ts.snap:214:exports[`pipeline event golden snapshots > captures rollback event sequence and payload shapes 1`] = `
test/pipeline/__snapshots__/event-golden.test.ts.snap:222:    "type": "deploy:rollback",
test/pipeline/__snapshots__/event-golden.test.ts.snap:318:  "deploy:rollback",
src/pipeline/docker.ts:1158:    return await this.client.listImages({ filters: { dangling: ['true'] } });
test/pipeline/readiness-gate.test.ts:32:      rollbackService: vi.fn().mockResolvedValue(undefined),
test/pipeline/readiness-gate.test.ts:66:      rollbackService: vi.fn().mockResolvedValue(undefined),
test/deploy-controls.test.ts:115:  it('rollback for environment returns error when previous image is unavailable', async () => {
test/deploy-controls.test.ts:129:    const result = await pipeline.rollback('p2', 'p2-development');
test/deploy-controls.test.ts:132:    expect(result.error).toBe('No previous image available for rollback');
test/deploy-controls.test.ts:135:  it('rollback for environment starts previous image and swaps image tags', async () => {
test/deploy-controls.test.ts:154:    const result = await pipeline.rollback('p3', 'p3-development');
test/deploy-controls.test.ts:178:  it('rollback marks project as error when restart with previous image fails', async () => {
test/deploy-controls.test.ts:194:    const result = await pipeline.rollback('p4');
test/deploy-controls.test.ts:474:  it('rollback returns not found when project does not exist', async () => {
test/deploy-controls.test.ts:475:    const result = await pipeline.rollback('missing-project');
test/deploy-controls.test.ts:481:  it('rollback for project returns error when previous image is unavailable', async () => {
test/deploy-controls.test.ts:489:    const result = await pipeline.rollback('p13');
test/deploy-controls.test.ts:492:    expect(result.error).toBe('No previous image available for rollback');
test/deploy-controls.test.ts:495:  it('rollback for environment returns error when environment does not exist', async () => {

exec
/bin/bash -lc "rg -n \"getClient\\(\" ." in /home/lee/OpenLander
 succeeded in 0ms:
./src/pipeline/deploy-core.ts:966:    const client = getClient();
./AGENTS.md:250:`src/pipeline/docker.ts` is the **single entry point** for all Docker operations. All new code MUST use docker.ts methods, never raw `getClient()` calls.
./AGENTS.md:260:**Status**: `getClient()` has been removed. The only remaining callers are in PR3-deferred special cases (traefik.ts createNetwork, deploy-core.ts markRollbackImage), which will be migrated in a future PR.

exec
/bin/bash -lc "nl -ba src/pipeline/traefik.ts | sed -n '139,170p'" in /home/lee/OpenLander
exec
/bin/bash -lc "nl -ba src/pipeline/deploy-core.ts | sed -n '941,979p'" in /home/lee/OpenLander
 succeeded in 0ms:
   139	      await this.docker.removeContainer(this.containerName);
   140	      log.debug({ containerName: this.containerName }, 'Removed stale managed Traefik container');
   141	    } catch {
   142	      // Container doesn't exist — expected
   143	    }
   144
   145	    return true;
   146	  }
   147
   148	  private async ensureNetworkByName(name: string): Promise<void> {
   149	    try {
   150	      await this.docker.getNetworkInfo(name);
   151	      return;
   152	    } catch (error) {
   153	      const msg = error instanceof Error ? error.message : String(error);
   154	      if (!msg.includes('not found') && !isDockerNotFoundError(error)) {
   155	        throw error;
   156	      }
   157	    }
   158
   159	    try {
   160	      await this.docker.ensureNetwork(name);
   161	    } catch (error) {
   162	      const msg = error instanceof Error ? error.message : String(error);
   163	      if (msg.includes('already exists')) {
   164	        return;
   165	      }
   166	      throw error;
   167	    }
   168	  }
   169
   170	  async start(): Promise<void> {

 succeeded in 0ms:
   941	  private async markRollbackImage(imageTag: string): Promise<void> {
   942	    const [repo, tag] = imageTag.split(':');
   943	    if (!repo || !tag) {
   944	      return;
   945	    }
   946
   947	    try {
   948	      await this.docker.commitImage({
   949	        sourceImage: imageTag,
   950	        repo,
   951	        tag,
   952	        labels: { 'ol.rollback': 'true' },
   953	        changes: ['LABEL ol.rollback=true'],
   954	      });
   955	    } catch (error) {
   956	      log.warn({ error, imageTag }, 'Failed to mark rollback image — proceeding anyway');
   957	    }
   958	  }
   959
   960	  private createOrchestrationDeps(): DeployOrchestrationDeps {
   961	    return {
   962	      docker: this.docker,
   963	      db: this.db,
   964	      env: this.env,
   965	      buildExecutor: this.buildExecutor,
   966	      containerRunner: this.containerRunner,
   967	      composePipeline: this.composePipeline,
   968	      autoDetector: this.autoDetector,
   969	      jobManager: this.jobManager,
   970	      applyPendingFix: (projectId: string, clonePath: string) =>
   971	        this.applyPendingFix(projectId, clonePath),
   972	      exposeTunnel: (projectId: string, port: number) => this.exposeTunnel(projectId, port),
   973	      secretScanEnabled: this.config.ai.secretScan.enabled,
   974	    };
   975	  }
   976
   977	  private createMonorepoDeps(): MonorepoOrchestrationDeps {
   978	    return {
   979	      docker: this.docker,

exec
/bin/bash -lc "nl -ba src/pipeline/docker.ts | sed -n '1284,1372p'" in /home/lee/OpenLander
 succeeded in 0ms:
  1284	  async runServiceContainer(opts: {
  1285	    imageTag: string;
  1286	    name: string;
  1287	    port: number;
  1288	    containerPort?: number;
  1289	    hostPort?: number;
  1290	    envVars: Record<string, string>;
  1291	    serviceName: string;
  1292	    volumeBinds?: string[];
  1293	    healthcheck?: {
  1294	      test: string[];
  1295	      interval: number;
  1296	      timeout: number;
  1297	      retries: number;
  1298	      startPeriod: number;
  1299	    };
  1300	    cmd?: string[];
  1301	  }): Promise<string> {
  1302	    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
  1303	    const containerPort = opts.containerPort ?? opts.port;
  1304	    const hostPort = opts.hostPort ?? opts.port;
  1305	    const networkingConfig = {
  1306	      EndpointsConfig: {
  1307	        [SHARED_NETWORK_NAME]: { Aliases: [opts.serviceName] },
  1308	      },
  1309	    };
  1310
  1311	    const container = await this.client.createContainer({
  1312	      Image: opts.imageTag,
  1313	      name: opts.name,
  1314	      Env: envArray,
  1315	      ...(opts.cmd ? { Cmd: opts.cmd } : {}),
  1316	      ...(opts.healthcheck
  1317	        ? {
  1318	            Healthcheck: {
  1319	              Test: opts.healthcheck.test,
  1320	              Interval: opts.healthcheck.interval * 1_000_000_000,
  1321	              Timeout: opts.healthcheck.timeout * 1_000_000_000,
  1322	              Retries: opts.healthcheck.retries,
  1323	              StartPeriod: opts.healthcheck.startPeriod * 1_000_000_000,
  1324	            },
  1325	          }
  1326	        : {}),
  1327	      Labels: {
  1328	        [DOCKER_LABELS.MANAGED]: 'true',
  1329	        [DOCKER_LABELS.ROLE]: 'service',
  1330	        [DOCKER_LABELS.SERVICE]: opts.serviceName,
  1331	      },
  1332	      ExposedPorts: { [`${String(containerPort)}/tcp`]: {} },
  1333	      NetworkingConfig: networkingConfig,
  1334	      HostConfig: {
  1335	        NetworkMode: this.networkName,
  1336	        RestartPolicy: { Name: 'unless-stopped' },
  1337	        Binds: opts.volumeBinds ?? [],
  1338	        PortBindings: {
  1339	          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
  1340	        },
  1341	        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
  1342	      },
  1343	    });
  1344
  1345	    await container.start();
  1346	    return container.id;
  1347	  }
  1348
  1349	  /** Open an interactive TTY exec stream for WebSocket bridging. Returns duplex stream. */
  1350	  async execStream(
  1351	    containerId: string,
  1352	    cmd: string[],
  1353	    opts?: { tty?: boolean },
  1354	  ): Promise<NodeJS.ReadWriteStream> {
  1355	    const container = this.client.getContainer(containerId);
  1356	    const exec = await container.exec({
  1357	      Cmd: cmd,
  1358	      AttachStdin: true,
  1359	      AttachStdout: true,
  1360	      AttachStderr: true,
  1361	      Tty: opts?.tty ?? true,
  1362	    });
  1363	    return (await exec.start({ hijack: true, stdin: true })) as unknown as NodeJS.ReadWriteStream;
  1364	  }
  1365
  1366	  /** Get Docker daemon event stream for real-time container events. */
  1367	  async getEventStream(filters: Record<string, string[]>): Promise<NodeJS.ReadableStream> {
  1368	    return await (
  1369	      this.client.getEvents as (opts: {
  1370	        filters: Record<string, string[]>;
  1371	      }) => Promise<NodeJS.ReadableStream>
  1372	    )({

exec
/bin/bash -lc "nl -ba test/pipeline/docker-methods.test.ts | sed -n '715,840p'" in /home/lee/OpenLander
 succeeded in 0ms:
   715	// Tests: runServiceContainer
   716	// ---------------------------------------------------------------------------
   717
   718	describe('runServiceContainer', () => {
   719	  beforeEach(resetMocks);
   720	  afterEach(() => vi.restoreAllMocks());
   721
   722	  it('creates and starts a service container, returns container id', async () => {
   723	    const containerHandle = {
   724	      id: 'svc-container-id',
   725	      start: vi.fn().mockResolvedValueOnce(undefined),
   726	    };
   727	    mockCreateContainer.mockResolvedValueOnce(containerHandle);
   728
   729	    const docker = new Docker();
   730	    const id = await docker.runServiceContainer({
   731	      imageTag: 'postgres:15',
   732	      name: 'ol-svc-postgres',
   733	      port: 5432,
   734	      envVars: { POSTGRES_PASSWORD: 'secret' },
   735	      serviceName: 'postgres',
   736	    });
   737
   738	    expect(id).toBe('svc-container-id');
   739	    expect(containerHandle.start).toHaveBeenCalledTimes(1);
   740	    expect(mockCreateContainer).toHaveBeenCalledWith(
   741	      expect.objectContaining({
   742	        Image: 'postgres:15',
   743	        name: 'ol-svc-postgres',
   744	        Labels: expect.objectContaining({
   745	          'openlander.managed': 'true',
   746	          'openlander.role': 'service',
   747	          'openlander.service': 'postgres',
   748	        }),
   749	      }),
   750	    );
   751	  });
   752
   753	  it('propagates errors from createContainer', async () => {
   754	    mockCreateContainer.mockRejectedValueOnce(new Error('image not found'));
   755
   756	    const docker = new Docker();
   757	    await expect(
   758	      docker.runServiceContainer({
   759	        imageTag: 'bad:image',
   760	        name: 'ol-svc-bad',
   761	        port: 5432,
   762	        envVars: {},
   763	        serviceName: 'bad',
   764	      }),
   765	    ).rejects.toThrow('image not found');
   766	  });
   767	});
   768
   769	// ---------------------------------------------------------------------------
   770	// Tests: execStream
   771	// ---------------------------------------------------------------------------
   772
   773	describe('execStream', () => {
   774	  beforeEach(resetMocks);
   775	  afterEach(() => vi.restoreAllMocks());
   776
   777	  it('returns a readable/writable stream with default tty=true', async () => {
   778	    const mockStream = new PassThrough();
   779	    const execStart = vi.fn().mockResolvedValueOnce(mockStream);
   780	    const containerExec = vi.fn().mockResolvedValueOnce({ start: execStart });
   781	    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
   782
   783	    const docker = new Docker();
   784	    const result = await docker.execStream('c1', ['/bin/bash']);
   785
   786	    expect(result).toBe(mockStream);
   787	    expect(containerExec).toHaveBeenCalledWith({
   788	      Cmd: ['/bin/bash'],
   789	      AttachStdin: true,
   790	      AttachStdout: true,
   791	      AttachStderr: true,
   792	      Tty: true,
   793	    });
   794	    expect(execStart).toHaveBeenCalledWith({ hijack: true, stdin: true });
   795	  });
   796
   797	  it('respects tty option when set to false', async () => {
   798	    const mockStream = new PassThrough();
   799	    const execStart = vi.fn().mockResolvedValueOnce(mockStream);
   800	    const containerExec = vi.fn().mockResolvedValueOnce({ start: execStart });
   801	    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
   802
   803	    const docker = new Docker();
   804	    await docker.execStream('c1', ['ls', '-la'], { tty: false });
   805
   806	    expect(containerExec).toHaveBeenCalledWith(expect.objectContaining({ Tty: false }));
   807	  });
   808	});
   809
   810	// ---------------------------------------------------------------------------
   811	// Tests: getEventStream
   812	// ---------------------------------------------------------------------------
   813
   814	describe('getEventStream', () => {
   815	  beforeEach(resetMocks);
   816	  afterEach(() => vi.restoreAllMocks());
   817
   818	  it('returns event stream with filters applied', async () => {
   819	    const mockStream = new PassThrough();
   820	    mockGetEvents.mockResolvedValueOnce(mockStream);
   821
   822	    const docker = new Docker();
   823	    const filters = { type: ['container'], event: ['start', 'die'] };
   824	    const result = await docker.getEventStream(filters);
   825
   826	    expect(result).toBe(mockStream);
   827	    expect(mockGetEvents).toHaveBeenCalledWith({ filters });
   828	  });
   829
   830	  it('propagates errors from Docker daemon', async () => {
   831	    mockGetEvents.mockRejectedValueOnce(new Error('connection refused'));
   832
   833	    const docker = new Docker();
   834	    await expect(docker.getEventStream({ type: ['container'] })).rejects.toThrow(
   835	      'connection refused',
   836	    );
   837	  });
   838	});

exec
/bin/bash -lc "sed -n '941,979p' src/pipeline/deploy-core.ts" in /home/lee/OpenLander
 succeeded in 0ms:
  private async markRollbackImage(imageTag: string): Promise<void> {
    const [repo, tag] = imageTag.split(':');
    if (!repo || !tag) {
      return;
    }

    try {
      await this.docker.commitImage({
        sourceImage: imageTag,
        repo,
        tag,
        labels: { 'ol.rollback': 'true' },
        changes: ['LABEL ol.rollback=true'],
      });
    } catch (error) {
      log.warn({ error, imageTag }, 'Failed to mark rollback image — proceeding anyway');
    }
  }

  private createOrchestrationDeps(): DeployOrchestrationDeps {
    return {
      docker: this.docker,
      db: this.db,
      env: this.env,
      buildExecutor: this.buildExecutor,
      containerRunner: this.containerRunner,
      composePipeline: this.composePipeline,
      autoDetector: this.autoDetector,
      jobManager: this.jobManager,
      applyPendingFix: (projectId: string, clonePath: string) =>
        this.applyPendingFix(projectId, clonePath),
      exposeTunnel: (projectId: string, port: number) => this.exposeTunnel(projectId, port),
      secretScanEnabled: this.config.ai.secretScan.enabled,
    };
  }

  private createMonorepoDeps(): MonorepoOrchestrationDeps {
    return {
      docker: this.docker,

codex
The workspace has local changes beyond `995ab0b`, so I’m switching to `git show 995ab0b:...` for line-accurate review against the PR itself. That matters here because at least one of the risky spots already appears to be patched locally but is still broken in the reviewed commit range.
exec
/bin/bash -lc "git show 995ab0b:src/pipeline/traefik.ts | nl -ba | sed -n '148,170p'" in /home/lee/OpenLander
 succeeded in 0ms:
   148	  private async ensureNetworkByName(name: string): Promise<void> {
   149	    try {
   150	      await this.docker.getNetworkInfo(name);
   151	      return;
   152	    } catch (error) {
   153	      const msg = error instanceof Error ? error.message : String(error);
   154	      if (!msg.includes('not found') && !isDockerNotFoundError(error)) {
   155	        throw error;
   156	      }
   157	    }
   158
   159	    try {
   160	      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- TODO: createNetwork not yet in docker.ts wrapper (PR3 deferred)
   161	      const client = (this.docker as any).getClient();
   162	      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- PR3 deferred
   163	      await client.createNetwork({
   164	        Name: name,
   165	        Driver: 'bridge',
   166	      });
   167	    } catch (error) {
   168	      const msg = error instanceof Error ? error.message : String(error);
   169	      if (msg.includes('already exists')) {
   170	        return;

exec
/bin/bash -lc "git show 995ab0b:src/pipeline/deploy-core.ts | nl -ba | sed -n '941,985p'" in /home/lee/OpenLander
 succeeded in 0ms:
   941	  private async markRollbackImage(imageTag: string): Promise<void> {
   942	    const [repo, tag] = imageTag.split(':');
   943	    if (!repo || !tag) {
   944	      return;
   945	    }
   946
   947	    const dockerWithClient = this.docker as unknown as {
   948	      getClient?: () => {
   949	        createContainer: (opts: {
   950	          Image: string;
   951	          Labels?: Record<string, string>;
   952	          Cmd?: string[];
   953	        }) => Promise<{
   954	          id: string;
   955	          commit: (opts: { repo: string; tag: string; changes?: string[] }) => Promise<unknown>;
   956	          remove: (opts: { force: boolean }) => Promise<void>;
   957	        }>;
   958	      };
   959	    };
   960
   961	    const getClient = dockerWithClient.getClient;
   962	    if (typeof getClient !== 'function') {
   963	      return;
   964	    }
   965
   966	    const client = getClient();
   967
   968	    const temp = await client.createContainer({
   969	      Image: imageTag,
   970	      Labels: { 'ol.rollback': 'true' },
   971	      Cmd: ['true'],
   972	    });
   973
   974	    try {
   975	      await temp.commit({
   976	        repo,
   977	        tag,
   978	        changes: ['LABEL ol.rollback=true'],
   979	      });
   980	    } finally {
   981	      try {
   982	        await temp.remove({ force: true });
   983	      } catch {
   984	        // best-effort cleanup
   985	      }

exec
/bin/bash -lc "git show 995ab0b:src/pipeline/docker.ts | nl -ba | sed -n '1284,1418p'" in /home/lee/OpenLander
 succeeded in 0ms:
  1284	      EndpointsConfig: {
  1285	        [SHARED_NETWORK_NAME]: { Aliases: [opts.serviceName] },
  1286	      },
  1287	    };
  1288
  1289	    const container = await this.client.createContainer({
  1290	      Image: opts.imageTag,
  1291	      name: opts.name,
  1292	      Env: envArray,
  1293	      ...(opts.cmd ? { Cmd: opts.cmd } : {}),
  1294	      ...(opts.healthcheck
  1295	        ? {
  1296	            Healthcheck: {
  1297	              Test: opts.healthcheck.test,
  1298	              Interval: opts.healthcheck.interval * 1_000_000_000,
  1299	              Timeout: opts.healthcheck.timeout * 1_000_000_000,
  1300	              Retries: opts.healthcheck.retries,
  1301	              StartPeriod: opts.healthcheck.startPeriod * 1_000_000_000,
  1302	            },
  1303	          }
  1304	        : {}),
  1305	      Labels: {
  1306	        [DOCKER_LABELS.MANAGED]: 'true',
  1307	        [DOCKER_LABELS.ROLE]: 'service',
  1308	        [DOCKER_LABELS.SERVICE]: opts.serviceName,
  1309	      },
  1310	      ExposedPorts: { [`${String(containerPort)}/tcp`]: {} },
  1311	      NetworkingConfig: networkingConfig,
  1312	      HostConfig: {
  1313	        NetworkMode: this.networkName,
  1314	        RestartPolicy: { Name: 'unless-stopped' },
  1315	        Binds: opts.volumeBinds ?? [],
  1316	        PortBindings: {
  1317	          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
  1318	        },
  1319	        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
  1320	      },
  1321	    });
  1322
  1323	    await container.start();
  1324	    return container.id;
  1325	  }
  1326
  1327	  /** Open an interactive TTY exec stream for WebSocket bridging. Returns duplex stream. */
  1328	  async execStream(
  1329	    containerId: string,
  1330	    cmd: string[],
  1331	    opts?: { tty?: boolean },
  1332	  ): Promise<NodeJS.ReadWriteStream> {
  1333	    const container = this.client.getContainer(containerId);
  1334	    const exec = await container.exec({
  1335	      Cmd: cmd,
  1336	      AttachStdin: true,
  1337	      AttachStdout: true,
  1338	      AttachStderr: true,
  1339	      Tty: opts?.tty ?? true,
  1340	    });
  1341	    return (await exec.start({ hijack: true, stdin: true })) as unknown as NodeJS.ReadWriteStream;
  1342	  }
  1343
  1344	  /** Get Docker daemon event stream for real-time container events. */
  1345	  async getEventStream(filters: Record<string, string[]>): Promise<NodeJS.ReadableStream> {
  1346	    return await (
  1347	      this.client.getEvents as (opts: {
  1348	        filters: Record<string, string[]>;
  1349	      }) => Promise<NodeJS.ReadableStream>
  1350	    )({
  1351	      filters,
  1352	    });
  1353	  }
  1354
  1355	  getNetworkName(): string {
  1356	    return this.networkName;
  1357	  }
  1358
  1359	  /** Ensure a Docker network exists, creating it if missing. Returns the network name. */
  1360	  async ensureNetwork(name: string): Promise<string> {
  1361	    try {
  1362	      await this.client.getNetwork(name).inspect();
  1363	      return name;
  1364	    } catch (error) {
  1365	      if (!isDockerNotFoundError(error)) {
  1366	        throw error;
  1367	      }
  1368	    }
  1369	    try {
  1370	      await this.client.createNetwork({ Name: name, Driver: 'bridge' });
  1371	      return name;
  1372	    } catch (error) {
  1373	      const msg = error instanceof Error ? error.message : String(error);
  1374	      if (msg.includes('already exists')) {
  1375	        return name;
  1376	      }
  1377	      throw error;
  1378	    }
  1379	  }
  1380
  1381	  /** Follow container logs as a readable stream for real-time log tailing. */
  1382	  async getLogStream(
  1383	    containerId: string,
  1384	    opts?: { tail?: number; stdout?: boolean; stderr?: boolean },
  1385	  ): Promise<NodeJS.ReadableStream> {
  1386	    const container = this.client.getContainer(containerId);
  1387	    return (await container.logs({
  1388	      follow: true,
  1389	      stdout: opts?.stdout ?? true,
  1390	      stderr: opts?.stderr ?? true,
  1391	      tail: opts?.tail ?? 50,
  1392	    })) as unknown as NodeJS.ReadableStream;
  1393	  }
  1394
  1395	  /** Open an interactive terminal exec with resize support. Returns stream and resize function. */
  1396	  async execTerminal(
  1397	    containerId: string,
  1398	    cmd: string[],
  1399	  ): Promise<{
  1400	    stream: NodeJS.ReadWriteStream;
  1401	    resize: (size: { w: number; h: number }) => Promise<void>;
  1402	  }> {
  1403	    const container = this.client.getContainer(containerId);
  1404	    const exec = await container.exec({
  1405	      Cmd: cmd,
  1406	      AttachStdin: true,
  1407	      AttachStdout: true,
  1408	      AttachStderr: true,
  1409	      Tty: true,
  1410	    });
  1411	    const stream = (await exec.start({
  1412	      hijack: true,
  1413	      stdin: true,
  1414	    })) as unknown as NodeJS.ReadWriteStream;
  1415	    return {
  1416	      stream,
  1417	      resize: async (size: { w: number; h: number }) => {
  1418	        await exec.resize(size);

exec
/bin/bash -lc "git show 995ab0b:test/pipeline/docker-methods.test.ts | nl -ba | sed -n '715,860p'" in /home/lee/OpenLander
 succeeded in 0ms:
   715	// Tests: runServiceContainer
   716	// ---------------------------------------------------------------------------
   717
   718	describe('runServiceContainer', () => {
   719	  beforeEach(resetMocks);
   720	  afterEach(() => vi.restoreAllMocks());
   721
   722	  it('creates and starts a service container, returns container id', async () => {
   723	    const containerHandle = {
   724	      id: 'svc-container-id',
   725	      start: vi.fn().mockResolvedValueOnce(undefined),
   726	    };
   727	    mockCreateContainer.mockResolvedValueOnce(containerHandle);
   728
   729	    const docker = new Docker();
   730	    const id = await docker.runServiceContainer({
   731	      imageTag: 'postgres:15',
   732	      name: 'ol-svc-postgres',
   733	      port: 5432,
   734	      envVars: { POSTGRES_PASSWORD: 'secret' },
   735	      serviceName: 'postgres',
   736	    });
   737
   738	    expect(id).toBe('svc-container-id');
   739	    expect(containerHandle.start).toHaveBeenCalledTimes(1);
   740	    expect(mockCreateContainer).toHaveBeenCalledWith(
   741	      expect.objectContaining({
   742	        Image: 'postgres:15',
   743	        name: 'ol-svc-postgres',
   744	        Labels: expect.objectContaining({
   745	          'openlander.managed': 'true',
   746	          'openlander.role': 'service',
   747	          'openlander.service': 'postgres',
   748	        }),
   749	      }),
   750	    );
   751	  });
   752
   753	  it('propagates errors from createContainer', async () => {
   754	    mockCreateContainer.mockRejectedValueOnce(new Error('image not found'));
   755
   756	    const docker = new Docker();
   757	    await expect(
   758	      docker.runServiceContainer({
   759	        imageTag: 'bad:image',
   760	        name: 'ol-svc-bad',
   761	        port: 5432,
   762	        envVars: {},
   763	        serviceName: 'bad',
   764	      }),
   765	    ).rejects.toThrow('image not found');
   766	  });
   767	});
   768
   769	// ---------------------------------------------------------------------------
   770	// Tests: execStream
   771	// ---------------------------------------------------------------------------
   772
   773	describe('execStream', () => {
   774	  beforeEach(resetMocks);
   775	  afterEach(() => vi.restoreAllMocks());
   776
   777	  it('returns a readable/writable stream with default tty=true', async () => {
   778	    const mockStream = new PassThrough();
   779	    const execStart = vi.fn().mockResolvedValueOnce(mockStream);
   780	    const containerExec = vi.fn().mockResolvedValueOnce({ start: execStart });
   781	    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
   782
   783	    const docker = new Docker();
   784	    const result = await docker.execStream('c1', ['/bin/bash']);
   785
   786	    expect(result).toBe(mockStream);
   787	    expect(containerExec).toHaveBeenCalledWith({
   788	      Cmd: ['/bin/bash'],
   789	      AttachStdin: true,
   790	      AttachStdout: true,
   791	      AttachStderr: true,
   792	      Tty: true,
   793	    });
   794	    expect(execStart).toHaveBeenCalledWith({ hijack: true, stdin: true });
   795	  });
   796
   797	  it('respects tty option when set to false', async () => {
   798	    const mockStream = new PassThrough();
   799	    const execStart = vi.fn().mockResolvedValueOnce(mockStream);
   800	    const containerExec = vi.fn().mockResolvedValueOnce({ start: execStart });
   801	    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
   802
   803	    const docker = new Docker();
   804	    await docker.execStream('c1', ['ls', '-la'], { tty: false });
   805
   806	    expect(containerExec).toHaveBeenCalledWith(expect.objectContaining({ Tty: false }));
   807	  });
   808	});
   809
   810	// ---------------------------------------------------------------------------
   811	// Tests: getEventStream
   812	// ---------------------------------------------------------------------------
   813
   814	describe('getEventStream', () => {
   815	  beforeEach(resetMocks);
   816	  afterEach(() => vi.restoreAllMocks());
   817
   818	  it('returns event stream with filters applied', async () => {
   819	    const mockStream = new PassThrough();
   820	    mockGetEvents.mockResolvedValueOnce(mockStream);
   821
   822	    const docker = new Docker();
   823	    const filters = { type: ['container'], event: ['start', 'die'] };
   824	    const result = await docker.getEventStream(filters);
   825
   826	    expect(result).toBe(mockStream);
   827	    expect(mockGetEvents).toHaveBeenCalledWith({ filters });
   828	  });
   829
   830	  it('propagates errors from Docker daemon', async () => {
   831	    mockGetEvents.mockRejectedValueOnce(new Error('connection refused'));
   832
   833	    const docker = new Docker();
   834	    await expect(docker.getEventStream({ type: ['container'] })).rejects.toThrow(
   835	      'connection refused',
   836	    );
   837	  });
   838	});

exec
/bin/bash -lc 'git show 995ab0b:src/pipeline/docker.ts | rg -n "commitImage|listDanglingImages|ensureNetwork|getLogStream|execTerminal" -n' in /home/lee/OpenLander
 succeeded in 0ms:
1135:  async listDanglingImages(): Promise<Dockerode.ImageInfo[]> {
1360:  async ensureNetwork(name: string): Promise<string> {
1382:  async getLogStream(
1396:  async execTerminal(

exec
/bin/bash -lc "rg -n \"waitForContainer\\(|inspectImage\\(|removeImage\\(|getDiskUsage\\(|inspectVolume\\(|listVolumes\\(|createVolume\\(|removeVolume\\(|renameContainer\\(|runServiceContainer\\(|execTerminal\\(|getLogStream\\(|listDanglingImages\\(\" src" in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/deploy-core.ts:1544:      await this.docker.renameContainer(greenContainerId, canonicalName);
src/pipeline/recover.ts:48:    await ctx.docker.inspectImage(tag);
src/pipeline/recover.ts:57:    await ctx.docker.inspectVolume(name);
src/pipeline/recover.ts:126:      await ctx.docker.createVolume({
src/pipeline/docker.ts:697:      const result = await this.client.listVolumes({
src/pipeline/docker.ts:1157:  async listDanglingImages(): Promise<Dockerode.ImageInfo[]> {
src/pipeline/docker.ts:1192:  async inspectImage(tag: string): Promise<Dockerode.ImageInspectInfo> {
src/pipeline/docker.ts:1202:  async removeImage(tag: string, force = false): Promise<void> {
src/pipeline/docker.ts:1223:  async renameContainer(containerId: string, newName: string): Promise<void> {
src/pipeline/docker.ts:1234:  async waitForContainer(containerId: string): Promise<{ StatusCode: number }> {
src/pipeline/docker.ts:1240:  async getDiskUsage(): Promise<unknown> {
src/pipeline/docker.ts:1245:  async inspectVolume(name: string): Promise<Dockerode.VolumeInspectInfo> {
src/pipeline/docker.ts:1255:  async listVolumes(filters?: Record<string, string[]>): Promise<Dockerode.VolumeInspectInfo[]> {
src/pipeline/docker.ts:1256:    const result = (await this.client.listVolumes(
src/pipeline/docker.ts:1263:  async createVolume(opts: { name: string; labels?: Record<string, string> }): Promise<void> {
src/pipeline/docker.ts:1264:    await this.client.createVolume({
src/pipeline/docker.ts:1274:  async removeVolume(name: string): Promise<void> {
src/pipeline/docker.ts:1284:  async runServiceContainer(opts: {
src/pipeline/docker.ts:1404:  async getLogStream(
src/pipeline/docker.ts:1418:  async execTerminal(
src/monitor/alerts.ts:330:      const images = await this.docker.listDanglingImages();
src/pipeline/service-manager.ts:414:    await this.docker.createVolume({
src/pipeline/service-manager.ts:430:    const containerId = await this.docker.runServiceContainer({
src/pipeline/service-manager.ts:543:    await this.docker.removeVolume(volumeName);
src/pipeline/service-manager.ts:611:    const { StatusCode: backupExitCode } = await this.docker.waitForContainer(backupContainerId);
src/pipeline/service-manager.ts:651:        await this.docker.waitForContainer(restoreContainerId);
src/pipeline/deploy/rollback.ts:79:      await this.docker.inspectImage(rollbackImageTag);
src/web/api/project-routes.ts:1034:          const logStream = await ctx.docker.getLogStream(containerId, { tail: 50 });
src/pipeline/deploy/lifecycle.ts:175:        await this.docker.removeImage(project.image_tag);
src/web/api/terminal-routes.ts:144:              const terminal = await ctx.docker.execTerminal(containerId, [shellCmd]);
src/pipeline/image-utils.ts:115:    const inspectData = await docker.inspectImage(imageTag);
src/tools/defs/volume.ts:86:        const existing = await appCtx.docker.inspectVolume(dockerVolumeName);
src/tools/defs/volume.ts:110:        const existingVolumes = await appCtx.docker.listVolumes({ label: labels });
src/tools/defs/volume.ts:136:        await appCtx.docker.createVolume({
src/tools/defs/volume.ts:176:      const listedVolumes = await appCtx.docker.listVolumes({ label: labels });
src/tools/defs/volume.ts:188:              const inspectedVolume = await appCtx.docker.inspectVolume(name);
src/tools/defs/volume.ts:233:        inspected = await appCtx.docker.inspectVolume(dockerVolumeName);
src/tools/defs/volume.ts:252:        await appCtx.docker.removeVolume(dockerVolumeName);
src/tools/defs/volume.ts:279:      const diskUsageData: unknown = await appCtx.docker.getDiskUsage();

exec
/bin/bash -lc "sed -n '1,160p' src/pipeline/recover.ts" in /home/lee/OpenLander
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
    await ctx.docker.inspectImage(tag);
    return true;
  } catch {
    return false;
  }
}

async function volumeExists(ctx: AppContext, name: string): Promise<boolean> {
  try {
    await ctx.docker.inspectVolume(name);
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
    try {
      await ctx.docker.getNetworkInfo(name);
      return { name, status: 'existed' };
    } catch {
      // Network doesn't exist — will create below
    }
    await ctx.docker.ensureNetwork(name);
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
      await ctx.docker.createVolume({
        name: vName,
        labels: {
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

    const envVars: Record<string, string> = {};
    if (service.env_vars) {
      const parsed: unknown = JSON.parse(service.env_vars);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string') {
            const eqIdx = entry.indexOf('=');
            if (eqIdx > 0) {
              envVars[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
            }
          } else if (entry && typeof entry === 'object' && 'key' in entry && 'value' in entry) {
            envVars[String(entry.key)] = String(entry.value);
          }
        }
      }
    }

    // Get template config
    const template = SERVICE_TEMPLATES[service.type];
    const containerPort = getServiceContainerPort(service);

exec
/bin/bash -lc "sed -n '1,340p' src/tools/defs/volume.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { createModuleLogger } from '../../lib/logger.js';
import { DOCKER_LABELS } from '../../config/index.js';
import { isDockerNotFoundError } from '../../errors.js';
import {
  addVolumeSchema,
  cleanupDockerSchema,
  getDiskUsageSchema,
  listVolumesSchema,
  removeVolumeSchema,
} from './schemas.js';
import { pruneBuildCache, pruneDanglingImages, pruneUnusedImages } from '../../pipeline/cleanup.js';
import type { ToolDef } from './types.js';

const log = createModuleLogger('tools-defs-volume');

function getDockerVolumeName(projectName: string, volumeName: string): string {
  return `ol-vol-${projectName}-${volumeName}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getLabels(volume: unknown): Record<string, string> {
  if (!isRecord(volume)) {
    return {};
  }

  const rawLabels = volume['Labels'];
  if (!isRecord(rawLabels)) {
    return {};
  }

  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawLabels)) {
    if (typeof value === 'string') {
      labels[key] = value;
    }
  }

  return labels;
}

function getVolumeUsageSizeBytes(volume: unknown): number | undefined {
  if (!isRecord(volume)) {
    return undefined;
  }

  const usageData = volume['UsageData'];
  if (!isRecord(usageData)) {
    return undefined;
  }

  return getNumber(usageData['Size']);
}

export const volumeToolDefs: ToolDef[] = [
  {
    name: 'add_volume',
    riskLevel: 'medium',
    description:
      'Create a Docker named volume managed by OpenLander for a project. Use when an app needs persistent data storage at a specific mount path (for uploads, caches, or generated files). Returns { status, volume, project, mount_path }. Errors if the volume already exists.',
    mcpDescription: 'Create a project-scoped managed Docker volume with metadata labels.',
    inputSchema: addVolumeSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const volumeName = args['volume_name'] as string;
      const mountPath = args['mount_path'] as string;
      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);

      // Docker createVolume is idempotent — it silently returns existing volumes.
      // We must inspect first to detect duplicates and reject foreign volumes.
      try {
        const existing = await appCtx.docker.inspectVolume(dockerVolumeName);
        const existingLabels = getLabels(existing);
        if (existingLabels[DOCKER_LABELS.MANAGED] === 'true') {
          throw new Error(
            `Volume "${dockerVolumeName}" already exists for project "${projectName}". Use a different volume_name or remove the existing volume first.`,
          );
        }
        throw new Error(
          `A Docker volume named "${dockerVolumeName}" already exists but is not managed by OpenLander. Choose a different volume_name to avoid conflicts.`,
        );
      } catch (error) {
        // 404 = volume doesn't exist → safe to create
        if (!isDockerNotFoundError(error)) {
          throw error;
        }
      }

      // Check for duplicate mount_path within the same project
      try {
        const labels = [
          `${DOCKER_LABELS.MANAGED}=true`,
          `${DOCKER_LABELS.ROLE}=volume`,
          `${DOCKER_LABELS.PROJECT}=${projectName}`,
        ];
        const existingVolumes = await appCtx.docker.listVolumes({ label: labels });

        for (const volumeInfo of existingVolumes) {
          const volumeLabels = getLabels(volumeInfo);
          const existingMountPath = volumeLabels[DOCKER_LABELS.MOUNT_PATH];
          if (existingMountPath === mountPath) {
            const existingVolumeName = volumeLabels[DOCKER_LABELS.VOLUME] ?? 'unknown';
            throw new Error(
              `Mount path "${mountPath}" is already in use by volume "${existingVolumeName}" in project "${projectName}". Each volume must have a unique mount path.`,
            );
          }
        }
      } catch (error) {
        const message = getErrorMessage(error);
        // Re-throw our validation error or Docker errors
        if (message.includes('Mount path') || message.includes('already in use')) {
          throw error;
        }
        // Log Docker list errors but don't block creation
        log.warn(
          { err: error, project: projectName },
          'Failed to check existing volumes for mount_path duplicates',
        );
      }

      try {
        await appCtx.docker.createVolume({
          name: dockerVolumeName,
          labels: {
            [DOCKER_LABELS.ROLE]: 'volume',
            [DOCKER_LABELS.PROJECT]: projectName,
            [DOCKER_LABELS.VOLUME]: volumeName,
            [DOCKER_LABELS.MOUNT_PATH]: mountPath,
          },
        });
      } catch (error) {
        throw new Error(`Failed to create volume "${dockerVolumeName}": ${getErrorMessage(error)}`);
      }

      return {
        status: 'created',
        volume: dockerVolumeName,
        project: projectName,
        mount_path: mountPath,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'list_volumes',
    riskLevel: 'low',
    description:
      'List OpenLander-managed Docker volumes. Optionally filter by project name. Returns { count, volumes[] } where each volume includes Docker name, project, logical volume name, mount path, and sizeBytes when available from Docker usage data.',
    mcpDescription: 'List OpenLander-managed volumes with project metadata and optional sizes.',
    inputSchema: listVolumesSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string | undefined;

      const labels = projectName
        ? [
            `${DOCKER_LABELS.MANAGED}=true`,
            `${DOCKER_LABELS.ROLE}=volume`,
            `${DOCKER_LABELS.PROJECT}=${projectName}`,
          ]
        : [`${DOCKER_LABELS.MANAGED}=true`, `${DOCKER_LABELS.ROLE}=volume`];

      const listedVolumes = await appCtx.docker.listVolumes({ label: labels });

      const volumes = await Promise.all(
        listedVolumes.map(async (volumeInfo) => {
          const fallbackLabels = getLabels(volumeInfo);
          const name = getString(volumeInfo.Name) ?? '';

          let sizeBytes = getVolumeUsageSizeBytes(volumeInfo);
          let labelsFromInspect = fallbackLabels;

          if (name) {
            try {
              const inspectedVolume = await appCtx.docker.inspectVolume(name);
              sizeBytes = getVolumeUsageSizeBytes(inspectedVolume) ?? sizeBytes;
              const inspectedLabels = getLabels(inspectedVolume);
              if (Object.keys(inspectedLabels).length > 0) {
                labelsFromInspect = inspectedLabels;
              }
            } catch (error) {
              log.warn(
                { err: error, volume: name },
                'Failed to inspect Docker volume for usage data',
              );
            }
          }

          return {
            name,
            project: labelsFromInspect[DOCKER_LABELS.PROJECT] ?? null,
            volumeName: labelsFromInspect[DOCKER_LABELS.VOLUME] ?? null,
            mountPath: labelsFromInspect[DOCKER_LABELS.MOUNT_PATH] ?? null,
            ...(sizeBytes !== undefined ? { sizeBytes } : {}),
          };
        }),
      );

      return {
        count: volumes.length,
        volumes,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'remove_volume',
    riskLevel: 'medium',
    description:
      'Remove a managed project volume and permanently delete all data inside it. Use only when data is no longer needed. Returns { status, volume, warning }. If the volume is in use, stop containers first, then retry.',
    mcpDescription: 'Remove a managed volume. Data deletion is permanent.',
    inputSchema: removeVolumeSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const volumeName = args['volume_name'] as string;
      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);

      let inspected: unknown;
      try {
        inspected = await appCtx.docker.inspectVolume(dockerVolumeName);
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          throw new Error(
            `Volume "${dockerVolumeName}" not found. Check project_name and volume_name.`,
          );
        }
        const message = getErrorMessage(error);
        throw new Error(`Failed to inspect volume "${dockerVolumeName}": ${message}`);
      }

      const labels = getLabels(inspected);
      if (labels[DOCKER_LABELS.MANAGED] !== 'true' || labels[DOCKER_LABELS.ROLE] !== 'volume') {
        throw new Error(
          `Volume "${dockerVolumeName}" exists but is not an OpenLander-managed volume. Refusing to delete.`,
        );
      }

      try {
        await appCtx.docker.removeVolume(dockerVolumeName);
      } catch (error) {
        const message = getErrorMessage(error);
        if (message.toLowerCase().includes('in use')) {
          throw new Error(
            `Volume "${dockerVolumeName}" is currently in use by a container. Stop the container first, then retry remove_volume.`,
          );
        }
        throw new Error(`Failed to remove volume "${dockerVolumeName}": ${message}`);
      }

      return {
        status: 'removed',
        volume: dockerVolumeName,
        warning: 'All data in this volume has been permanently deleted.',
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'get_disk_usage',
    riskLevel: 'low',
    description:
      'Get Docker system disk usage breakdown for images, containers, and volumes. Includes a separate list of OpenLander-managed volumes with per-volume size when available. Returns counts and total sizes in bytes.',
    mcpDescription: 'Get Docker disk usage totals and managed volume sizes.',
    inputSchema: getDiskUsageSchema,
    execute: async (_args, { appCtx }) => {
      const diskUsageData: unknown = await appCtx.docker.getDiskUsage();
      if (!isRecord(diskUsageData)) {
        return {
          images: { count: 0, totalSizeBytes: 0 },
          containers: { count: 0, totalSizeBytes: 0 },
          volumes: { count: 0, totalSizeBytes: 0, managed: [] },
        };
      }

      const imagesRaw: unknown[] = Array.isArray(diskUsageData['Images'])
        ? (diskUsageData['Images'] as unknown[])
        : [];
      const containersRaw: unknown[] = Array.isArray(diskUsageData['Containers'])
        ? (diskUsageData['Containers'] as unknown[])
        : [];
      const volumesRaw: unknown[] = Array.isArray(diskUsageData['Volumes'])
        ? (diskUsageData['Volumes'] as unknown[])
        : [];

      const imageTotalSizeBytes = imagesRaw.reduce<number>((sum, image) => {
        if (!isRecord(image)) {
          return sum;
        }
        return sum + (getNumber(image['Size']) ?? 0);
      }, 0);

      const containerTotalSizeBytes = containersRaw.reduce<number>((sum, container) => {
        if (!isRecord(container)) {
          return sum;
        }
        return sum + (getNumber(container['SizeRw']) ?? 0);
      }, 0);

      const volumeTotalSizeBytes = volumesRaw.reduce<number>((sum, volume) => {
        return sum + (getVolumeUsageSizeBytes(volume) ?? 0);
      }, 0);

      const managedVolumes = volumesRaw
        .filter((volume) => {
          const labels = getLabels(volume);
          return labels[DOCKER_LABELS.MANAGED] === 'true';
        })
        .map((volume) => {
          const labels = getLabels(volume);
          const name = isRecord(volume) ? (getString(volume['Name']) ?? '') : '';
          const sizeBytes = getVolumeUsageSizeBytes(volume) ?? 0;
          return {
            name,
            ...(labels[DOCKER_LABELS.PROJECT] ? { project: labels[DOCKER_LABELS.PROJECT] } : {}),
            sizeBytes,
          };
        });

      return {
        images: {
          count: imagesRaw.length,
          totalSizeBytes: imageTotalSizeBytes,
        },
        containers: {
          count: containersRaw.length,
          totalSizeBytes: containerTotalSizeBytes,
        },

exec
/bin/bash -lc "rg -n \"isDockerNotFoundError\\(error\\)|isDockerNotFoundError\\(err\\)\" src | rg \"inspectVolume|inspectImage|getNetworkInfo|ContainerNotFoundError|Volume not found|Image not found\" -n" in /home/lee/OpenLander
 succeeded in 0ms:
21:src/pipeline/docker.ts:1196:      if (isDockerNotFoundError(error)) throw new Error(`Image not found: ${tag}`);
23:src/pipeline/docker.ts:1217:      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
24:src/pipeline/docker.ts:1228:      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
25:src/pipeline/docker.ts:1249:      if (isDockerNotFoundError(error)) throw new Error(`Volume not found: ${name}`);

exec
/bin/bash -lc "rg -n \"isDockerNotFoundError\\(\" src | sed -n '1,200p'" in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/docker.ts:786:      if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:802:      if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:817:      if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:837:          isDockerNotFoundError(error) ||
src/pipeline/docker.ts:864:      if (isNotConnectedToNetwork(msg) || isDockerNotFoundError(error)) {
src/pipeline/docker.ts:877:      if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:911:      if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:964:      if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:978:      if (!isDockerNotFoundError(error)) {
src/pipeline/docker.ts:1002:      if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:1029:      if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:1078:        if (isDockerNotFoundError(error)) {
src/pipeline/docker.ts:1196:      if (isDockerNotFoundError(error)) throw new Error(`Image not found: ${tag}`);
src/pipeline/docker.ts:1206:      if (isDockerNotFoundError(error)) return;
src/pipeline/docker.ts:1217:      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
src/pipeline/docker.ts:1228:      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
src/pipeline/docker.ts:1249:      if (isDockerNotFoundError(error)) throw new Error(`Volume not found: ${name}`);
src/pipeline/docker.ts:1278:      if (isDockerNotFoundError(error)) return;
src/pipeline/docker.ts:1387:      if (!isDockerNotFoundError(error)) {
src/pipeline/traefik.ts:154:      if (!msg.includes('not found') && !isDockerNotFoundError(error)) {
src/pipeline/compose.ts:595:              if (!isDockerNotFoundError(err)) {
src/pipeline/compose.ts:853:              if (!isDockerNotFoundError(error)) {
src/pipeline/compose.ts:863:              if (!isDockerNotFoundError(error)) {
src/pipeline/compose.ts:1012:          if (!isDockerNotFoundError(stopError)) {
src/pipeline/service-manager.ts:284:        if (isDockerNotFoundError(err)) {
src/pipeline/service-manager.ts:530:      if (!isDockerNotFoundError(error)) {
src/pipeline/service-manager.ts:537:      if (!isDockerNotFoundError(error)) {
src/pipeline/service-manager.ts:1218:      if (isDockerNotFoundError(error)) {
src/errors.ts:157:export function isDockerNotFoundError(error: unknown): boolean {
src/pipeline/deploy/rollback.ts:157:      if (isDockerNotFoundError(error)) {
src/pipeline/deploy-core.ts:732:          if (!isDockerNotFoundError(err)) {
src/pipeline/deploy-core.ts:1322:            if (!isDockerNotFoundError(err)) {
src/pipeline/image-utils.ts:155:  if (isDockerNotFoundError(error) || message.includes('repository does not exist')) {
src/tools/defs/platform-debug.ts:110:        if (isDockerNotFoundError(error)) {
src/tools/defs/volume.ts:98:        if (!isDockerNotFoundError(error)) {
src/tools/defs/volume.ts:235:        if (isDockerNotFoundError(error)) {
src/tools/defs/platform-actions.ts:123:          if (!isDockerNotFoundError(error)) {
src/tools/defs/platform-actions.ts:204:        if (isDockerNotFoundError(error)) {
src/tools/defs/platform-actions.ts:218:        if (isDockerNotFoundError(error)) {
src/tools/defs/service.ts:499:        const isContainerGone = isDockerNotFoundError(error) || message.includes('is not running');

exec
/bin/bash -lc "sed -n '130,180p' src/pipeline/image-utils.ts" in /home/lee/OpenLander
 succeeded in 0ms:
        return match && match[1] ? parseInt(match[1], 10) : null;
      })
      .filter((port): port is number => port !== null && !isManagementPort(port));

    if (ports.length === 0) {
      return null;
    }

    // Return the lowest port
    return Math.min(...ports);
  } catch (_err) {
    // Image not found or inspect failed
    return null;
  }
}

/**
 * Maps Docker pull errors to user-friendly messages.
 *
 * @param error - Error from Docker pull operation
 * @returns User-friendly error message
 */
export function mapPullError(error: Error): string {
  const message = error.message.toLowerCase();

  if (isDockerNotFoundError(error) || message.includes('repository does not exist')) {
    return 'Image not found. Check the image name and try again.';
  }

  if (message.includes('denied') || message.includes('unauthorized')) {
    return 'This appears to be a private image. Only public images are supported in the current version.';
  }

  if (message.includes('no such host') || message.includes('connection refused')) {
    return 'Cannot reach the registry. Check your network connection.';
  }

  return `Failed to pull image: ${error.message}`;
}

/**
 * Check if a port is a management/internal port that should be excluded.
 */
function isManagementPort(port: number): boolean {
  const managementPorts = [9090, 9091];
  return managementPorts.includes(port);
}

exec
/bin/bash -lc "sed -n '70,120p' src/tools/defs/volume.ts" in /home/lee/OpenLander
 succeeded in 0ms:
  {
    name: 'add_volume',
    riskLevel: 'medium',
    description:
      'Create a Docker named volume managed by OpenLander for a project. Use when an app needs persistent data storage at a specific mount path (for uploads, caches, or generated files). Returns { status, volume, project, mount_path }. Errors if the volume already exists.',
    mcpDescription: 'Create a project-scoped managed Docker volume with metadata labels.',
    inputSchema: addVolumeSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const volumeName = args['volume_name'] as string;
      const mountPath = args['mount_path'] as string;
      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);

      // Docker createVolume is idempotent — it silently returns existing volumes.
      // We must inspect first to detect duplicates and reject foreign volumes.
      try {
        const existing = await appCtx.docker.inspectVolume(dockerVolumeName);
        const existingLabels = getLabels(existing);
        if (existingLabels[DOCKER_LABELS.MANAGED] === 'true') {
          throw new Error(
            `Volume "${dockerVolumeName}" already exists for project "${projectName}". Use a different volume_name or remove the existing volume first.`,
          );
        }
        throw new Error(
          `A Docker volume named "${dockerVolumeName}" already exists but is not managed by OpenLander. Choose a different volume_name to avoid conflicts.`,
        );
      } catch (error) {
        // 404 = volume doesn't exist → safe to create
        if (!isDockerNotFoundError(error)) {
          throw error;
        }
      }

      // Check for duplicate mount_path within the same project
      try {
        const labels = [
          `${DOCKER_LABELS.MANAGED}=true`,
          `${DOCKER_LABELS.ROLE}=volume`,
          `${DOCKER_LABELS.PROJECT}=${projectName}`,
        ];
        const existingVolumes = await appCtx.docker.listVolumes({ label: labels });

        for (const volumeInfo of existingVolumes) {
          const volumeLabels = getLabels(volumeInfo);
          const existingMountPath = volumeLabels[DOCKER_LABELS.MOUNT_PATH];
          if (existingMountPath === mountPath) {
            const existingVolumeName = volumeLabels[DOCKER_LABELS.VOLUME] ?? 'unknown';
            throw new Error(
              `Mount path "${mountPath}" is already in use by volume "${existingVolumeName}" in project "${projectName}". Each volume must have a unique mount path.`,
            );
          }

exec
/bin/bash -lc "sed -n '220,245p' src/tools/defs/volume.ts" in /home/lee/OpenLander
 succeeded in 0ms:
    name: 'remove_volume',
    riskLevel: 'medium',
    description:
      'Remove a managed project volume and permanently delete all data inside it. Use only when data is no longer needed. Returns { status, volume, warning }. If the volume is in use, stop containers first, then retry.',
    mcpDescription: 'Remove a managed volume. Data deletion is permanent.',
    inputSchema: removeVolumeSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const volumeName = args['volume_name'] as string;
      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);

      let inspected: unknown;
      try {
        inspected = await appCtx.docker.inspectVolume(dockerVolumeName);
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          throw new Error(
            `Volume "${dockerVolumeName}" not found. Check project_name and volume_name.`,
          );
        }
        const message = getErrorMessage(error);
        throw new Error(`Failed to inspect volume "${dockerVolumeName}": ${message}`);
      }

      const labels = getLabels(inspected);
      if (labels[DOCKER_LABELS.MANAGED] !== 'true' || labels[DOCKER_LABELS.ROLE] !== 'volume') {

exec
/bin/bash -lc "sed -n '145,170p' src/pipeline/deploy/rollback.ts" in /home/lee/OpenLander
 succeeded in 0ms:
        success: true,
        projectId,
        projectName: project.name,
        previousImageTag: currentImageTag,
        rollbackImageTag,
        containerId,
        url: getProjectUrl(project.name),
        port,
        buildDurationMs: totalDuration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (isDockerNotFoundError(error)) {
        return {
          success: false,
          projectId,
          projectName: project.name,
          error: 'No previous image available for rollback — the image may have been pruned',
          buildDurationMs: Date.now() - startTime,
        };
      }

      this.db.updateProject(projectId, { status: 'error' });
      if (productionEnvironment) {
        this.db.updateEnvironment(productionEnvironment.id, { status: 'error' });
      }

exec
/bin/bash -lc "rg -n \"inspectImage\\(\" src/pipeline/deploy/rollback.ts src/pipeline/recover.ts src/pipeline/image-utils.ts" in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/image-utils.ts:115:    const inspectData = await docker.inspectImage(imageTag);
src/pipeline/deploy/rollback.ts:79:      await this.docker.inspectImage(rollbackImageTag);
src/pipeline/recover.ts:48:    await ctx.docker.inspectImage(tag);

exec
/bin/bash -lc "sed -n '60,90p' src/pipeline/deploy/rollback.ts" in /home/lee/OpenLander
 succeeded in 0ms:
        .getEnvironmentsByProject(projectId)
        .find((environment) => environment.type === 'production');

    const rollbackImageTag =
      productionEnvironment?.previous_image_tag ?? target.target.project.previous_image_tag;

    if (!rollbackImageTag) {
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: 'No previous image available for rollback',
      };
    }

    const currentImageTag =
      productionEnvironment?.image_tag ?? target.target.project.image_tag ?? '';

    try {
      await this.docker.inspectImage(rollbackImageTag);
    } catch {
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: 'No previous image available for rollback — the image may have been pruned',
      };
    }

    try {
      await this.cleanupRunningContainer(target.target);

exec
/bin/bash -lc "rg -n \"add_volume|remove_volume|inspectVolume\" test | sed -n '1,160p'" in /home/lee/OpenLander
 succeeded in 0ms:
test/pipeline/docker-volume.test.ts:43:describe('inspectVolume', () => {
test/pipeline/docker-volume.test.ts:58:    const result = await docker.inspectVolume('my-vol');
test/pipeline/docker-volume.test.ts:70:    await expect(docker.inspectVolume('missing-vol')).rejects.toThrow(
test/pipeline/docker-methods.test.ts:515:// Tests: inspectVolume
test/pipeline/docker-methods.test.ts:518:describe('inspectVolume', () => {
test/pipeline/docker-methods.test.ts:533:    const result = await docker.inspectVolume('my-vol');
test/pipeline/docker-methods.test.ts:545:    await expect(docker.inspectVolume('missing-vol')).rejects.toThrow(
test/pipeline/auto-recovery.test.ts:781:    // remove_volume is intentionally excluded — permanent data deletion always requires approval.
test/helpers/docker-mocks.ts:250:      inspectVolume: vi.fn(),
test/volume-minio.test.ts:75:  const inspectVolume = vi.fn<(name: string) => Promise<Record<string, unknown>>>(
test/volume-minio.test.ts:86:    inspectVolume,
test/volume-minio.test.ts:102:      inspectVolume,
test/volume-minio.test.ts:275:      'add_volume',
test/volume-minio.test.ts:277:      'remove_volume',
test/volume-minio.test.ts:330:  it('add_volume returns created payload and surfaces duplicate managed volume error', async () => {
test/volume-minio.test.ts:332:    const addVolumeTool = getMcpTool(ctx, 'add_volume');
test/volume-minio.test.ts:357:    docker.inspectVolume.mockResolvedValueOnce({
test/volume-minio.test.ts:370:  it('add_volume rejects duplicate mount_path within same project', async () => {
test/volume-minio.test.ts:372:    const addVolumeTool = getMcpTool(ctx, 'add_volume');
test/volume-minio.test.ts:396:  it('list_volumes maps labels and remove_volume rejects unmanaged then succeeds for managed volume', async () => {
test/volume-minio.test.ts:399:    const removeVolumeTool = getMcpTool(ctx, 'remove_volume');
test/volume-minio.test.ts:414:    docker.inspectVolume.mockResolvedValueOnce({
test/volume-minio.test.ts:438:    docker.inspectVolume.mockResolvedValueOnce({
test/volume-minio.test.ts:445:    docker.inspectVolume.mockResolvedValueOnce({
test/mcp/tool-registry-snapshot.test.ts:22:  'add_volume',
test/mcp/tool-registry-snapshot.test.ts:73:  'remove_volume',

exec
/bin/bash -lc 'git diff 217a28c..995ab0b -- src/monitor/docker-events.ts' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/src/monitor/docker-events.ts b/src/monitor/docker-events.ts
index 460c242..04a0cd8 100644
--- a/src/monitor/docker-events.ts
+++ b/src/monitor/docker-events.ts
@@ -77,17 +77,10 @@ export class DockerEventListener {
   private async watch(): Promise<void> {
     while (this.running) {
       try {
-        const client = this.docker.getClient();
-        const stream = await (
-          client.getEvents as (opts: {
-            filters: Record<string, string[]>;
-          }) => Promise<NodeJS.ReadableStream>
-        )({
-          filters: {
-            type: ['container'],
-            event: ['die', 'oom', 'start'],
-            label: [`${DOCKER_LABELS.MANAGED}=true`],
-          },
+        const stream = await this.docker.getEventStream({
+          type: ['container'],
+          event: ['die', 'oom', 'start'],
+          label: [`${DOCKER_LABELS.MANAGED}=true`],
         });

         this.stream = stream;

exec
/bin/bash -lc "git show 995ab0b:src/pipeline/docker.ts | nl -ba | sed -n '1190,1260p'" in /home/lee/OpenLander
 succeeded in 0ms:
  1190	  async getContainerStats(containerId: string): Promise<unknown> {
  1191	    try {
  1192	      const container = this.client.getContainer(containerId);
  1193	      return await container.stats({ stream: false });
  1194	    } catch (error) {
  1195	      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
  1196	      throw error;
  1197	    }
  1198	  }
  1199
  1200	  /** Rename a container. */
  1201	  async renameContainer(containerId: string, newName: string): Promise<void> {
  1202	    try {
  1203	      const container = this.client.getContainer(containerId);
  1204	      await container.rename({ name: newName });
  1205	    } catch (error) {
  1206	      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
  1207	      throw error;
  1208	    }
  1209	  }
  1210
  1211	  /** Wait for a container to exit. Returns exit code. */
  1212	  async waitForContainer(containerId: string): Promise<{ StatusCode: number }> {
  1213	    const container = this.client.getContainer(containerId);
  1214	    return (await container.wait()) as { StatusCode: number };
  1215	  }
  1216
  1217	  /** Docker system disk usage (images, containers, volumes). */
  1218	  async getDiskUsage(): Promise<unknown> {
  1219	    return await this.client.df();
  1220	  }
  1221
  1222	  /** Inspect a volume. */
  1223	  async inspectVolume(name: string): Promise<Dockerode.VolumeInspectInfo> {
  1224	    try {
  1225	      return await this.client.getVolume(name).inspect();
  1226	    } catch (error) {
  1227	      if (isDockerNotFoundError(error)) throw new Error(`Volume not found: ${name}`);
  1228	      throw error;
  1229	    }
  1230	  }
  1231
  1232	  /** List volumes with optional filters. */
  1233	  async listVolumes(filters?: Record<string, string[]>): Promise<Dockerode.VolumeInspectInfo[]> {
  1234	    const result = (await this.client.listVolumes(
  1235	      filters ? { filters } : undefined,
  1236	    )) as unknown as { Volumes?: Dockerode.VolumeInspectInfo[] };
  1237	    return result.Volumes ?? [];
  1238	  }
  1239
  1240	  /** Create a volume. Always applies MANAGED=true label. */
  1241	  async createVolume(opts: { name: string; labels?: Record<string, string> }): Promise<void> {
  1242	    await this.client.createVolume({
  1243	      Name: opts.name,
  1244	      Labels: {
  1245	        [DOCKER_LABELS.MANAGED]: 'true',
  1246	        ...opts.labels,
  1247	      },
  1248	    });
  1249	  }
  1250
  1251	  /** Remove a volume. Silent on 404. */
  1252	  async removeVolume(name: string): Promise<void> {
  1253	    try {
  1254	      await this.client.getVolume(name).remove();
  1255	    } catch (error) {
  1256	      if (isDockerNotFoundError(error)) return;
  1257	      throw error;
  1258	    }
  1259	  }
  1260

exec
/bin/bash -lc "git show 995ab0b:src/tools/defs/volume.ts | nl -ba | sed -n '80,105p'" in /home/lee/OpenLander
 succeeded in 0ms:
    80	      const mountPath = args['mount_path'] as string;
    81	      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);
    82
    83	      // Docker createVolume is idempotent — it silently returns existing volumes.
    84	      // We must inspect first to detect duplicates and reject foreign volumes.
    85	      try {
    86	        const existing = await appCtx.docker.inspectVolume(dockerVolumeName);
    87	        const existingLabels = getLabels(existing);
    88	        if (existingLabels[DOCKER_LABELS.MANAGED] === 'true') {
    89	          throw new Error(
    90	            `Volume "${dockerVolumeName}" already exists for project "${projectName}". Use a different volume_name or remove the existing volume first.`,
    91	          );
    92	        }
    93	        throw new Error(
    94	          `A Docker volume named "${dockerVolumeName}" already exists but is not managed by OpenLander. Choose a different volume_name to avoid conflicts.`,
    95	        );
    96	      } catch (error) {
    97	        // 404 = volume doesn't exist → safe to create
    98	        if (!isDockerNotFoundError(error)) {
    99	          throw error;
   100	        }
   101	      }
   102
   103	      // Check for duplicate mount_path within the same project
   104	      try {
   105	        const labels = [

exec
/bin/bash -lc "git show 995ab0b:src/tools/defs/volume.ts | nl -ba | sed -n '228,242p'" in /home/lee/OpenLander
 succeeded in 0ms:
   228	      const volumeName = args['volume_name'] as string;
   229	      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);
   230
   231	      let inspected: unknown;
   232	      try {
   233	        inspected = await appCtx.docker.inspectVolume(dockerVolumeName);
   234	      } catch (error) {
   235	        if (isDockerNotFoundError(error)) {
   236	          throw new Error(
   237	            `Volume "${dockerVolumeName}" not found. Check project_name and volume_name.`,
   238	          );
   239	        }
   240	        const message = getErrorMessage(error);
   241	        throw new Error(`Failed to inspect volume "${dockerVolumeName}": ${message}`);
   242	      }

exec
/bin/bash -lc "git show 995ab0b:test/pipeline/docker-methods.test.ts | rg -n \"describe\\('listDanglingImages'|describe\\('ensureNetwork'|describe\\('getLogStream'|describe\\('execTerminal'\" -n" in /home/lee/OpenLander
 exited 1 in 0ms:
codex
**Findings**

- High: `inspectVolume()` now turns Docker 404s into a plain `Error("Volume not found: ...")`, but the volume tools still key off `isDockerNotFoundError(error)`. In `995ab0b`, `add_volume` will now fail on a missing volume instead of treating that as the create path, and `remove_volume` will misclassify missing-volume errors. Refs: `src/pipeline/docker.ts:1223-1228`, `src/tools/defs/volume.ts:85-99`, `src/tools/defs/volume.ts:232-241`.

- High: `markRollbackImage()` still depends on a dynamically-probed `getClient()` even though this PR removes `getClient()` from `docker.ts`. Once `getClient()` is gone, this path returns early and rollback image labeling silently stops happening. That makes the consolidation incomplete and changes deploy behavior at runtime. Refs: `src/pipeline/deploy-core.ts:947-966` in `995ab0b`, plus `src/pipeline/docker.ts` in `995ab0b` no longer exposes `getClient()`.

- Medium: `TraefikManager.ensureNetworkByName()` still bypasses the wrapper layer via `(this.docker as any).getClient().createNetwork()`, even though `docker.ensureNetwork()` now exists. So `getClient()` is not actually eliminated, and Traefik remains coupled to raw Dockerode. Refs: `src/pipeline/traefik.ts:159-166`, `src/pipeline/docker.ts:1359-1378`.

- Medium: The added tests are too shallow for the highest-risk wrappers. `runServiceContainer` only checks labels/start and create failure, but not `RestartPolicy`, `PortBindings`, `Binds`, shared-network aliasing, `Cmd`, or healthcheck nanosecond conversion. There are also no tests for `listDanglingImages`, `ensureNetwork`, `getLogStream`, or `execTerminal`. Refs: `test/pipeline/docker-methods.test.ts:722-765`; no matching `describe(...)` blocks for the other wrappers in `995ab0b`.

**Notes**

No other `getClient()` usages showed up in the reviewed scope beyond the two you already found.

`runServiceContainer` itself is very close to the old `service-manager` createContainer behavior. The only semantic drift I noticed is that service env vars now round-trip through a `Record<string,string>`, which collapses duplicate keys and may reorder them.

`execStream` with the default `tty: true` is fine for WebSocket-style terminal bridging because Docker does not multiplex stdout/stderr in TTY mode. The `tty: false` branch is not safe as a generic bridge unless a caller demuxes Docker’s framed stream first.

`getEventStream` is just a pass-through wrapper; the lifecycle logic is still in `src/monitor/docker-events.ts` and is unchanged by this PR. Residual risk remains there: on `error`, the listener logs but only reconnects if the stream also emits `close` or `end`.

Targeted verification: `npx vitest run test/pipeline/docker-methods.test.ts` passes on the current workspace.
tokens used
91,356

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
