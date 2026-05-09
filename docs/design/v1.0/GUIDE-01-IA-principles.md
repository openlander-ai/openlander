# GUIDE-01: IA Principles

## 1. Vocabulary

- **Project**: a group-level container for deployable services, environment, and
  routing context.
- **Service**: a runtime unit inside a project.
- **Managed service**: infrastructure owned by OpenLander, such as a database or
  cache.
- **Deployment**: an execution record for build/create/start/health work.

## 2. Navigation

The sidebar should expose stable product surfaces, not implementation details.
Workspace contains Home, Your Agent, Projects, Activity, Deployments,
Monitoring, and Web Server. Settings contains setup/integration surfaces.

## 3. Density

OpenLander pages should be information-dense inside semantic groups. Empty space
is useful only when it clarifies grouping or hierarchy.

## 4. Mechanisms

### M1: Persistent Shell

Navigation, account actions, and global status live in the shell.

### M2: Single Outer-Card Content Frame

Primary route content sits inside one outer card. Inner cards may group related
content, but the route should not become a loose collection of unrelated panels.

### M3: Explicit Status Surfaces

Operational state should be visible as status chips, banners, or structured
summary cards instead of being hidden in logs.
