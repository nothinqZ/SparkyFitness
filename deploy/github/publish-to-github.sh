#!/usr/bin/env bash
# Publishes this fork to GitHub and starts the iOS sideload build.
#
#   deploy/github/publish-to-github.sh
#
# 1. Reads a GitHub token (default: RENOVATE_GITHUB_COM_TOKEN from
#    /data/docker/env/renovate.env; or set GITHUB_TOKEN). The token is never
#    printed, written to git config or passed on a command line.
# 2. Creates <your-login>/SparkyFitness as a fork of CodeWithCJ/SparkyFitness
#    if it does not exist (needs a classic token with `public_repo`/`repo`, or
#    a fine-grained token allowed to create repositories).
# 3. Enables Actions in the fork and disables the upstream release/deploy
#    workflows there (Docker Hub, docs, Helm, Umbrel, release-please ...),
#    which would only fail without upstream's secrets.
# 4. Pushes branch `personal` and tag `$TAG` (default sideload-v<version>-1);
#    the tag starts .github/workflows/ios-sideload.yml.
#
# Variables: GITHUB_TOKEN, TOKEN_FILE, TOKEN_VAR, REPO (owner/name), TAG
set -euo pipefail
cd "$(dirname "$0")/../.."

TOKEN_FILE="${TOKEN_FILE:-/data/docker/env/renovate.env}"
TOKEN_VAR="${TOKEN_VAR:-RENOVATE_GITHUB_COM_TOKEN}"
if [ -z "${GITHUB_TOKEN:-}" ]; then
  GITHUB_TOKEN="$(grep -E "^${TOKEN_VAR}=" "$TOKEN_FILE" | tail -1 | cut -d= -f2- | tr -d "\"'")"
fi
[ -n "$GITHUB_TOKEN" ] || { echo "no token found ($TOKEN_VAR in $TOKEN_FILE)" >&2; exit 1; }
export GITHUB_TOKEN

UPSTREAM=CodeWithCJ/SparkyFitness
API=https://api.github.com
api() { curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "==> Checking token"
headers="$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $GITHUB_TOKEN" "$API/user")"
status="$(printf '%s' "$headers" | head -1)"
case "$status" in *" 200"*) ;; *) echo "token rejected: $status" >&2; exit 1 ;; esac
LOGIN="$(api "$API/user" | json 'd["login"]')"
SCOPES="$(printf '%s' "$headers" | grep -i '^x-oauth-scopes:' | cut -d: -f2- | tr -d '\r' | xargs || true)"
echo "    login: $LOGIN"
echo "    classic scopes: ${SCOPES:-<none or fine-grained token>}"
REPO="${REPO:-$LOGIN/SparkyFitness}"

echo "==> Fork $REPO"
if api "$API/repos/$REPO" >/dev/null 2>&1; then
  echo "    exists"
else
  if ! api -X POST "$API/repos/$UPSTREAM/forks" -d '{"default_branch_only":true}' >/dev/null; then
    echo "    could not create the fork: the token lacks repository write/creation rights." >&2
    echo "    Create a token with 'public_repo' (classic) and run: GITHUB_TOKEN=... $0" >&2
    exit 1
  fi
  for _ in $(seq 1 30); do api "$API/repos/$REPO" >/dev/null 2>&1 && break; sleep 2; done
  echo "    created"
fi

echo "==> Actions in the fork"
api -X PUT "$API/repos/$REPO/actions/permissions" -d '{"enabled":true,"allowed_actions":"all"}' >/dev/null \
  && echo "    enabled" \
  || echo "    could not enable via API: open https://github.com/$REPO/actions and press 'I understand my workflows, go ahead and enable them'"
# Upstream-only automation; it needs upstream's secrets and would only fail here.
for wf in android.yml auto-docker-deploy.yml docs-deploy.yml draft-release.yml helm-chart-version.yml \
          helm-release.yml release-assets.yml release-please.yml release-published-notifier.yml \
          schema-backup.yml umbrel-app-submit.yml umbrel-app-update.yml nix-update-hashes.yml \
          sync-translations.yml auto-merge-bot-prs.yml first-contributor-welcome.yml \
          issue-auto-label.yml pr-license-enforcement.yml pr-merged-issue-notifier.yml manual-docker-deploy.yml; do
  api -X PUT "$API/repos/$REPO/actions/workflows/$wf/disable" >/dev/null 2>&1 && echo "    disabled $wf" || true
done

echo "==> Pushing"
VERSION="$(python3 -c "import json; print(json.load(open('SparkyFitnessMobile/package.json'))['version'])")"
TAG="${TAG:-sideload-v${VERSION}-1}"
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git -c user.name="$(git config user.name || echo Hani)" tag -a "$TAG" -m "SparkyFitness personal sideload build $TAG"
fi
ASKPASS="$(mktemp)"
trap 'rm -f "$ASKPASS"' EXIT
# Git asks for user and password; answer from the environment only.
printf '#!/bin/sh\ncase "$1" in Username*) echo x-access-token ;; *) printf %%s "$GITHUB_TOKEN" ;; esac\n' > "$ASKPASS"
chmod 700 "$ASKPASS"
GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c core.hooksPath=/dev/null \
  push "https://github.com/$REPO.git" personal:personal "refs/tags/$TAG"

echo
echo "Done. Build:    https://github.com/$REPO/actions/workflows/ios-sideload.yml"
echo "      Release:  https://github.com/$REPO/releases/tag/$TAG (after ~30-60 min)"
echo "Release server: set GITHUB_REPO=$REPO in deploy/ios-release-server/.env"
