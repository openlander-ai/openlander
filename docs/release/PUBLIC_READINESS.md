# Public Readiness Checklist

This checklist is for maintainers preparing OpenLander for a public repository or public release.

## Repository Tree

- Keep public docs limited to user-facing guides, contributor docs, release process docs, and API
  references.
- Do not commit internal planning notes, dogfood QA notes, competitive analysis, local-machine paths,
  screenshots from private environments, or agent scratch directories.
- Keep generated logs, Playwright/MCP captures, local database files, and runtime artifacts ignored.

## Git History

Removing files from the current tree does not remove them from existing Git history. Before making a
previously private repository public, use one of these approaches:

1. Create a new public repository from a sanitized export of the current tree.
2. Rewrite history with a tool such as `git filter-repo` or BFG, then force-push before changing
   visibility.

For a first public launch, a clean public repository is usually safer and easier to audit than
rewriting a long private history.

## Release Surface

- Docker Compose is the primary v0.1 install path.
- npm is not a primary v0.1 distribution path; do not show npm badges or npm install links unless the
  package is intentionally published and supported.
- Keep `SECURITY.md`, `LICENSE`, `CODE_OF_CONDUCT.md`, and `THIRD_PARTY_NOTICES.md` current before
  tagging a release.

## Public Launch Checklist

- Verify the latest GitHub Release, GHCR image, install script, and README quickstart all point to
  the same supported version.
- Add or refresh README screenshots and one short demo clip that shows the agent-driven flow:
  connect MCP, deploy an app, inspect status, and diagnose logs.
- Set the repository description, website URL, social preview image, topics, and pinned repository
  state on the GitHub organization.
- Keep issue templates, security reporting, contributing guidelines, and release notes visible before
  inviting public feedback.
- If a public domain is available, point it at the README/docs/landing page before posting on public
  launch channels.
- Prefer GitHub Discussions for early support unless maintainers can actively monitor a Discord
  server. An empty chat server looks worse than no chat server.
- Prepare short answers for common launch questions: how OpenLander differs from Coolify/Railway,
  what MCP adds, how Failure Tickets and Recovery Receipts help agents verify fixes, what
  destructive actions agents cannot perform, and what the known 0.1/0.2 limitations are.
