#!/usr/bin/env bash

set -euo pipefail

fixture_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/openlander-compose-update.XXXXXX")"
project_name="openlander-update-fixture"

cleanup() {
  docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT

cat >"$fixture_root/docker-compose.runtime.yml" <<'YAML'
services:
  openlander-db:
    image: alpine:3.20
    command: ['sh', '-c', 'while true; do sleep 3600; done']

  openlander:
    image: ${OPENLANDER_IMAGE}
    command: ['sh', '-c', 'while true; do sleep 3600; done']
    environment:
      CUSTOM_SETTING: ${CUSTOM_SETTING}
YAML

cat >"$fixture_root/.env" <<'ENV'
OPENLANDER_IMAGE=alpine:3.20
CUSTOM_SETTING=preserved
ENV

docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" --project-directory "$fixture_root" up -d
database_before="$(docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" --project-directory "$fixture_root" ps -q openlander-db)"
openlander_before="$(docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" --project-directory "$fixture_root" ps -q openlander)"

sed -i.bak 's/^OPENLANDER_IMAGE=.*/OPENLANDER_IMAGE=alpine:3.21/' "$fixture_root/.env"
rm -f -- "$fixture_root/.env.bak"
docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" --project-directory "$fixture_root" config --quiet
docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" --project-directory "$fixture_root" up -d --no-deps --force-recreate openlander

database_after="$(docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" --project-directory "$fixture_root" ps -q openlander-db)"
openlander_after="$(docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" --project-directory "$fixture_root" ps -q openlander)"
actual_image="$(docker inspect --format '{{.Config.Image}}' "$openlander_after")"
custom_setting="$(docker compose --project-name "$project_name" --file "$fixture_root/docker-compose.runtime.yml" --project-directory "$fixture_root" exec -T openlander printenv CUSTOM_SETTING)"

test "$database_before" = "$database_after"
test "$openlander_before" != "$openlander_after"
test "$actual_image" = 'alpine:3.21'
test "$custom_setting" = 'preserved'

echo 'Compose self-replacement fixture passed'
