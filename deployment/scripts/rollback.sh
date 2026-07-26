#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/thesis-rewriter}"
COMPOSE_FILE="${APP_ROOT}/compose.production.yaml"
ENV_FILE="${APP_ROOT}/.env.production"
STATE_DIR="${APP_ROOT}/state"
RELEASE_FILE="${STATE_DIR}/release.env"
CURRENT_FILE="${STATE_DIR}/current.env"
PREVIOUS_FILE="${STATE_DIR}/previous.env"
LOCK_FILE="${STATE_DIR}/deploy.lock"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${PREVIOUS_FILE}" ]]; then
  echo "No previous release is recorded." >&2
  exit 1
fi

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another deployment operation is already running." >&2
  exit 1
fi

"${SCRIPT_DIR}/validate-env.sh" "${ENV_FILE}"

current_snapshot="$(mktemp)"
trap 'rm -f "${current_snapshot}"' EXIT
if [[ -f "${CURRENT_FILE}" ]]; then
  cp -f "${CURRENT_FILE}" "${current_snapshot}"
fi

cp -f "${PREVIOUS_FILE}" "${RELEASE_FILE}"

docker compose \
  --project-directory "${APP_ROOT}" \
  --env-file "${ENV_FILE}" \
  --env-file "${RELEASE_FILE}" \
  --file "${COMPOSE_FILE}" \
  pull app nlp
docker compose \
  --project-directory "${APP_ROOT}" \
  --env-file "${ENV_FILE}" \
  --env-file "${RELEASE_FILE}" \
  --file "${COMPOSE_FILE}" \
  up -d --wait --wait-timeout 240 nlp app

curl --fail --silent --show-error \
  http://127.0.0.1:3001/api/health >/dev/null

cp -f "${PREVIOUS_FILE}" "${CURRENT_FILE}"
if [[ -s "${current_snapshot}" ]]; then
  cp -f "${current_snapshot}" "${PREVIOUS_FILE}"
fi
date -u +%Y-%m-%dT%H:%M:%SZ >"${STATE_DIR}/rolled-back-at.txt"

echo "Application rollback completed."
echo "Database migrations and data were not reversed."
