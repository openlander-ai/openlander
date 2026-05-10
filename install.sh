#!/usr/bin/env bash
set -Eeuo pipefail

OPENLANDER_REPO="openlander-ai/openlander"
OPENLANDER_VERSION="${OPENLANDER_VERSION:-latest}"
OPENLANDER_INSTALL_DIR="${OPENLANDER_INSTALL_DIR:-/opt/openlander}"
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

install_docker() {
  if command_exists docker; then
    log "Docker is already installed."
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

write_env_if_missing() {
  local env_path password image
  env_path="${OPENLANDER_INSTALL_DIR}/.env"

  if [ -f "${env_path}" ]; then
    log "Keeping existing ${env_path}."
    return
  fi

  password="$(generate_password)"
  image="$(runtime_image)"
  cat >"${env_path}" <<EOF
OPENLANDER_POSTGRES_PASSWORD=${password}
OPENLANDER_IMAGE=${image}
OPENLANDER_PORT=${OPENLANDER_PORT}
EOF
  chmod 600 "${env_path}"
  log "Created ${env_path}."
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

run_compose() {
  log "Starting OpenLander..."
  (
    cd "${OPENLANDER_INSTALL_DIR}"
    docker compose -f docker-compose.runtime.yml up -d
  )
}

server_url() {
  local host
  host="localhost"
  if command_exists hostname; then
    host="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -z "${host}" ]; then
    host="localhost"
  fi
  printf 'http://%s:%s' "${host}" "${OPENLANDER_PORT}"
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
  write_env_if_missing
  run_compose

  log "OpenLander is starting."
  log "Open $(server_url) and create the admin password."
}

update_openlander() {
  require_root
  require_linux
  validate_inputs
  ensure_curl
  start_docker
  ensure_compose
  download_compose

  log "Updating OpenLander..."
  (
    cd "${OPENLANDER_INSTALL_DIR}"
    docker compose -f docker-compose.runtime.yml pull
    docker compose -f docker-compose.runtime.yml up -d
  )
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
