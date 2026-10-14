#!/usr/bin/env bash
# One-time setup when the codespace is created: tools, .env (mock mode), dependencies,
# database schema and seed data, production build.
set -euo pipefail

DEVCONTAINER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$DEVCONTAINER_DIR/lib.sh"
cd "$DEVCONTAINER_DIR/../prince-ai-os"

echo "==> Enabling pnpm"
corepack enable
corepack install

if [ ! -f .env ]; then
  echo "==> Writing .env (mock mode: no API key, no charges)"
  (
    umask 077
    cat > .env <<ENV
APP_ENV=development
DATABASE_URL=postgresql://prince:prince@postgres:5432/prince_ai_os
REDIS_URL=redis://redis:6379
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=$(dashboard_url)
AI_PROVIDER=mock
ANTHROPIC_API_KEY=
AI_DEFAULT_MODEL=claude-opus-5-5
AI_DAILY_BUDGET_USD=5
AI_MONTHLY_BUDGET_USD=50
# The first account to sign up becomes the owner; later sign-ups are refused.
AUTH_ALLOW_SIGNUP=false
SERVER_ACTIONS_ALLOWED_ORIGINS=$(dashboard_host)
NEXT_TELEMETRY_DISABLED=1
ENV
  )
else
  echo "==> Keeping existing .env"
fi

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Preparing the database"
pnpm db:deploy
pnpm db:seed

echo "==> Building the dashboard"
pnpm build

echo "==> Setup finished. The dashboard starts automatically."
