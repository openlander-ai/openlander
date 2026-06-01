# Release Process

This runbook describes the v0.1 release path for maintainers.

## Release Artifacts

| Artifact      | Destination                        | Notes                                                                        |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| Source        | GitHub tag + GitHub Release        | Clean public repository only. Do not release from a private-history export.  |
| Runtime image | `ghcr.io/openlander-ai/openlander` | Published as a multi-architecture image for `linux/amd64` and `linux/arm64`. |
| npm package   | Not published in Phase 0           | `npm pack --dry-run --json` still runs as a packaging integrity check.       |
| Release notes | GitHub Release + `CHANGELOG.md`    | Notes are extracted from the matching changelog section.                     |

Docker Hub mirroring, SBOMs, and image signing are post-0.1 follow-ups. GHCR is
enough for the soft release because it needs no extra registry secrets and is
tied to the GitHub organization.

## Prerequisites

- Public repository tree has passed `docs/release/PUBLIC_READINESS.md`.
- `CHANGELOG.md` has a section for the release version.
- `package.json` and `web/package.json` versions match the release tag.
- Maintainer has push permission for tags.
- GitHub Actions has `contents: write` and `packages: write` permission on the
  release workflow.

## Local Release Prep

Run from a clean checkout of the public release branch:

```bash
git status --short
npm ci
cd web && npm ci && cd ..
npm run qa:release
npm run test:coverage
npm pack --dry-run --json --ignore-scripts
```

`npm run release:rc` and `npm run release:final` use release-it only for
version/changelog/tag management. They intentionally do **not** publish to npm
or create the GitHub Release; the tag workflow owns artifact publication. The
workflow requires the tag, root `package.json`, web `package.json`, and
`CHANGELOG.md` heading to use the exact same SemVer string.

Use the explicit scripts below rather than raw `npm run release` so the RC path
is not skipped by accident. The raw `release` script intentionally exits with an
error.

For normal 0.x patch/minor releases:

```bash
npm run release:final
```

For dogfood candidates, cut prerelease tags first and promote only after live
QA is clean:

```bash
npm run release:rc
```

Recommended flow:

```text
v0.1.1-rc.1 -> v0.1.1-rc.2 -> v0.1.1
v0.1.2-rc.1 -> v0.1.2-rc.2 -> v0.1.2
```

Release candidates are GitHub prereleases. They publish immutable version tags
plus the moving `rc` image tag, but they do not update `latest` or the
`<major>.<minor>` image tag.

Each release candidate needs its own changelog heading because release notes are
extracted from the exact tag version:

```markdown
## [0.1.1-rc.2] - 2026-05-13

### Fixed

- Fix domain route validation regression.

## [0.1.1-rc.1] - 2026-05-12

### Added

- Add service domain routing.
```

When promoting to the final release, consolidate the RC notes into the final
heading:

```markdown
## [0.1.1] - 2026-05-14
```

For the first `v0.1.0` release, `package.json` is already at `0.1.0`. If
release-it would otherwise increment the version, create the first tag manually
after the full local gate passes:

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

## Tag Workflow

Pushing `v*.*.*` triggers `.github/workflows/release-publish.yml`:

1. Install root and web dependencies with Node 22 and npm 11.5.1.
2. Verify tag version matches `package.json` and `web/package.json`.
3. Run `npm run qa:release`.
4. Run `npm run test:coverage`.
5. Run `npm pack --dry-run --json --ignore-scripts`.
6. Build and push `Dockerfile.runtime` to GHCR for `linux/amd64` and
   `linux/arm64`.
7. Create the GitHub Release from the matching `CHANGELOG.md` section.

Final releases push:

- `ghcr.io/openlander-ai/openlander:<version>`
- `ghcr.io/openlander-ai/openlander:<major>.<minor>`
- `ghcr.io/openlander-ai/openlander:latest`

Prereleases push:

- `ghcr.io/openlander-ai/openlander:<version>`
- `ghcr.io/openlander-ai/openlander:<prerelease-channel>` (`rc` for
  `v0.1.1-rc.1`)

Prereleases never move `latest`.

## RC to Final Promotion Checklist

Before tagging a final release:

1. Verify the final tag will point at the same commit as the last accepted RC,
   or only at a commit that contains release-note/version-only changes. Confirm
   this with `git diff v0.1.1-rc.N..HEAD`; the only allowed final-only changes
   are `CHANGELOG.md`, `package.json`, `web/package.json`, and package lockfile
   version mirrors. No dependency graph changes are allowed in
   `package-lock.json` or `web/package-lock.json`.
2. Install and smoke-test the exact RC image on the release QA host, for example
   `ghcr.io/openlander-ai/openlander:0.1.1-rc.2`. The smoke pass must cover
   setup/login, project creation, one deploy or redeploy, MCP token visibility,
   and `docker compose` update from the RC image. If any smoke item fails, cut a
   new `vX.Y.Z-rc.N+1` instead of promoting.
3. Consolidate the accepted RC changelog entries into the final heading, for
   example `## [0.1.1] - 2026-05-14`.
4. Run the local release prep commands again:
   `npm ci`, `cd web && npm ci`, `npm run qa:release`,
   `npm run test:coverage`, and `npm pack --dry-run --json --ignore-scripts`.
   Inspect the pack output for unexpected files, secrets, test artifacts, or a
   size jump from the previous accepted RC.
5. Run `npm run release:final`.
6. Confirm the GitHub Release is not marked prerelease and that GHCR moved
   `<major>.<minor>` and `latest` to the final image.

## Cold-Agent RC Dry-Run

Each accepted 0.1.x release candidate must pass a cold-agent smoke run on a
fresh or dedicated QA host before final promotion. Do not run this gate on a
host that already runs a dogfood OpenLander instance or unrelated `ol-*`
containers: startup monitors reconcile managed Docker containers against the
active database.

Use the exact RC artifact under test, not a local checkout. For image-based
validation, pin `ghcr.io/openlander-ai/openlander:<version>-rc.N`; for installer
validation, pin `OPENLANDER_VERSION=v<version>-rc.N`.

The dry-run must cover:

1. Fresh install and setup/login.
2. MCP token visibility from the UI or `POST /api/mcp/token`.
3. Agent-compatible deploy path for the demo app through MCP or the documented
   REST flow.
4. Managed PostgreSQL and Redis creation/binding flow, followed by redeploy.
5. Topology and log recovery checks after deploy completion.
6. One rollback or redeploy lifecycle check.
7. `OPENLANDER_E2E_SLOW=1` compose lane when the release touches compose,
   Docker orchestration, container cleanup, or deploy lifecycle code.

If any item fails, cut a new RC after the fix. Keep raw host names, IPs,
credentials, screenshots with secrets, and private dogfood notes out of public
commits; publish only the public-safe pass/fail summary in the release notes or
PR.

## Post-Release Verification

```bash
docker pull ghcr.io/openlander-ai/openlander:0.1.0
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh \
  | sudo env OPENLANDER_VERSION=v0.1.0 bash
curl -fsS http://localhost:10114/api/health
```

For a release candidate, pin the installer to the exact prerelease tag:

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh \
  | sudo env OPENLANDER_VERSION=v0.1.1-rc.1 bash
```

After the first GHCR package is created, verify package visibility in GitHub's
package settings. It should be public for the public repository.

## Rollback

If the workflow fails before creating a GitHub Release, fix the issue and push a
new tag after deleting the failed tag locally and remotely:

```bash
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
```

If the runtime image was pushed but the release is bad, publish a patch version
instead of mutating an already announced tag.
