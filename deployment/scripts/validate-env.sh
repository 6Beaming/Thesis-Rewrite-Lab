#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-/opt/thesis-rewriter/.env.production}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

required_keys=(
  NODE_ENV
  PORT
  TRUST_PROXY_HOPS
  APP_ORIGIN
  APP_IMAGE_REF
  NLP_IMAGE_REF
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  DATABASE_URL
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  AUTH_SECRET
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRODUCT_ID
  STRIPE_PRICE_ID
  OPENAI_API_KEY
  OPENAI_REWRITE_MODEL
  OPENAI_ANALYSIS_MODEL
  OPENAI_PRACTICE_MODEL
  OPENAI_EMBEDDING_MODEL
  DOCUMENT_PARTITION_MODE
  NLP_SERVICE_URL
  NLP_SERVICE_ENABLED
)

missing=()
for key in "${required_keys[@]}"; do
  if ! grep -Eq "^${key}=.+" "${ENV_FILE}"; then
    missing+=("${key}")
  fi
done

if ((${#missing[@]} > 0)); then
  printf 'Missing or empty required variables:\n' >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

if ! grep -Fxq 'NODE_ENV=production' "${ENV_FILE}"; then
  echo "NODE_ENV must be production." >&2
  exit 1
fi
if ! grep -Fxq 'APP_ORIGIN=https://thesis-rewrite-lab.erfang.win' "${ENV_FILE}"; then
  echo "APP_ORIGIN must be the production HTTPS origin." >&2
  exit 1
fi
if ! grep -Eq '^DATABASE_URL=postgresql://.+@postgres:5432/' "${ENV_FILE}"; then
  echo "DATABASE_URL must use the private Compose host named postgres." >&2
  exit 1
fi
if ! grep -Fxq 'NLP_SERVICE_URL=http://nlp:8080' "${ENV_FILE}"; then
  echo "NLP_SERVICE_URL must use the private Compose service URL." >&2
  exit 1
fi

duplicate_keys="$(
  sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "${ENV_FILE}" \
    | sort \
    | uniq -d
)"
if [[ -n "${duplicate_keys}" ]]; then
  echo "Duplicate variable names:" >&2
  while IFS= read -r key; do
    printf '  %s\n' "${key}" >&2
  done <<<"${duplicate_keys}"
  exit 1
fi

echo "Environment validation passed; ${#required_keys[@]} required names are present."
