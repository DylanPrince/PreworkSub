# Progress log

Status legend: **Done and tested** means covered by automated tests that pass in CI and checked in a
browser. **Built, not yet verified live** means implemented and tested against fakes, but not yet
exercised against the real external service.

## 2026-10-13 — Session 2: real Claude path, spending protection, Agent Builder

**Done and tested**

- Spending limits ($5 daily, $50 monthly, from env) enforced server-side at two points: a request-time
  refusal when a limit is already reached, and an atomic reservation in the worker before each paid
  attempt (Postgres advisory lock; spent + reserved must fit both limits), so concurrent runs cannot
  jointly overshoot. Reservations are released and replaced by actual cost when the attempt ends.
- Cost accounting fixes: retries now accumulate tokens and cost into the run; cancelled, timed-out or
  disconnected paid calls without reported usage are charged at the reserved worst case and flagged
  as estimated; refusals, truncated output and schema mismatches keep their billed usage (previously
  the SDK's parse helper turned these into a generic error and dropped the usage).
- Runs execute on the provider recorded when they were queued. Each run is either a paid Claude run
  or a free dry run on the mock provider; the choice is per run, the default comes from `AI_PROVIDER`.
  Dry runs are refused when `APP_ENV=production`.
- Provider status indicator in the header on every page (Claude live / Mock mode / Claude not
  configured / limit reached, plus today's spend against the limit) and a detailed panel on
  Integrations and Settings: key configured, real calls possible, within limits, dry runs available,
  daily and monthly meters. The key is never displayed or sent to the browser.
- Real output is badged **Claude**, mock output **Mock output**, everywhere a run appears.
- Agent Builder: create business-scoped agents (name, division, specialization, description,
  instructions, model from the price table, output format, max tokens, per-run budget, timeout,
  attempts); edits save immutable versions with change notes and an optimistic-concurrency guard;
  restore an earlier version as a new version; enable, disable, archive; duplicate built-in agents to
  customise them; test panel with a paid Claude test or a free dry run, recorded as test tasks.
  Built-in agents are read-only. Only business admins and owners can manage agents.
- Output contracts (`packages/agents/src/contracts.ts`) now hold each schema's mock output and
  evaluation checks, shared by built-in and custom agents. New `general-report.v1` contract.
- No agent has tools that act outside the system. The builder states this; spending, publishing,
  purchasing and contacting customers will require explicit approval when such tools exist.
- Guide for configuring the key and verifying protections: `docs/api-key-setup.md`.

**Built, not yet verified live**

- The Anthropic provider is exercised end to end through the real SDK against a fake HTTP layer
  (request shape, auth header, structured output, usage, 400/401/403/404/429/500/529, refusal,
  max_tokens, invalid output, abort, timeout, network errors). No request has been sent to the real
  API because no key is configured here.

**Tests run (all passing)**

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.
- `pnpm test`: 84 tests (unit, components, integration). New: concurrent reservation race (exactly
  one of two runs proceeds when only one fits), reservation lifecycle, request-time refusal at the
  limit, dry runs unaffected by limits, not-configured and production dry-run refusals, cost
  accumulation across retries, estimated cost on cancel, provider pinning, AI status contains no
  secrets, Agent Builder validation, role checks, built-in read-only, versioning, stale-save
  rejection, restore, version pinning of runs, test runs, disable/archive, duplicate, cross-business
  isolation, status pill and panel rendering.
- `pnpm test:e2e`: 5 Playwright tests on a production build, including building, dry-running and
  versioning a custom agent.
- Manual browser check of Agent Builder, manage page, Integrations status panel in dark, light and
  mobile.

**Blockers**

- First real Claude run needs the key in the server environment (see `docs/api-key-setup.md`).

## 2026-10-13 — Session 1: Phase 0 + first vertical slice

**Completed**

- Inspected environment: Node 22, pnpm 10, Docker CLI, local PostgreSQL 16 and Redis 7, Chromium for
  Playwright. No Anthropic API key present.
- Validated the stack against current registry versions and Anthropic model/pricing data
  (`docs/technical-decisions.md`).
- Initialised the `prince-ai-os/` pnpm monorepo: `apps/web`, `apps/worker`, `packages/{shared,ai,agents,database,core}`.
- Prisma schema + initial migration; idempotent seed (price table, 4 executable shared agents).
- Better Auth sign-up/sign-in with single-owner policy.
- App shell with all 19 sidebar sections (8 live, 11 honest "Planned" pages), dark default + light mode,
  mobile drawer.
- Overview with live counts, AI cost/tokens/outcomes/cost-by-agent charts, latency p50/p95, alerts,
  recent runs/failures/activity, business and date filters.
- Business workspaces (create, list, detail with tasks, spend and members).
- Agent registry (20-agent roster, 4 executable with distinct schemas and evaluation checks), agent
  detail with versions and run history.
- Tasks: create (optionally run immediately), detail with live status, output, timeline, cancel, retry.
- BullMQ worker executing runs with budgets, retries, cancellation, cost tracking, audit.
- Integrations page (Anthropic status + test connection; others honestly "Not connected"), Activity
  log, Settings (theme, spend limits, price table), `/api/health`, `/api/v1/runs/:id`.

**Tests run (all passing)**

- `pnpm typecheck` — 7 workspace projects clean.
- `pnpm lint` — 0 problems; `pnpm format:check` clean.
- `pnpm test` — 41 tests: unit (pricing, providers, env, registry, prompts), components (RTL), and
  integration against Postgres (isolation, validation, idempotency, execution, cost, not-configured,
  retry/backoff, evaluation failure, budgets, cancel queued and in-flight).
- `pnpm test:e2e` — 4 Playwright tests on a production build: auth redirect; sign-up → business → task
  → worker run → output → persisted history/activity; failure + retry; all 19 pages render and theme
  toggles.
- `pnpm build` — production build succeeds.
- Manual browser check of overview (dark/light), task page, agents, integrations, planned page, mobile.

**Blockers**

- Real Claude execution needs an API key (your decision; incurs charges).

**Next**: see `docs/next-steps.md`.
