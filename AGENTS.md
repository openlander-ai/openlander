# Agent Instructions

## Version Bump Checklist

When bumping the version (e.g. `0.6.2` → `0.6.3`), update ALL of these:

### Automated by `npm run release` (release-it)

- `package.json` — version field
- `web/package.json` — synced via after:bump hook
- `package-lock.json` — regenerated via after:bump hook
- `web/package-lock.json` — regenerated via after:bump hook
- `CHANGELOG.md` — `[Unreleased]` section promoted to new version
- Git tag — `v{version}`

### Manual (agent must update)

- `docs/planning/version-map.md` — add version to timeline + create section with changes
- `README.md` — add row to roadmap table if the release has user-facing features

### When NOT using `npm run release` (manual bump)

All of the above must be done manually. In addition:

- Run `npm install --package-lock-only` in root AND `web/` to sync lock files
- Ensure `CHANGELOG.md` has the new version section (move items from `[Unreleased]`)
