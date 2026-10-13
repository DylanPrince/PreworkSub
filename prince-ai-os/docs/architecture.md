# Architecture

Prince AI OS is a TypeScript monorepo with one web app, one background worker, and shared packages.
PostgreSQL is the system of record; Redis only carries job ids for BullMQ.

```
                ┌──────────────────────────┐        ┌────────────────────────────┐
 Browser ──────▶│ apps/web (Next.js 16)    │        │ apps/worker (Node + tsx)   │
  (React UI)    │  • App Router pages      │        │  • BullMQ Worker           │
                │  • Server actions        │ Redis  │  • executeRun()            │──▶ Claude API
                │  • /api/v1 route handlers│──jobs─▶│  • retries / backoff       │   (or mock provider)
                │  • Better Auth sessions  │        │  • cancellation polling    │
                └───────────┬──────────────┘        └──────────────┬─────────────┘
                            │                                       │
                            ▼                                       ▼
                 ┌─────────────────────────────────────────────────────────────┐
                 │ PostgreSQL (Prisma 7 + @prisma/adapter-pg)                  │
                 │ users/sessions · businesses/memberships · agents/versions   │
                 │ tasks · agent_runs · run_events · audit_events · model_price│
                 └─────────────────────────────────────────────────────────────┘
```

## Packages

| Package            | Responsibility                                                                                                                     | Depends on                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `@prince/shared`   | Env validation (Zod), queue names + job contracts, data-provenance labels, formatting                                              | zod                             |
| `@prince/ai`       | Provider abstraction (`AIProvider`), Anthropic provider (official SDK, structured outputs), mock provider, price table, cost maths | @anthropic-ai/sdk, zod          |
| `@prince/agents`   | Agent registry (20-agent roster, 4 executable), output schemas, prompt assembly with untrusted-data wrapping, evaluation checks    | zod                             |
| `@prince/database` | Prisma schema, migrations, client factory, idempotent seed                                                                         | prisma, agents, ai              |
| `@prince/core`     | Service layer: access control, businesses, tasks, run lifecycle, executor, budgets, metrics, audit, BullMQ producer                | all of the above, bullmq        |
| `apps/web`         | UI, auth, server actions, versioned route handlers. Calls `@prince/core` only; never talks to the AI provider directly             | core, shared, agents, ai (test) |
| `apps/worker`      | Consumes `agent-runs` jobs and calls `executeRun`                                                                                  | core, ai, database              |

Boundaries: UI → server actions → `@prince/core` services → Prisma. Services take the Prisma client
and a `RunQueue` as arguments, so they are testable without Next.js or Redis.

## Run lifecycle (first vertical slice)

1. **Create task** (`createTask`): Zod-validated, membership checked (`member` role), audited.
2. **Request run** (`requestRun`): checks the agent is active and executable, rejects a second
   concurrent run, creates `AgentRun(status=queued)` keyed by an **idempotency key** (generated per
   form render), then enqueues a BullMQ job whose **job id = run id** (so a run can never be queued
   twice). If Redis is down, the run is marked failed (`queue_unavailable`) so Postgres stays truthful.
3. **Execute** (`executeRun`, in the worker):
   - skip if already terminal; honour a pending cancellation;
   - load the pinned `AgentVersion` (runs record the version they used);
   - refuse if the provider is not configured (`not_configured`), the model has no price entry, the
     worst-case cost exceeds the agent's per-run budget, or the global daily/monthly budget;
   - call the provider with structured outputs; poll Postgres for cancellation and abort the request;
   - validate the output schema and the agent's evaluation checks;
   - persist usage (input/output/cache tokens), cost, latency, output, events and an audit record.
4. **Retry**: transient provider errors (`rate_limited`, `overloaded`, `timeout`, `network`, invalid
   output) return `retry`; the worker throws so BullMQ applies exponential backoff (5 s base) up to the
   version's `maxAttempts`. The final failure is recorded on the run. A manual retry creates a new
   run so every attempt's cost stays in history.
5. **Dead letter**: jobs that exhaust attempts stay in BullMQ's failed set for 30 days and the run is
   `failed` in Postgres (shown under "Failed jobs" on the overview).
6. **UI**: the task page polls `GET /api/v1/runs/:id` (TanStack Query) while a run is active and
   refreshes server components when status or event count changes.

## Two kinds of "agent"

- **Claude Code development subagents** (`.claude/agents/*.md`) help _build_ this repository. They run
  only inside a developer's Claude Code session.
- **Prince AI OS agents** (`Agent`/`AgentVersion` rows) are application-managed workers with persistent
  jobs, permissions, budgets and run records, executed by `apps/worker`.

## Data isolation

Every query for business data is filtered by the caller's memberships (`accessibleBusinessIds`) or
guarded by `requireBusinessRole`. Missing and forbidden resources return the same error so ids
cannot be probed. Shared agents (`businessId = null`) only ever see the business context of the task
they are running.

## Observability (current)

- Structured JSON logs from the worker (no prompt contents or secrets).
- `GET /api/health` checks Postgres and Redis.
- `run_events` timeline per run, `audit_events` for user/agent/system actions.
