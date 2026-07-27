#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "certificate setup failed at line ${LINENO}" >&2' ERR

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

DOMAIN="${DOMAIN:-thesis-rewrite-lab.erfang.win}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
LETSENCRYPT_STAGING="${LETSENCRYPT_STAGING:-false}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

if [[ -z "${LETSENCRYPT_EMAIL}" ]]; then
  echo "Set LETSENCRYPT_EMAIL before issuing a certificate." >&2
  exit 1
fi

resolved_addresses="$(
  getent ahostsv4 "${DOMAIN}" | awk '{print $1}' | sort -u
)"
public_address="$(curl -fsS --ipv4 https://api.ipify.org)"
if ! grep -Fxq "${public_address}" <<<"${resolved_addresses}"; then
  echo "${DOMAIN} does not resolve to this VM (${public_address})." >&2
  exit 1
fi

nginx -t
systemctl reload nginx

certbot_arguments=(
  certonly
  --webroot
  --webroot-path /var/www/certbot
  --domain "${DOMAIN}"
  --cert-name "${DOMAIN}"
  --email "${LETSENCRYPT_EMAIL}"
  --agree-tos
  --no-eff-email
  --non-interactive
)
if [[ "${LETSENCRYPT_STAGING}" == "true" ]]; then
  certbot_arguments+=(--dry-run)
fi

certbot "${certbot_arguments[@]}"

if [[ "${LETSENCRYPT_STAGING}" == "true" ]]; then
  echo "Let's Encrypt staging rehearsal completed; no certificate was installed."
  exit 0
fi

install -m 0644 \
  "${DEPLOYMENT_DIR}/nginx/thesis-rewriter.conf" \
  /etc/nginx/sites-available/thesis-rewriter.conf
install -m 0755 \
  "${SCRIPT_DIR}/reload-nginx.sh" \
  /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

nginx -t
systemctl reload nginx
certbot renew --dry-run

echo "Certificate issuance and renewal validation completed for ${DOMAIN}."
