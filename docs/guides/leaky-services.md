# Deploying Memory-Leaking Services

Some third-party services have known memory leaks. Browser automation tools, scraper helpers, and Chromium-based containers are the most common offenders. Without a memory limit, a single leaky container can exhaust the host's RAM and take down everything else running on the machine.

This guide covers how to deploy these services safely.

---

## The Problem

Certain services accumulate memory over time and never release it. The container keeps running, but its memory footprint grows until the host OOM-killer steps in. At that point, the kernel kills whatever process it can, which may not be the leaky container.

**flaresolverr** is the most common example. Its GitHub README explicitly acknowledges memory leaks and recommends periodic restarts as the mitigation. Chromium-based services in general tend to behave this way.

Without a memory limit:

- The leaky container grows unchecked
- The host kernel decides what to kill (often not the culprit)
- Other containers, including your apps, can be killed
- The host itself can become unresponsive

---

## Solution: Three Layers of Defense

### 1. Set a Memory Limit

A memory limit caps how much RAM the container can use. When it hits the cap, Docker kills just that container, not the host or other services. This is the most important protection.

Set it in OpenLander: **Project Settings** → **Resources** → Memory Limit.

A reasonable starting point for flaresolverr is **512MB to 1GB**, depending on your workload. If you see frequent OOM kills, increase the limit or reduce the restart interval (see below).

### 2. Use the `unless-stopped` Restart Policy

After an OOM kill, the container is stopped. With `restart: unless-stopped`, Docker automatically restarts it. The service comes back online without any manual intervention.

OpenLander sets `unless-stopped` as the default restart policy for services. If you're using a custom image, confirm this is set.

### 3. (Optional) Periodic Restart

For services with aggressive leaks, you can proactively restart the container on a schedule before it hits the memory limit. This prevents OOM kills entirely.

Options:

- Use a cron job on the host: `docker restart ol-svc-flaresolverr`
- Use a scheduled task container (e.g. `mcuadros/ofelia`) that restarts the service nightly
- Set a low memory limit so OOM kills happen quickly and the restart policy handles recovery

---

## flaresolverr Example

flaresolverr is a proxy server that solves Cloudflare challenges using a headless Chromium browser. It's widely used with tools like Prowlarr and Jackett.

**Recommended setup in OpenLander:**

1. Create a custom service with image `ghcr.io/flaresolverr/flaresolverr:latest`
2. Set memory limit to **512MB** (Project Settings → Resources)
3. Confirm restart policy is `unless-stopped` (default)
4. Expose port `8191`

With this configuration:

- If flaresolverr leaks past 512MB, Docker kills only that container
- It restarts automatically within seconds
- Your other services are unaffected

> **Reference**: The flaresolverr project README states: _"FlareSolverr has a memory leak. It is recommended to restart the container periodically."_ See [github.com/FlareSolverr/FlareSolverr](https://github.com/FlareSolverr/FlareSolverr).

---

## Detecting Leaky Services

OpenLander shows OOM alerts in the Operations Center when a container is killed by the kernel.

The alert message tells you whether a memory limit was configured:

| Alert text                   | What it means                                  |
| ---------------------------- | ---------------------------------------------- |
| `Memory limit: 512MB`        | Container hit its cap. Limit is working.       |
| `No memory limit configured` | Container was killed by host OOM. Set a limit. |

If you see repeated OOM alerts for the same service, the service is leaky. Apply the three-layer strategy above.

---

## Quick Reference

| Step             | Where                            | What to set                             |
| ---------------- | -------------------------------- | --------------------------------------- |
| Memory limit     | Project Settings → Resources     | 512MB to 1GB for browser-based services |
| Restart policy   | Set by default                   | `unless-stopped`                        |
| OOM alerts       | Operations Center                | Check for "No memory limit configured"  |
| Periodic restart | Host cron or scheduler container | `docker restart ol-svc-{name}` nightly  |
