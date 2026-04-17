import { afterAll, describe, expect, it } from 'vitest';
import Dockerode from 'dockerode';

const docker = new Dockerode();
const memoryLimitBytes = 128 * 1024 * 1024;
const containerNames = ['cascade-test-a', 'cascade-test-b'];
const testImage = 'alpine:latest';
const oomCommand =
  'awk \'BEGIN { chunk = sprintf("%1048576s", "x"); gsub(/ /, "x", chunk); while (length(payload) < 200 * 1024 * 1024) payload = payload chunk; print length(payload); system("sleep 600"); }\'';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanupContainers(): Promise<void> {
  for (const name of containerNames) {
    try {
      const container = docker.getContainer(name);
      await container.stop({ t: 1 }).catch(() => undefined);
      await container.remove({ force: true }).catch(() => undefined);
    } catch {}
  }
}

async function ensureImageAvailable(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    const stream = await docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function waitForOomKill(container: Dockerode.Container, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const inspect = await container.inspect();
    if (inspect.State.OOMKilled) {
      return true;
    }

    if (!inspect.State.Running) {
      return false;
    }

    await sleep(1000);
  }

  return false;
}

describe('Cascade Isolation: Memory limits prevent OOM cascade', () => {
  afterAll(async () => {
    await cleanupContainers();
  });

  it('OOM-killed container does not affect sibling container', async () => {
    try {
      await docker.ping();
    } catch {
      console.log('Docker not available, skipping cascade isolation test');
      return;
    }

    await cleanupContainers();
    await ensureImageAvailable(testImage);

    const containerA = await docker.createContainer({
      Image: testImage,
      name: containerNames[0],
      Cmd: ['sh', '-c', oomCommand],
      HostConfig: {
        Memory: memoryLimitBytes,
        MemorySwap: memoryLimitBytes,
        AutoRemove: false,
      },
    });
    await containerA.start();

    const containerB = await docker.createContainer({
      Image: testImage,
      name: containerNames[1],
      Cmd: ['sleep', '3600'],
      HostConfig: {
        Memory: memoryLimitBytes,
        MemorySwap: memoryLimitBytes,
        AutoRemove: false,
      },
    });
    await containerB.start();

    const oomKilled = await waitForOomKill(containerA, 15000);
    expect(oomKilled, 'Container A should be OOM killed within 15 seconds').toBe(true);

    const inspectA = await containerA.inspect();
    expect(inspectA.State.OOMKilled, 'Container A should report OOMKilled').toBe(true);
    expect(inspectA.State.Running, 'Container A should no longer be running after OOM').toBe(false);

    const inspectB = await containerB.inspect();
    expect(
      inspectB.State.Running,
      'Container B should still be running after Container A OOM',
    ).toBe(true);

    const execB = await containerB.exec({
      Cmd: ['echo', 'alive'],
      AttachStdout: true,
      AttachStderr: false,
    });
    const streamB = await execB.start({ Detach: false });
    expect(streamB).toBeTruthy();
  }, 30000);
});
