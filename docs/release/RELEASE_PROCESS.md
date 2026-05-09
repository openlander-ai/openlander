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

`npm run release` uses release-it only for version/changelog/tag management. It
intentionally does **not** publish to npm or create the GitHub Release; the tag
workflow owns artifact publication.

For normal 0.x patch/minor releases:

```bash
npm run release
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
   `linux/arm64` with tags:
   - `ghcr.io/openlander-ai/openlander:<version>`
   - `ghcr.io/openlander-ai/openlander:<major>.<minor>`
   - `ghcr.io/openlander-ai/openlander:latest`
7. Create the GitHub Release from the matching `CHANGELOG.md` section.

## Post-Release Verification

```bash
docker pull ghcr.io/openlander-ai/openlander:0.1.0
OPENLANDER_IMAGE=ghcr.io/openlander-ai/openlander:0.1.0 \
  docker compose -f docker-compose.runtime.yml up -d
curl -fsS http://localhost:10114/api/health
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
