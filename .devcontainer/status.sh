#!/usr/bin/env bash
# Quick health report for Prince AI OS in this dev container.
set -uo pipefail

DEVCONTAINER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$DEVCONTAINER_DIR/lib.sh"
cd "$DEVCONTAINER_DIR/../prince-ai-os"

LOG_DIR=/tmp/prince-ai-os
failures=0
check() {
  local label="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "OK    $label"
  else
    echo "FAIL  $label"
    failures=$((failures + 1))
  fi
}

postgres_ok() {
  # Real query with the app's own pg driver and DATABASE_URL from .env.
  DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" node -e '
    const { Client } = require(process.argv[1]);
    const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    c.connect().then(() => c.query("SELECT 1")).then(() => process.exit(0), () => process.exit(1));
  ' "$PWD/packages/database/node_modules/pg"
}

redis_ok() {
  REDIS_URL="$(grep '^REDIS_URL=' .env | cut -d= -f2-)" node -e '
    const u = new URL(process.env.REDIS_URL);
    const s = require("node:net").connect(Number(u.port || 6379), u.hostname, () => s.write("PING\r\n"));
    s.on("data", (d) => process.exit(String(d).startsWith("+PONG") ? 0 : 1));
    s.on("error", () => process.exit(1));
    setTimeout(() => process.exit(1), 3000);
  '
}

web_ok() { curl -fsS --max-time 5 http://localhost:3000/api/health; }

worker_ok() {
  pgrep -f "src/index.ts" && grep -q "worker.ready" "$LOG_DIR/worker.log"
}

mock_ok() { grep -qx "AI_PROVIDER=mock" .env; }

check "Postgres is accepting connections" postgres_ok
check "Redis answers PING" redis_ok
check "Dashboard /api/health" web_ok
check "Worker is running and ready" worker_ok
check "Mock mode (AI_PROVIDER=mock, no charges)" mock_ok

echo ""
echo "Dashboard: $(dashboard_url)"
echo "Logs:      $LOG_DIR/web.log  $LOG_DIR/worker.log"
if [ "$failures" -gt 0 ]; then
  echo "Restart everything with: bash .devcontainer/start.sh"
  exit 1
fi
