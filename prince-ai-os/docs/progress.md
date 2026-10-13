# Progress log

Status legend: **Done and tested** means covered by automated tests that pass in CI and checked in a
browser. **Built, not yet verified live** means implemented and tested against fakes, but not yet
exercised against the real external service.

## 2026-10-13 — Session 3 (continued): workflow automation

**Done and tested**

- Workflows (`/workflows`): saved multi-agent procedures for a business. Each step names an agent,
  instructions (with `{{input}}` for the run's input), the steps it waits for, and whether it needs
  approval. The server rejects duplicate names, unknown or self dependencies, loops, agents from
  another business, and more than 12 steps. Admins and owners create, edit (optimistic versioning),
  disable and archive workflows; members start runs; viewers read.
- Two templates built on the executable agents: "Product idea validation" (market research, then
  unit economics, then launch copy after approval) and "Campaign copy from research".
- Runs snapshot the steps, so editing a workflow never changes a run in progress. Steps start on
  their own as soon as the steps they wait for succeed (the worker advances the run after every
  agent run ends), each as an ordinary task and run, so spending limits, reservations, retries,
  cancellation and audit apply unchanged. Earlier results are forwarded as labelled data.
- Steps marked for approval become approval requests and start only once an admin or owner
  approves; a rejected, withdrawn, expired or failed request ends the run as failed with the reason.
- Paid runs check up front that the worst case of all steps fits what remains under the spending
  limits, and refuse unpriced models. Each step is still reserved by the worker before its call.
- Run page with live progress, step status, links to results and approvals, cancel (which also
  cancels queued steps and withdraws pending requests). Retrying a failed step resumes the run.

**Tests run (all passing)**

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.
- `pnpm test`: 127 tests. New (14): graph validation (loops, duplicates, unknown/self dependencies);
  edit permissions and audit; agents from other businesses refused; per-step error messages;
  optimistic versioning with run snapshots; templates; dependency order with forwarded results and
  an approval gate; idempotent and concurrent starts; concurrent advancing starts each step once;
  rejection, withdrawal and expiry fail the run; a failed step fails the run and its retry resumes
  it; cancel; disabled workflows, missing key, over-limit and production dry-run refusals.
- `pnpm test:e2e`: 7 Playwright tests; new: add a template, run it as a dry run, approve the gated
  step from the run page, and check every step succeeded and received the earlier results.
- Manual browser check of the list, workflow, editor (including validation) and run pages in dark,
  light and mobile.

## 2026-10-13 — Session 3 (continued): approval system

**Done and tested**

- Approval system enforced in the backend. Consequential actions are recorded as approval requests
  (what happens, why it needs approval, category, worst-case cost, requester, 72-hour expiry) and are
  carried out only by a registered handler after a business admin or owner approves. Racing approvals
  execute once; expired requests cannot be approved; a rejected request cannot be re-sent unchanged
  for 30 days; the action is re-checked when it runs and ends as carried out or failed with the
  reason. Requesters and admins can withdraw a pending request. Every step is audited.
- First enforced action: Command Center workstreams the plan flags for owner approval go to the
  queue instead of starting, and run (as tasks linked to the approval) only once approved.
- Approvals page (`/approvals`): pending requests with business, category, requester, expiry and
  cost, plus decision history. Detail page with Approve and run, Reject (with a note) and Withdraw.
  Overview shows the real pending count and an alert linking to the queue. The Command Center shows
  "Awaiting approval" with a link, and the last outcome when a request was rejected or failed.
- The mock plan now includes a flagged workstream ("Launch copy") so the approval path can be tried
  for free.

**Tests run (all passing)**

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.
- `pnpm test`: 113 tests. New: flagged workstream becomes a pending request and no task; duplicate
  dispatch refused while pending; members, viewers and outsiders cannot decide; approval runs the
  task as the approver with the full audit trail; two racing approvals run it once; rejection blocks
  the same request but allows a changed one; approved-but-over-budget ends failed with no task;
  idempotent requests and key-order-independent fingerprints; expiry; unknown actions fail; withdraw
  rules; listing scoped to members with decide rights; overview count.
- `pnpm test:e2e`: 6 Playwright tests; the Command Center test now sends the flagged workstream for
  approval, approves it from the overview alert and queue, and checks the task ran.
- Manual browser check of the queue, detail and Command Center states in dark, light and mobile.

## 2026-10-13 — Session 3: AI Command Center, Anthropic docs verification

**Done and tested**

- AI Command Center (`/command`): describe an outcome, choose a business, and plan it with Claude or
  a free dry run. The Executive Coordinator returns a plan (summary, workstreams with roles and
  dependencies, risks, decisions for the owner). The owner reviews each workstream, picks an agent
  (suggested from the plan's role), sees the worst-case cost of each and of the batch against what
  remains under the limits, and dispatches. Dependent workstreams unlock only when the ones they
  depend on succeed, and receive those results as context. Pages refresh while work is active.
  Recent requests list with plan state and progress. Viewers can read; members and above dispatch.
- Paid dispatch is refused before anything is created when the batch's combined worst case exceeds
  what remains under the daily or monthly limit. Double dispatch is impossible (unique constraint).
- Model IDs, availability and prices verified against the official Anthropic docs (details in
  `docs/technical-decisions.md`). One correction: Sonnet 5.5 cache reads are $0.10/MTok, not $0.20.
  The seed corrects price rows that still hold an earlier default and never overwrites edited ones.
- Effort setting per agent version (Model default, Low, Medium, High), sent as
  `output_config.effort`, editable in Agent Builder and shown on agent pages.
- Thinking tokens recorded per run and shown on the run card ("incl. N thinking"); they are already
  counted in output tokens and cost.
- Prompts estimated above 80k tokens are refused before any call or reservation, keeping runs in
  every model's flat price tier.
- Built-in agents now use `medium` effort and larger output allowances (8,192; Market Research
  12,000) because Opus 5.5 always thinks and thinking counts toward the limit. Existing installations
  get this as a new agent version when the seed runs; earlier runs stay pinned to their version.

**Built, not yet verified live**

- Effort and thinking-token handling are tested through the real SDK against a fake HTTP layer. No
  paid request has been made: the key is not configured and a live test needs your authorization.

**Tests run (all passing)**

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.
- `pnpm test`: 103 tests. New: Command Center (idempotent create, paid plan refused without a key,
  plan to workstreams with suggestions and estimates, dependency-ordered dispatch with forwarded
  results, double-dispatch refusal, paid batch refused over budget, viewer and outsider access), seed
  (corrects a stale default price, keeps an edited price, adds a built-in version only when the
  template changed), oversized prompt refused before any call, effort sent and thinking tokens
  accumulated across retries, effort validation, verified price table pinned, effort and thinking
  over HTTP.
- `pnpm test:e2e`: 6 Playwright tests on a production build, including planning a request and
  dispatching two dependent workstreams as dry runs. The e2e suite now signs in through the form once
  and reuses the session, because the sign-in rate limit (kept as is) refused rapid repeated sign-ins.
- Manual browser check of the Command Center and the agent form in dark, light and mobile.

**Needs you**

- A first live Claude run: add the key (see `docs/api-key-setup.md`) and tell me when you authorize
  a live test.

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
