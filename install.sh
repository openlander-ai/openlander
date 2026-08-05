#!/usr/bin/env bash
set -Eeuo pipefail

OPENLANDER_REPO="openlander-ai/openlander"
OPENLANDER_VERSION="${OPENLANDER_VERSION:-latest}"
OPENLANDER_INSTALL_DIR="${OPENLANDER_INSTALL_DIR:-/opt/openlander}"
OPENLANDER_PORT_EXPLICIT="${OPENLANDER_PORT+x}"
OPENLANDER_PORT="${OPENLANDER_PORT:-10114}"
DOCKER_COMPOSE_VERSION="${DOCKER_COMPOSE_VERSION:-v2.29.7}"
RESOLVED_OPENLANDER_REF=""

log() {
  printf '[openlander] %s\n' "$*"
}

fail() {
  printf '[openlander] error: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_root() {
  if [ "$(id -u)" != "0" ]; then
    fail "run this installer as root, for example: curl -fsSL https://raw.githubusercontent.com/${OPENLANDER_REPO}/main/install.sh | sudo bash"
  fi
}

usage() {
  cat <<EOF
OpenLander installer

Usage:
  install.sh [install]
  install.sh update
  install.sh help

Environment:
  OPENLANDER_VERSION       latest or vX.Y.Z / X.Y.Z (default: latest)
  OPENLANDER_INSTALL_DIR   install directory (default: /opt/openlander)
  OPENLANDER_PORT          host port mapped to OpenLander (default: 10114)
  OPENLANDER_PUBLIC_HOST   host/IP used when advertising deployed app URLs
  DOCKER_COMPOSE_VERSION   fallback Compose plugin version (default: ${DOCKER_COMPOSE_VERSION})
EOF
}

require_linux() {
  if [ "$(uname -s)" != "Linux" ]; then
    fail "this installer targets Linux servers. On macOS, install Docker Desktop and use docker-compose.runtime.yml manually."
  fi
}

ensure_supported_arch() {
  case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *)
      log "warning: published OpenLander images target linux/amd64 and linux/arm64; this host is $(uname -m)."
      ;;
  esac
}

ensure_curl() {
  command_exists curl || fail "curl is required to download OpenLander."
}

linux_os_id() {
  awk -F= '$1 == "ID" { gsub(/"/, "", $2); print $2 }' /etc/os-release 2>/dev/null || true
}

install_docker_with_package_manager() {
  local os_id
  os_id="$(linux_os_id)"

  case "${os_id}" in
    amzn)
      if command_exists dnf; then
        log "Installing Docker with dnf..."
        dnf install -y docker && return 0
      fi
      if command_exists yum; then
        log "Installing Docker with yum..."
        yum install -y docker && return 0
      fi
      ;;
  esac

  return 1
}

install_docker() {
  if command_exists docker; then
    log "Docker is already installed."
    return
  fi

  if install_docker_with_package_manager; then
    return
  fi

  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
}

start_docker() {
  if command_exists systemctl; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  elif command_exists service; then
    service docker start >/dev/null 2>&1 || true
  fi

  docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon is not reachable. Start Docker and rerun this installer."
  log "Docker daemon is reachable."
}

compose_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) printf 'x86_64' ;;
    aarch64 | arm64) printf 'aarch64' ;;
    *) fail "unsupported architecture for Docker Compose plugin: $(uname -m)" ;;
  esac
}

install_compose_with_package_manager() {
  if command_exists apt-get; then
    log "Installing Docker Compose plugin with apt..."
    apt-get update
    apt-get install -y docker-compose-plugin && return 0
  fi

  if command_exists dnf; then
    log "Installing Docker Compose plugin with dnf..."
    dnf install -y docker-compose-plugin && return 0
  fi

  if command_exists yum; then
    log "Installing Docker Compose plugin with yum..."
    yum install -y docker-compose-plugin && return 0
  fi

  return 1
}

install_compose_manually() {
  local arch plugin_dir plugin_path url
  arch="$(compose_arch)"
  plugin_dir="/usr/local/lib/docker/cli-plugins"
  plugin_path="${plugin_dir}/docker-compose"
  url="https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${arch}"

  log "Installing Docker Compose plugin ${DOCKER_COMPOSE_VERSION}..."
  mkdir -p "${plugin_dir}"
  curl -fsSL "${url}" -o "${plugin_path}"
  chmod +x "${plugin_path}"
}

ensure_compose() {
  if docker compose version >/dev/null 2>&1; then
    log "Docker Compose v2 is available."
    return
  fi

  install_compose_with_package_manager || install_compose_manually

  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 plugin is not available after installation."
}

validate_inputs() {
  if [[ ! "${OPENLANDER_VERSION}" =~ ^latest$|^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    fail "OPENLANDER_VERSION must be 'latest' or a release version like v0.1.0."
  fi

  if [[ ! "${OPENLANDER_PORT}" =~ ^[0-9]+$ ]] || [ "${OPENLANDER_PORT}" -lt 1 ] || [ "${OPENLANDER_PORT}" -gt 65535 ]; then
    fail "OPENLANDER_PORT must be a TCP port number between 1 and 65535."
  fi
}

resolve_latest_release_tag() {
  local api tag
  api="https://api.github.com/repos/${OPENLANDER_REPO}/releases/latest"
  tag="$(curl -fsSL "${api}" | sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"

  if [ -z "${tag}" ]; then
    fail "could not resolve the latest OpenLander release from GitHub."
  fi

  printf '%s' "${tag}"
}

release_ref() {
  if [ -n "${RESOLVED_OPENLANDER_REF}" ]; then
    printf '%s' "${RESOLVED_OPENLANDER_REF}"
    return
  fi

  if [ "${OPENLANDER_VERSION}" = "latest" ]; then
    RESOLVED_OPENLANDER_REF="$(resolve_latest_release_tag)"
  elif [[ "${OPENLANDER_VERSION}" == v* ]]; then
    RESOLVED_OPENLANDER_REF="${OPENLANDER_VERSION}"
  else
    RESOLVED_OPENLANDER_REF="v${OPENLANDER_VERSION}"
  fi

  printf '%s' "${RESOLVED_OPENLANDER_REF}"
}

runtime_image() {
  if [ "${OPENLANDER_VERSION}" = "latest" ]; then
    printf 'ghcr.io/%s:latest' "${OPENLANDER_REPO}"
  else
    printf 'ghcr.io/%s:%s' "${OPENLANDER_REPO}" "${OPENLANDER_VERSION#v}"
  fi
}

generate_password() {
  if command_exists openssl; then
    openssl rand -hex 24
    return
  fi

  dd if=/dev/urandom bs=24 count=1 2>/dev/null | base64 | tr -d '=+/'
}

normalize_public_host() {
  local host
  host="$1"
  case "${host}" in
    http://*)
      host="${host#http://}"
      ;;
    https://*)
      host="${host#https://}"
      ;;
  esac
  host="${host%%/*}"
  host="${host%%:*}"
  case "${host}" in
    \*.*)
      host="${host#*.}"
      ;;
  esac
  printf '%s' "${host}"
}

print_valid_ipv4() {
  local ip
  ip="$1"
  case "${ip}" in
    *.*.*.*)
      printf '%s' "${ip}"
      return 0
      ;;
  esac

  return 1
}

aws_public_ipv4() {
  local ip token

  command_exists curl || return 1

  token="$(
    curl -fsS --max-time 1 -X PUT \
      -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
      http://169.254.169.254/latest/api/token 2>/dev/null || true
  )"
  if [ -n "${token}" ]; then
    ip="$(
      curl -fsS --max-time 1 \
        -H "X-aws-ec2-metadata-token: ${token}" \
        http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true
    )"
  else
    ip="$(
      curl -fsS --max-time 1 \
        http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true
    )"
  fi

  print_valid_ipv4 "${ip}"
}

gcp_public_ipv4() {
  local ip

  command_exists curl || return 1

  ip="$(
    curl -fsS --max-time 1 \
      -H 'Metadata-Flavor: Google' \
      http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || true
  )"

  print_valid_ipv4 "${ip}"
}

azure_public_ipv4() {
  local ip

  command_exists curl || return 1

  ip="$(
    curl -fsS --max-time 1 --noproxy '*' \
      -H 'Metadata: true' \
      'http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text' 2>/dev/null || true
  )"

  print_valid_ipv4 "${ip}"
}

digitalocean_public_ipv4() {
  local ip

  command_exists curl || return 1

  ip="$(
    curl -fsS --max-time 1 \
      http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || true
  )"

  print_valid_ipv4 "${ip}"
}

cloud_public_ipv4() {
  aws_public_ipv4 || gcp_public_ipv4 || azure_public_ipv4 || digitalocean_public_ipv4 || return 1
}

server_host() {
  local host
  host="${OPENLANDER_PUBLIC_HOST:-}"
  if [ -n "${host}" ]; then
    host="$(normalize_public_host "${host}")"
  fi
  if [ -z "${host}" ]; then
    host="$(cloud_public_ipv4 || true)"
  fi
  if [ -z "${host}" ] && command_exists hostname; then
    host="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -z "${host}" ]; then
    host="localhost"
  fi
  printf '%s' "${host}"
}

write_env_if_missing() {
  local env_path password image public_host
  env_path="${OPENLANDER_INSTALL_DIR}/.env"

  if [ -f "${env_path}" ]; then
    log "Keeping existing ${env_path}."
    return
  fi

  password="$(generate_password)"
  image="$(runtime_image)"
  public_host="$(server_host)"
  cat >"${env_path}" <<EOF
OPENLANDER_POSTGRES_PASSWORD=${password}
OPENLANDER_IMAGE=${image}
OPENLANDER_PORT=${OPENLANDER_PORT}
OPENLANDER_PUBLIC_HOST=${public_host}
COMPOSE_PROJECT_NAME=openlander
EOF
  chmod 600 "${env_path}"
  log "Created ${env_path}."
}

env_file_value() {
  local env_path key
  env_path="${OPENLANDER_INSTALL_DIR}/.env"
  key="$1"
  [ -f "${env_path}" ] || return 1
  sed -n "s/^${key}=//p" "${env_path}" | tail -n 1
}

env_file_has_key() {
  local env_path key
  env_path="${OPENLANDER_INSTALL_DIR}/.env"
  key="$1"
  [ -f "${env_path}" ] && grep -q "^${key}=" "${env_path}"
}

set_env_file_value() {
  local env_path key tmp value
  env_path="${OPENLANDER_INSTALL_DIR}/.env"
  key="$1"
  value="$2"
  mkdir -p "${OPENLANDER_INSTALL_DIR}"
  touch "${env_path}"
  chmod 600 "${env_path}"
  tmp="$(mktemp "${OPENLANDER_INSTALL_DIR}/.env.XXXXXX")"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print key "=" value
      }
    }
  ' "${env_path}" >"${tmp}"
  cat "${tmp}" >"${env_path}"
  rm -f "${tmp}"
  chmod 600 "${env_path}"
}

detect_compose_project_name() {
  local container label
  for container in openlander-db openlander; do
    label="$(docker inspect "${container}" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null || true)"
    if [ -n "${label}" ] && [ "${label}" != "<no value>" ]; then
      printf '%s' "${label}"
      return
    fi
  done

  if env_file_value COMPOSE_PROJECT_NAME >/dev/null; then
    env_file_value COMPOSE_PROJECT_NAME
    return
  fi

  printf 'openlander'
}

sync_runtime_env() {
  local image project_name public_host
  image="$(runtime_image)"
  project_name="$(detect_compose_project_name)"
  public_host="${OPENLANDER_PUBLIC_HOST:-}"

  set_env_file_value OPENLANDER_IMAGE "${image}"
  if [ -n "${OPENLANDER_PORT_EXPLICIT}" ] || ! env_file_has_key OPENLANDER_PORT; then
    set_env_file_value OPENLANDER_PORT "${OPENLANDER_PORT}"
  fi
  if [ -n "${public_host}" ] || ! env_file_has_key OPENLANDER_PUBLIC_HOST; then
    set_env_file_value OPENLANDER_PUBLIC_HOST "$(server_host)"
  fi
  set_env_file_value COMPOSE_PROJECT_NAME "${project_name}"
  log "Using Compose project ${project_name} with image ${image}."
}

compose_project_name() {
  env_file_value COMPOSE_PROJECT_NAME || printf 'openlander'
}

download_compose() {
  local backup compose_path ref tmp url
  ref="$(release_ref)"
  url="https://raw.githubusercontent.com/${OPENLANDER_REPO}/${ref}/docker-compose.runtime.yml"
  compose_path="${OPENLANDER_INSTALL_DIR}/docker-compose.runtime.yml"

  mkdir -p "${OPENLANDER_INSTALL_DIR}"
  log "Downloading docker-compose.runtime.yml from ${ref}..."
  tmp="$(mktemp "${OPENLANDER_INSTALL_DIR}/docker-compose.runtime.yml.XXXXXX")"
  curl -fsSL "${url}" -o "${tmp}"

  if [ -f "${compose_path}" ]; then
    if cmp -s "${tmp}" "${compose_path}"; then
      rm -f "${tmp}"
      log "Existing docker-compose.runtime.yml is already current."
      return
    fi

    backup="${compose_path}.bak.$(date +%Y%m%d%H%M%S)"
    cp -p "${compose_path}" "${backup}"
    mv "${tmp}" "${compose_path}"
    log "Updated docker-compose.runtime.yml. Previous file saved to ${backup}."
    return
  fi

  mv "${tmp}" "${compose_path}"
}

download_control_cli() {
  local backup cli_path ref tmp url
  ref="$(release_ref)"
  url="https://raw.githubusercontent.com/${OPENLANDER_REPO}/${ref}/openlanderctl"
  cli_path="${OPENLANDER_INSTALL_DIR}/openlanderctl"

  mkdir -p "${OPENLANDER_INSTALL_DIR}"
  log "Downloading openlanderctl from ${ref}..."
  tmp="$(mktemp "${OPENLANDER_INSTALL_DIR}/openlanderctl.XXXXXX")"
  curl -fsSL "${url}" -o "${tmp}"
  chmod 755 "${tmp}"

  if [ -f "${cli_path}" ]; then
    if cmp -s "${tmp}" "${cli_path}"; then
      rm -f "${tmp}"
      chmod 755 "${cli_path}"
      log "Existing openlanderctl is already current."
      return
    fi

    backup="${cli_path}.bak.$(date +%Y%m%d%H%M%S)"
    cp -p "${cli_path}" "${backup}"
    mv "${tmp}" "${cli_path}"
    log "Updated openlanderctl. Previous file saved to ${backup}."
    return
  fi

  mv "${tmp}" "${cli_path}"
}

install_control_cli_link() {
  local link_path
  link_path="/usr/local/bin/openlanderctl"
  mkdir -p "$(dirname "${link_path}")"

  if [ -e "${link_path}" ] && [ ! -L "${link_path}" ]; then
    log "warning: ${link_path} already exists and was not replaced."
    log "  Run ${OPENLANDER_INSTALL_DIR}/openlanderctl directly."
    return
  fi

  ln -sfn "${OPENLANDER_INSTALL_DIR}/openlanderctl" "${link_path}"
  log "Installed ${link_path}."
}

run_compose() {
  log "Starting OpenLander..."
  (
    cd "${OPENLANDER_INSTALL_DIR}"
    COMPOSE_PROJECT_NAME="$(compose_project_name)" docker compose -f docker-compose.runtime.yml up -d
  )
}

smoke_check() {
  local port url
  port="$(env_file_value OPENLANDER_PORT || printf '%s' "${OPENLANDER_PORT}")"
  url="http://127.0.0.1:${port}/"
  for _ in $(seq 1 30); do
    # Connection failures are expected while the server boots; stay quiet until
    # it responds, otherwise the retry loop prints alarming "curl: (56) Recv
    # failure" lines that read like an install error.
    if curl -fsS -o /dev/null --max-time 2 "${url}" 2>/dev/null; then
      log "OpenLander responded at ${url}."
      return
    fi
    sleep 1
  done
  log "warning: OpenLander did not respond at ${url} within 30s. Check docker logs openlander."
}

server_url() {
  printf 'http://%s:%s' "$(server_host)" "${OPENLANDER_PORT}"
}

host_is_local_or_private() {
  case "$1" in
    localhost | 127.* | 10.* | 192.168.* | 169.254.*) return 0 ;;
    172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) return 0 ;;
    *) return 1 ;;
  esac
}

print_reachability_notes() {
  local host
  host="$(server_host)"
  log "Inbound: open TCP 80 (deployed app routes) and TCP ${OPENLANDER_PORT} (dashboard/MCP)"
  log "  on your firewall / cloud security group. This installer does not change firewall rules."
  if host_is_local_or_private "${host}"; then
    log "warning: advertising '${host}' as the public host, so deployed app URLs may be"
    log "  unreachable from other machines. Set OPENLANDER_PUBLIC_HOST=<public-ip-or-domain>"
    log "  (env on install, or in ${OPENLANDER_INSTALL_DIR}/.env then restart) for reachable URLs."
  fi
}

install_openlander() {
  require_root
  require_linux
  validate_inputs
  ensure_supported_arch
  ensure_curl
  install_docker
  start_docker
  ensure_compose
  download_compose
  download_control_cli
  install_control_cli_link
  write_env_if_missing
  sync_runtime_env
  run_compose
  smoke_check

  log "OpenLander is starting."
  log "Open $(server_url) and create the admin password."
  print_reachability_notes
}

update_openlander() {
  require_root
  require_linux
  validate_inputs
  ensure_curl
  start_docker
  ensure_compose
  download_compose
  download_control_cli
  install_control_cli_link
  if [ -f "${OPENLANDER_INSTALL_DIR}/.env" ]; then
    cp -p "${OPENLANDER_INSTALL_DIR}/.env" "${OPENLANDER_INSTALL_DIR}/.env.bak.$(date +%Y%m%d%H%M%S)"
  fi
  sync_runtime_env

  log "Updating OpenLander..."
  (
    cd "${OPENLANDER_INSTALL_DIR}"
    COMPOSE_PROJECT_NAME="$(compose_project_name)" docker compose -f docker-compose.runtime.yml pull openlander
    COMPOSE_PROJECT_NAME="$(compose_project_name)" docker compose -f docker-compose.runtime.yml up -d --no-deps openlander
  )
  smoke_check
  log "OpenLander update requested."
}

case "${1:-install}" in
  install)
    install_openlander
    ;;
  update)
    update_openlander
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    fail "unknown command: ${1}. Use 'install' or 'update'."
    ;;
esac
