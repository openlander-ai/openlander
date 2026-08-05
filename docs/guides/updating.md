# Updating OpenLander

OpenLander never updates itself without an administrator confirming the exact release.

## Official Docker Compose installation

OpenLander shows its update status above the account card in the sidebar. Release metadata is
refreshed at least every 30 minutes while the UI is open, and a stale check is retried every two
minutes. Open the dialog and choose **Check now** to bypass the cache. When a newer release is
available, review its release notes and preflight checks, then choose **Update now**. The button
remains available while the update is running so you can reopen progress.

The one-click updater:

1. accepts only the current official GitHub release and its `openlander-update.json` asset;
2. creates a custom-format PostgreSQL dump and backs up `.env` and the Compose file;
3. downloads and validates the target release's official Compose file, pulls the exact GHCR image
   digest, changes `OPENLANDER_IMAGE`, and persists the current effective official Compose
   interpolation settings in `.env`;
4. recreates only the `openlander` service;
5. verifies the reported version, database startup, and Traefik network synchronization; and
6. restores the previous image and Compose configuration if verification fails.

The database dump is retained for operator recovery and is never restored automatically. Recent
backup data is stored under the `openlander-data` volume in `updates/`; the latest three backups
are retained. Update status JSON contains no credentials.

Starting with 0.3, the official Compose file also mounts
`${OPENLANDER_DATA_VOLUME:-openlander-data}-cloudflare`. The updater preserves that volume and the
database-backed Cloudflare connection, so the Named Tunnel, selected Zone, and reserved Project
hostnames remain stable while the OpenLander container is recreated. A running connector is not
replaced by the update unless reconciliation detects that the owned connector needs repair.

Before starting, OpenLander verifies that the running database password, published port, public
host, and data-volume name can be preserved safely. If those settings cannot be reconstructed from
the running official Compose containers, one-click update is disabled and the manual update guide
must be used.

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
