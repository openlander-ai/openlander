# Updating OpenLander

OpenLander never updates itself without an administrator confirming the exact release.

## Official Docker Compose installation

When a newer release is available, OpenLander shows **New version vX.Y.Z** above the account card
in the sidebar. Open the dialog to review release notes and preflight checks, then choose **Update
now**. The button remains available while the update is running so you can reopen progress.

The one-click updater:

1. accepts only the current official GitHub release and its `openlander-update.json` asset;
2. creates a custom-format PostgreSQL dump and backs up `.env` and the Compose file;
3. pulls the exact GHCR image digest and changes only `OPENLANDER_IMAGE` in `.env`;
4. recreates only the `openlander` service;
5. verifies the reported version, database startup, and Traefik network synchronization; and
6. restores the previous image and Compose configuration if verification fails.

The database dump is retained for operator recovery and is never restored automatically. Recent
backup data is stored under the `openlander-data` volume in `updates/`; the latest three backups
are retained. Update status JSON contains no credentials.

## Other installation methods

Direct CLI, systemd, PM2, and custom Compose installations receive the release notification but do
not expose the one-click action. Follow the lifecycle used by your process manager after installing
the target OpenLander package or image. For the legacy official installer, an administrator can run:

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh \
  | sudo env OPENLANDER_VERSION=vX.Y.Z bash -s -- update
```

Do not replace the image with an arbitrary registry URL. Official releases are published from
`openlander-ai/openlander` and `ghcr.io/openlander-ai/openlander` only.
