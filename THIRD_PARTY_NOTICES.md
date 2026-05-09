# Third-Party Notices

OpenLander is distributed under the GNU Affero General Public License v3.0. It also uses
third-party open-source dependencies listed in `package-lock.json` and `web/package-lock.json`.

This file highlights bundled notices that are especially relevant to the distributed web UI.

## Bundled Fonts

The web UI uses font packages from Fontsource:

- `@fontsource-variable/inter`
- `@fontsource-variable/geist-mono`
- `@fontsource-variable/jetbrains-mono`

These fonts are distributed under the SIL Open Font License 1.1. See:

- https://openfontlicense.org/
- https://fontsource.org/

## Icons and UI Libraries

OpenLander uses open-source UI dependencies including Lucide icons, Radix UI primitives, React,
Tailwind CSS, and related packages. Their license metadata is recorded in the lockfiles.

Before publishing a release artifact, maintainers should run a dependency license audit against the
root and `web/` lockfiles and update this notice if any bundled runtime asset requires additional
attribution.
