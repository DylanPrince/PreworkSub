#!/usr/bin/env bash
# Runs on every codespace start: refresh the URL settings, apply migrations, and start the
# dashboard (web) and the background worker. Safe to run again by hand to restart both.
set -euo pipefail

DEVCONTAINER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$DEVCONTAINER_DIR/lib.sh"
cd "$DEVCONTAINER_DIR/../prince-ai-os"

if [ ! -f .env ] || [ ! -d node_modules ]; then
  echo "Setup has not finished yet. Run: bash .devcontainer/setup.sh" >&2
  exit 1
fi

LOG_DIR=/tmp/prince-ai-os
mkdir -p "$LOG_DIR"

# The codespace URL can change (renamed or rebuilt codespace), so refresh it each start.
set_env BETTER_AUTH_URL "$(dashboard_url)"
set_env SERVER_ACTIONS_ALLOWED_ORIGINS "$(dashboard_host)"

echo "==> Stopping any previous web and worker"
for name in web worker; do
  pidfile="$LOG_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    # Each process was started as its own process group leader (setsid), so kill the group.
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
done
pkill -f "next start" 2>/dev/null || true
pkill -f "src/index.ts" 2>/dev/null || true
sleep 1

echo "==> Applying database migrations"
pnpm db:deploy

if [ ! -d apps/web/.next ]; then
  echo "==> Building the dashboard (first start)"
  pnpm build
fi

echo "==> Starting web and worker (logs in $LOG_DIR)"
setsid nohup pnpm start > "$LOG_DIR/web.log" 2>&1 < /dev/null &
echo $! > "$LOG_DIR/web.pid"
setsid nohup pnpm --filter @prince/worker start > "$LOG_DIR/worker.log" 2>&1 < /dev/null &
echo $! > "$LOG_DIR/worker.pid"

echo "==> Waiting for the dashboard to become healthy"
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/api/health > /dev/null 2>&1; then
    echo ""
    echo "Prince AI OS is running (mock mode)."
    echo "Open it from the Ports tab (port 3000, globe icon): $(dashboard_url)"
    echo "Check status any time with: bash .devcontainer/status.sh"
    exit 0
  fi
  sleep 2
done

echo "The dashboard did not become healthy within 2 minutes." >&2
echo "See $LOG_DIR/web.log and $LOG_DIR/worker.log, or run: bash .devcontainer/status.sh" >&2
exit 1
