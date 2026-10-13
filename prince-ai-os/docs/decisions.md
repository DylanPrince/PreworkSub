# Decision log

Short ADR-style entries. Newest last.

### D1 — Monorepo lives in `prince-ai-os/` inside PreworkSub (2026-10-13)

The repository also holds an Android starter app and a separate file-based dashboard on draft PR #1.
Prince AI OS is built as its own pnpm monorepo under `prince-ai-os/` on its own branch so neither is
disturbed. It can be moved to a dedicated repository later without code changes.

### D2 — Postgres is the source of truth; Redis carries ids only

Jobs carry `{ version: 1, runId }`. Everything else is loaded from Postgres, so a Redis flush never
loses state and a worker crash leaves an inspectable run record.

### D3 — Retries create attempts inside one run; manual retries create new runs

Automatic retries (BullMQ backoff) update the same `AgentRun` (`attempts` counter, `retry_scheduled`
events with usage). A user-initiated retry creates a new run so each run's output and cost stay intact.

### D4 — Mock provider for development and tests, never production

`AI_PROVIDER=mock` produces deterministic, schema-valid output labelled "MOCK OUTPUT", reports model
`mock` and $0 cost, and is visibly badged in the UI. Env validation refuses it when `APP_ENV=production`.

### D5 — Single-owner sign-up by default

The first account becomes the owner. Later sign-ups are refused unless `AUTH_ALLOW_SIGNUP=true`.

### D6 — Non-destructive test database setup

Integration and E2E suites run `prisma migrate deploy` + idempotent seed on dedicated databases and
create uniquely named records. They never reset a database.

### D7 — Planned sections are honest placeholders

Every sidebar item has a page. Sections scheduled for later milestones show their scope and milestone,
never sample data. Metrics that are not tracked render "Not tracked yet", not zero.

### D8 — Spend reservations under an advisory lock

Before a paid attempt the worker reserves its worst-case cost in `AgentRun.reservedUsd` inside a
transaction that holds `pg_advisory_xact_lock`. Committed spend is actual cost plus open reservations,
so concurrent workers serialise on the budget check without a separate ledger table. Mock runs skip
the reservation because they cost nothing.

### D9 — Provider chosen per run, pinned at queue time

`AgentRun.provider` is set when the run is requested (`anthropic` or `mock`), and the worker executes
on that provider. `AI_PROVIDER` only sets the default. This lets the owner dry-run a configuration for
free while Claude is the default, and prevents a config change from silently switching queued work.

### D10 — Output contracts decouple validation from templates

Schema, mock output and evaluation checks live together per output contract. Templates and custom
agents both reference a contract key, so custom agents get the same validation without code changes.

### D11 — Built-in agents are read-only; customise by duplicating

Shared agents serve every business and there is no instance-admin role yet, so editing them would let
one business change another's agents. Agent Builder copies them into a business instead.

### D12 — Command Center plans first, then dispatches on the owner's word

A request becomes a `Command` with a planning task run by the Executive Coordinator. The plan's
workstreams are not run automatically: the owner reviews them, picks an agent for each (the
suggestion matches the plan's role to an agent name), sees each worst-case cost and the batch total
against what remains under the limits, and dispatches. A workstream unlocks only after the
workstreams it depends on have succeeded, and their results (up to 6,000 characters each) are
forwarded in its instructions. Each workstream is an ordinary task and run, so budgets, reservations,
retries and audit apply unchanged. `@@unique([commandId, workstream])` makes double dispatch
impossible. A paid batch whose combined worst case exceeds the remaining budget is refused before
anything is created.

### D13 — Effort per agent version; prompt-size cap; thinking tokens recorded

Opus 5.5 and Fable 5.1 always think, and thinking counts toward `max_tokens`. Each agent version
stores an optional effort (`low`, `medium`, `high`, or model default) sent as `output_config.effort`,
and built-in agents use `medium` with larger output allowances (8k to 12k). Built-in agent versions
come only from the registry, so the seed adds a new version when a template changes. Prompts
estimated above 80k tokens are refused before any call, keeping every run inside the flat price tier
(Haiku 5.5 charges more above 100k). Thinking tokens are stored per run for visibility; they are
already part of output tokens and cost.
