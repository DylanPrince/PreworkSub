---
name: test-and-debug
description: Run and debug the Prince AI OS test suites. Use when tests fail or before declaring work done.
---

# Test and debug

- Services: Postgres on 5432 (user/password `prince`), Redis on 6379. Databases: `prince_ai_os` (dev),
  `prince_ai_os_it` (vitest integration), `prince_ai_os_test` (Playwright). E2E uses Redis db 1.
- `pnpm test` runs vitest projects `unit`, `components`, `integration`. Narrow with
  `npx vitest run --project integration -t "<name>"`.
- `pnpm test:e2e` builds the web app and starts web (3100) + worker with the mock provider. If Chromium
  is preinstalled elsewhere set `PW_CHROMIUM_PATH`. Traces land in `test-results/`.
- Reproduce before fixing. Never delete or weaken a test to make it pass; find the cause.
- Worker logs are JSON lines; run status history is in `run_events`.
