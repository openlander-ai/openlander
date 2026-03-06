import { describe, it, expect, vi } from 'vitest';
import { DeployQueue } from '../src/agent/deploy-queue.js';

describe('DeployQueue', () => {
  it('acquire returns immediately when queue is empty', async () => {
    const queue = new DeployQueue();
    expect(queue.isRunning()).toBe(false);
    expect(queue.getQueueLength()).toBe(0);

    const release = await queue.acquire();
    expect(queue.isRunning()).toBe(true);
    expect(queue.getQueueLength()).toBe(0);

    release();
    expect(queue.isRunning()).toBe(false);
  });

  it('sequential processing: second acquire waits for first to release', async () => {
    const queue = new DeployQueue();
    const order: number[] = [];

    const release1 = await queue.acquire();
    order.push(1);

    // Second acquire should block
    const acquire2Promise = queue.acquire().then((release2) => {
      order.push(2);
      return release2;
    });

    // Give time for acquire2 to queue up
    await new Promise((r) => setTimeout(r, 10));
    expect(queue.getQueueLength()).toBe(1);
    expect(order).toEqual([1]); // Only first has acquired

    // Release first
    release1();

    // Second should now resolve
    const release2 = await acquire2Promise;
    expect(order).toEqual([1, 2]);
    expect(queue.getQueueLength()).toBe(0);

    release2();
    expect(queue.isRunning()).toBe(false);
  });

  it('multiple queued jobs are processed in FIFO order', async () => {
    const queue = new DeployQueue();
    const order: number[] = [];

    const release1 = await queue.acquire();

    const releases: Array<() => void> = [];

    // Queue up 3 more jobs
    for (const i of [2, 3, 4]) {
      queue.acquire().then((release) => {
        order.push(i);
        releases.push(release);
      });
    }

    await new Promise((r) => setTimeout(r, 10));
    expect(queue.getQueueLength()).toBe(3);

    // Release them one by one
    release1();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([2]);

    releases[0]!();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([2, 3]);

    releases[1]!();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([2, 3, 4]);

    releases[2]!();
    expect(queue.isRunning()).toBe(false);
  });

  it('double release is safe (no-op)', async () => {
    const queue = new DeployQueue();
    const release = await queue.acquire();

    release();
    release(); // Should not throw
    expect(queue.isRunning()).toBe(false);
  });

  it('getPosition returns correct queue state', async () => {
    const queue = new DeployQueue();

    expect(queue.getPosition()).toBe(-1); // Not running

    const release1 = await queue.acquire();
    expect(queue.getPosition()).toBe(0); // Running, no queue

    const p2 = queue.acquire();
    const p3 = queue.acquire();
    await new Promise((r) => setTimeout(r, 10));
    expect(queue.getPosition()).toBe(2); // 2 waiting

    release1();
    const release2 = await p2;
    expect(queue.getPosition()).toBe(1); // 1 waiting

    release2();
    const release3 = await p3;
    expect(queue.getPosition()).toBe(0); // 0 waiting

    release3();
  });
});
