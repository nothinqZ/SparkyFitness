#!/usr/bin/env bash
# Writes .env with fresh random secrets (never committed). Re-running keeps an
# existing .env, because changing the encryption key makes stored provider
# credentials unreadable.
set -euo pipefail
cd "$(dirname "$0")"
if [ -f .env ]; then echo ".env exists, keeping it"; exit 0; fi
umask 077
cat > .env <<ENV
SPARKY_FITNESS_DB_USER=sparky
SPARKY_FITNESS_DB_PASSWORD=$(openssl rand -hex 24)
SPARKY_FITNESS_APP_DB_USER=sparky_app
SPARKY_FITNESS_APP_DB_PASSWORD=$(openssl rand -hex 24)
SPARKY_FITNESS_API_ENCRYPTION_KEY=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
SPARKY_FITNESS_FRONTEND_URL=${SPARKY_FITNESS_FRONTEND_URL:-http://localhost:3104}
SPARKY_FITNESS_LOG_LEVEL=INFO
TZ=Europe/Berlin
ENV
echo "wrote $(pwd)/.env"
