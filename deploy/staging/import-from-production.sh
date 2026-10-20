#!/usr/bin/env bash
# One-time copy of an existing SparkyFitness (database + uploads) into this
# staging stack, for testing the personal edition on real data.
#
# The source is only read (pg_dump, read-only bind mount of uploads). The
# staging database is REPLACED. In the copy every external provider (Garmin,
# Withings, Fitbit, ...) is switched off, so staging never polls those
# services alongside production, and sign-up is closed.
#
#   ./import-from-production.sh            # defaults match the homelab stack
#
# Variables (defaults in brackets):
#   SRC_DB_CONTAINER   [sparkyfitness-db]
#   SRC_UPLOADS        [/data/docker/sparkyfitness/uploads]
#   SRC_ENV_FILE       [/data/docker/env/sparkyfitness.env]  reuse its
#                      BETTER_AUTH_SECRET and SPARKY_FITNESS_API_ENCRYPTION_KEY,
#                      so two-factor login keeps working in the copy; skipped
#                      if the file is missing or unreadable
#   DUMP_DIR           [/data/docker/sparky-next-import-<timestamp>]
set -euo pipefail
cd "$(dirname "$0")"

SRC_DB_CONTAINER="${SRC_DB_CONTAINER:-sparkyfitness-db}"
SRC_UPLOADS="${SRC_UPLOADS:-/data/docker/sparkyfitness/uploads}"
SRC_ENV_FILE="${SRC_ENV_FILE:-/data/docker/env/sparkyfitness.env}"
DUMP_DIR="${DUMP_DIR:-/data/docker/sparky-next-import-$(date +%Y%m%d-%H%M%S)}"
COMPOSE=(docker compose -f docker-compose.yml)
[ -f docker-compose.proxy.yml ] && COMPOSE+=(-f docker-compose.proxy.yml)

[ -f .env ] || ./init-env.sh
# shellcheck disable=SC1091
. ./.env
STAGING_USER="$SPARKY_FITNESS_DB_USER"
DB=sparkyfitness_db

step() { printf '\n==> %s\n' "$*"; }

set_env() { # key value: replace or append in .env without echoing the value
  local key="$1" value="$2" tmp
  tmp="$(mktemp .env.XXXXXX)"
  grep -v "^${key}=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

step "Checking source container $SRC_DB_CONTAINER"
docker inspect "$SRC_DB_CONTAINER" >/dev/null
if [ "$SRC_DB_CONTAINER" = "$("${COMPOSE[@]}" ps -q next-db | xargs -r docker inspect --format '{{.Name}}' | tr -d /)" ]; then
  echo "source and target are the same container; refusing" >&2
  exit 1
fi

step "Dumping source database (read-only) to $DUMP_DIR"
mkdir -p "$DUMP_DIR"
chmod 700 "$DUMP_DIR"
docker exec "$SRC_DB_CONTAINER" sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "${POSTGRES_DB:-sparkyfitness_db}" -Fc --no-owner --no-acl' \
  > "$DUMP_DIR/source.dump"
chmod 600 "$DUMP_DIR/source.dump"
ls -lh "$DUMP_DIR/source.dump"

if [ -r "$SRC_ENV_FILE" ]; then
  step "Reusing auth secret and encryption key from $SRC_ENV_FILE"
  for key in BETTER_AUTH_SECRET SPARKY_FITNESS_API_ENCRYPTION_KEY; do
    value="$(grep -E "^${key}=" "$SRC_ENV_FILE" | tail -1 | cut -d= -f2- || true)"
    if [ -n "$value" ]; then set_env "$key" "$value"; echo "  $key: copied"; else echo "  $key: not found, keeping staging value"; fi
  done
else
  echo "  $SRC_ENV_FILE not readable: keeping staging secrets (two-factor and stored provider logins will not work in the copy)"
fi
set_env SPARKY_FITNESS_DISABLE_SIGNUP true

step "Stopping staging app containers"
"${COMPOSE[@]}" stop next-frontend next-server

step "Replacing staging database"
"${COMPOSE[@]}" exec -T next-db psql -v ON_ERROR_STOP=1 -U "$STAGING_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" \
  -c "CREATE DATABASE $DB OWNER \"$STAGING_USER\""
# --no-owner/--no-acl: objects belong to the staging owner; the server grants
# its application role on startup. Errors about pre-existing extensions are
# harmless, so the exit code is checked by the row counts below instead.
"${COMPOSE[@]}" exec -T next-db pg_restore -U "$STAGING_USER" -d "$DB" \
  --no-owner --no-acl --exit-on-error < "$DUMP_DIR/source.dump" \
  || { echo "pg_restore failed; staging is left stopped. Re-run after fixing." >&2; exit 1; }

step "Switching off external providers in the copy"
"${COMPOSE[@]}" exec -T next-db psql -v ON_ERROR_STOP=1 -U "$STAGING_USER" -d "$DB" -tA \
  -c "UPDATE external_data_providers SET is_active = false WHERE is_active" \
  -c "SELECT 'users: ' || count(*) FROM \"user\"" \
  -c "SELECT 'providers active: ' || count(*) FILTER (WHERE is_active) FROM external_data_providers"

step "Copying uploads (read-only source)"
if [ -d "$SRC_UPLOADS" ]; then
  docker run --rm -v "$SRC_UPLOADS:/src:ro" -v sparky-next_next-uploads:/dst \
    alpine:3.20 sh -c 'cp -a /src/. /dst/ && du -sh /dst'
else
  echo "  $SRC_UPLOADS not found, skipped"
fi

step "Starting staging (migrations run on the copy)"
"${COMPOSE[@]}" up -d
for _ in $(seq 1 90); do
  if "${COMPOSE[@]}" exec -T next-server sh -c 'wget -qO- http://127.0.0.1:3010/api/health >/dev/null 2>&1 || curl -sf http://127.0.0.1:3010/api/health >/dev/null'; then
    break
  fi
  sleep 2
done
"${COMPOSE[@]}" logs next-server 2>&1 | grep -E "Applying migration|Successfully applied migration|ERROR" | tail -20 || true
"${COMPOSE[@]}" ps

step "Done"
echo "Dump kept at $DUMP_DIR/source.dump (private, delete when no longer needed)."
echo "Log in at ${SPARKY_FITNESS_FRONTEND_URL} with your existing account."
