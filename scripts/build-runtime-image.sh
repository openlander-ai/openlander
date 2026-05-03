#!/usr/bin/env bash
set -euo pipefail

image="${OPENLANDER_IMAGE:-openlander:local}"

if [[ "${OPENLANDER_SKIP_APP_BUILD:-0}" != "1" ]]; then
  echo "==> Building OpenLander artifacts without declaration files or sourcemaps"
  OPENLANDER_BUILD_DTS=false OPENLANDER_BUILD_SOURCEMAP=false npm run build
else
  echo "==> Skipping app build; using existing dist/ and web/dist/"
fi

if [[ ! -f dist/cli/index.js ]]; then
  echo "dist/cli/index.js is missing. Run npm run build first or unset OPENLANDER_SKIP_APP_BUILD." >&2
  exit 1
fi

if [[ ! -d web/dist ]]; then
  echo "web/dist is missing. Run npm run build first or unset OPENLANDER_SKIP_APP_BUILD." >&2
  exit 1
fi

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/openlander-runtime.XXXXXX")"
trap 'rm -rf "${tmpdir}"' EXIT

mkdir -p "${tmpdir}/web"
cp package.json package-lock.json README.md CHANGELOG.md LICENSE Dockerfile.runtime "${tmpdir}/"
cp -R dist "${tmpdir}/dist"
cp -R web/dist "${tmpdir}/web/dist"
cp -R drizzle "${tmpdir}/drizzle"

echo "==> Building runtime image ${image}"
docker build -f "${tmpdir}/Dockerfile.runtime" -t "${image}" "${tmpdir}"
