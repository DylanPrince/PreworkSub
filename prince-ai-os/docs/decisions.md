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
