# Shared helpers for the dev container scripts. Source this file; do not run it.

# Public URL of the dashboard: the forwarded Codespaces URL, or localhost elsewhere.
dashboard_url() {
  if [ -n "${CODESPACE_NAME:-}" ]; then
    echo "https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  else
    echo "http://localhost:3000"
  fi
}

# The dashboard URL without its scheme (host[:port]).
dashboard_host() {
  local url
  url="$(dashboard_url)"
  echo "${url#*://}"
}

# set_env KEY VALUE: replace KEY in .env (current directory), or append it if missing.
set_env() {
  local key="$1" value="$2" tmp
  touch .env
  tmp="$(mktemp)"
  grep -v "^${key}=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}
