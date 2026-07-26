#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "bootstrap failed at line ${LINENO}" >&2' ERR

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify the operating system." >&2
  exit 1
fi

# shellcheck source=/dev/null
source /etc/os-release
if [[ ${ID:-} != "ubuntu" ]]; then
  echo "This bootstrap supports Ubuntu only; detected ${ID:-unknown}." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_ROOT="${APP_ROOT:-/opt/thesis-rewriter}"
DEPLOY_PUBLIC_KEY_FILE="${DEPLOY_PUBLIC_KEY_FILE:-}"

echo "Detected Ubuntu ${VERSION_ID:-unknown} on $(dpkg --print-architecture)."
echo "Target application root: ${APP_ROOT}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx certbot ufw

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi

if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"

install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_ROOT}"
install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
  "${APP_ROOT}/backups" "${APP_ROOT}/state"
install -d -m 0755 /var/www/certbot

if [[ -n "${DEPLOY_PUBLIC_KEY_FILE}" ]]; then
  if [[ ! -f "${DEPLOY_PUBLIC_KEY_FILE}" ]]; then
    echo "Deploy public key file not found: ${DEPLOY_PUBLIC_KEY_FILE}" >&2
    exit 1
  fi
  if ! grep -Eq '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) ' \
      "${DEPLOY_PUBLIC_KEY_FILE}"; then
    echo "Deploy public key file is not a recognized SSH public key." >&2
    exit 1
  fi
  install -d -m 0700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
    "/home/${DEPLOY_USER}/.ssh"
  install -m 0600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
    "${DEPLOY_PUBLIC_KEY_FILE}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
fi

install -m 0644 \
  "${DEPLOYMENT_DIR}/nginx/thesis-rewriter-http.conf" \
  /etc/nginx/sites-available/thesis-rewriter.conf
ln -sfn /etc/nginx/sites-available/thesis-rewriter.conf \
  /etc/nginx/sites-enabled/thesis-rewriter.conf

ufw allow OpenSSH
ufw allow "Nginx Full"
ufw --force enable

nginx -t
systemctl enable --now docker
systemctl enable --now nginx
systemctl enable --now certbot.timer

docker version
docker compose version
systemctl --no-pager --full status docker nginx certbot.timer \
  | sed -n '1,30p'

echo "Bootstrap complete. Sign out and back in before using Docker as ${DEPLOY_USER}."
