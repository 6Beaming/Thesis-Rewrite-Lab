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
BACKUP_DIR="${APP_ROOT}/backups"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

APP_IMAGE_REF="${1:-}"
NLP_IMAGE_REF="${2:-}"

if [[ -z "${APP_IMAGE_REF}" || -z "${NLP_IMAGE_REF}" ]]; then
  echo "Usage: deploy.sh <node-image-ref> <nlp-image-ref>" >&2
  exit 1
fi
if [[ "${APP_IMAGE_REF}" == *$'\n'* || "${NLP_IMAGE_REF}" == *$'\n'* ]]; then
  echo "Image references must not contain newlines." >&2
  exit 1
fi

for required_file in "${COMPOSE_FILE}" "${ENV_FILE}"; do
  if [[ ! -f "${required_file}" ]]; then
    echo "Required deployment file is missing: ${required_file}" >&2
    exit 1
  fi
done

mkdir -p "${STATE_DIR}" "${BACKUP_DIR}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 1
fi

"${SCRIPT_DIR}/validate-env.sh" "${ENV_FILE}"

write_release_file() {
  local app_ref="$1"
  local nlp_ref="$2"
  local destination="$3"
  local temporary="${destination}.tmp"
  {
    printf 'APP_IMAGE_REF=%s\n' "${app_ref}"
    printf 'NLP_IMAGE_REF=%s\n' "${nlp_ref}"
  } >"${temporary}"
  chmod 0600 "${temporary}"
  mv -f "${temporary}" "${destination}"
}

compose() {
  docker compose \
    --project-directory "${APP_ROOT}" \
    --env-file "${ENV_FILE}" \
    --env-file "${RELEASE_FILE}" \
    --file "${COMPOSE_FILE}" \
    "$@"
}

rollback_on_error() {
  local exit_code=$?
  trap - ERR
  set +e
  echo "Deployment failed; attempting application image rollback." >&2
  if [[ -f "${PREVIOUS_FILE}" ]]; then
    cp -f "${PREVIOUS_FILE}" "${RELEASE_FILE}"
    compose up -d --wait --wait-timeout 240 nlp app
    curl --fail --silent --show-error \
      http://127.0.0.1:3001/api/health >/dev/null
    cp -f "${PREVIOUS_FILE}" "${CURRENT_FILE}"
    echo "Last known-good Node/NLP image pair restored." >&2
  else
    echo "No previous release is recorded; automatic rollback is unavailable." >&2
  fi
  exit "${exit_code}"
}
trap rollback_on_error ERR

if [[ -f "${CURRENT_FILE}" ]]; then
  cp -f "${CURRENT_FILE}" "${PREVIOUS_FILE}"
fi
write_release_file "${APP_IMAGE_REF}" "${NLP_IMAGE_REF}" "${RELEASE_FILE}"

docker pull "${APP_IMAGE_REF}"
docker pull "${NLP_IMAGE_REF}"

compose up -d --wait --wait-timeout 240 postgres nlp

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="${BACKUP_DIR}/postgres-${timestamp}.sql.gz"
# The variables below intentionally expand inside the PostgreSQL container.
# shellcheck disable=SC2016
compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip -c >"${backup_path}.tmp"
mv -f "${backup_path}.tmp" "${backup_path}"
chmod 0600 "${backup_path}"

compose run --rm app npm run db:migrate
compose up -d --wait --wait-timeout 240 app

curl --fail --silent --show-error \
  http://127.0.0.1:3001/api/health >/dev/null

compose exec -T nlp python -c \
  "import json, urllib.request; payload=json.load(urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)); assert payload.get('status') == 'ready'"

write_release_file "${APP_IMAGE_REF}" "${NLP_IMAGE_REF}" "${CURRENT_FILE}"
date -u +%Y-%m-%dT%H:%M:%SZ >"${STATE_DIR}/deployed-at.txt"
trap - ERR

echo "Deployment completed successfully."
echo "Node image: ${APP_IMAGE_REF}"
echo "NLP image: ${NLP_IMAGE_REF}"
echo "Database backup: ${backup_path}"
