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

| Package            | Responsibility                                                                                                                                                                      | Depends on                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `@prince/shared`   | Env validation (Zod), queue names + job contracts, data-provenance labels, formatting                                                                                               | zod                             |
| `@prince/ai`       | Provider abstraction (`AIProvider`), Anthropic provider (official SDK, structured outputs), mock provider, price table, cost maths                                                  | @anthropic-ai/sdk, zod          |
| `@prince/agents`   | Agent registry (20-agent roster, 4 executable), output contracts (schema + mock output + evaluation), prompt assembly with untrusted-data wrapping                                  | zod                             |
| `@prince/database` | Prisma schema, migrations, client factory, idempotent seed                                                                                                                          | prisma, agents, ai              |
| `@prince/core`     | Service layer: access control, businesses, tasks, run lifecycle, executor, budgets, estimates, Agent Builder, Command Center, approvals, workflows, metrics, audit, BullMQ producer | all of the above, bullmq        |
| `apps/web`         | UI, auth, server actions, versioned route handlers. Calls `@prince/core` only; never talks to the AI provider directly                                                              | core, shared, agents, ai (test) |
| `apps/worker`      | Consumes `agent-runs` jobs and calls `executeRun`                                                                                                                                   | core, ai, database              |

Boundaries: UI → server actions → `@prince/core` services → Prisma. Services take the Prisma client
and a `RunQueue` as arguments, so they are testable without Next.js or Redis.

## Run lifecycle (first vertical slice)

1. **Create task** (`createTask`): Zod-validated, membership checked (`member` role), audited.
2. **Request run** (`requestRun`): picks the provider (per-run choice, default `AI_PROVIDER`), refuses
   a paid run if Claude is not configured or a spending limit is already reached, refuses dry runs in
   production, checks the agent is active and executable, rejects a second
   concurrent run, creates `AgentRun(status=queued)` keyed by an **idempotency key** (generated per
   form render), then enqueues a BullMQ job whose **job id = run id** (so a run can never be queued
   twice). If Redis is down, the run is marked failed (`queue_unavailable`) so Postgres stays truthful.
3. **Execute** (`executeRun`, in the worker):
   - skip if already terminal; honour a pending cancellation;
   - load the pinned `AgentVersion` (runs record the version they used);
   - use the provider recorded on the run (`anthropic` for paid runs, `mock` for dry runs);
   - refuse if the provider is not configured (`not_configured`), the prompt is estimated above 80k
     tokens (`input_too_large`), the model has no price entry, or the worst-case cost (estimated input
     plus the full output allowance, thinking included) exceeds the agent's per-run budget;
   - for paid runs, atomically reserve the worst-case cost against the global daily/monthly limits
     (advisory-locked transaction; spent + reserved must fit) and mark the run running, or refuse;
   - call the provider with structured outputs and the version's effort; poll Postgres for
     cancellation and abort the request;
   - validate the output schema and the agent's evaluation checks;
   - persist usage (input/output/cache/thinking tokens, summed across attempts), cost, latency, output, events
     and an audit record, and release the reservation. Aborted paid calls without reported usage are
     charged at the reserved worst case and flagged as estimated.
4. **Retry**: transient provider errors (`rate_limited`, `overloaded`, `timeout`, `network`, invalid
   output) return `retry`; the worker throws so BullMQ applies exponential backoff (5 s base) up to the
   version's `maxAttempts`. The final failure is recorded on the run. A manual retry creates a new
   run so every attempt's cost stays in history.
5. **Dead letter**: jobs that exhaust attempts stay in BullMQ's failed set for 30 days and the run is
   `failed` in Postgres (shown under "Failed jobs" on the overview).
6. **UI**: the task page polls `GET /api/v1/runs/:id` (TanStack Query) while a run is active and
   refreshes server components when status or event count changes.

## Command Center flow

1. **Create** (`createCommand`): idempotent on a client key; creates a `Command` and a planning task
   for the Executive Coordinator (or another agent with the `executive-plan.v1` contract) in one
   transaction, audited, then requests its run like any task.
2. **Review** (`getCommand`): once the plan succeeds, each workstream shows its dependencies, whether
   it is ready (all dependencies succeeded), a suggested agent and the worst-case cost per eligible
   agent. `GET /api/v1/commands/:id` returns a change signature the page polls while work is active.
3. **Dispatch** (`dispatchWorkstreams`): member role required; each item must be in the plan, not yet
   dispatched and ready. Earlier results are forwarded in the instructions (6,000 characters each).
   For a paid batch, the combined worst case must fit what remains under the daily and monthly
   limits, else nothing is created. Tasks are created in one transaction (`@@unique([commandId,
workstream])`), then each run is requested through `requestRun`, so the worker's reservation still
   guards every call.

4. **Flagged workstreams**: a workstream the plan marks `requiresHumanApproval` is not dispatched.
   `dispatchWorkstreams` records an approval request for it (action
   `command.dispatch_workstream`) and the dispatch panel shows it as awaiting approval.

## Approval flow

1. **Request** (`requestApproval`, `approval-store.ts`): under an advisory lock on the payload
   fingerprint, returns an identical pending request if one exists, refuses one rejected in the last
   30 days, otherwise creates it (72-hour expiry) and audits `approval.requested`.
2. **Decide** (`decideApproval`, `approvals.ts`): admin or owner only. A conditional update moves
   `pending` to `approved` or `rejected` (zero rows means someone else decided or it expired).
3. **Execute**: on approval, the handler registered for the action key runs as the approver and
   re-validates everything (for a workstream: still ready, not dispatched, agent available, paid batch
   within the remaining budget). The request ends `executed` with a result (the task id) or `failed`
   with the reason. Nothing else can run the action.
4. **UI**: `/approvals` lists pending requests and history; `/approvals/:id` shows what happens on
   approval, why it needs approval, the worst-case cost and expiry, and the decision controls. The
   overview counts pending requests.

## Workflow flow

1. **Define** (`workflows.ts`): a workflow is a list of steps (agent, instructions with `{{input}}`,
   `dependsOn`, `requiresApproval`). `validateStepGraph` rejects duplicate names, unknown or self
   dependencies and loops; agents must be active, executable and available to the business.
2. **Start** (`startWorkflowRun`): idempotent on the client key; checks role, status, agents and, for
   paid runs, that the worst case of all steps fits the remaining limits. The run snapshots the steps
   (`WorkflowRun.definition`), so later edits never affect it.
3. **Advance** (`advanceWorkflowRun`): for each step not yet started whose dependencies succeeded,
   either create its task (unique per run and step) and request its run, or, if it needs approval,
   record an approval request (action `workflow.run_step`). Earlier results are forwarded as labelled
   data (`handoff.ts`). The worker calls `onAgentRunSettled` after each run ends; the web app calls it
   after cancel and retry. Calls are idempotent and safe in parallel.
4. **Settle** (`settleWorkflowRun`): derives the status from the steps and approvals: `running`,
   `waiting_approval`, `succeeded`, or `failed` (a step failed or was cancelled, or its approval was
   rejected, withdrawn, expired or could not run). Cancel is terminal and never overwritten.
5. **UI**: `/workflows` (list and templates), `/workflows/new` and `/workflows/:id/edit` (editor),
   `/workflows/:id` (steps, worst case, start a run, recent runs), `/workflows/runs/:id` (live step
   progress via `/api/v1/workflow-runs/:id`, cancel).

## Business modules

1. **Records** (`packages/core/src/modules/*`): finance entries, products and suppliers, content
   items, campaigns, and software projects with backlog items. Each belongs to a business; members
   create and edit, viewers read; every change is audited. Money is stored as decimals, dates as UTC
   days, and every figure people enter carries its source (`RecordSource`: entered or estimated).
   Records are archived or voided, not deleted.
2. **Calculations** are plain functions over the stored figures (`financeSummary`,
   `productEconomics`) and return the formulas they used, which the pages show. Missing figures are
   reported as missing; nothing is filled in.
3. **Approvals** (`content.approve_publication`, `marketing.approve_launch`) bind what is approved:
   a hash of the content's text, or the campaign's budget, dates and channels. Editing those withdraws
   a pending request and returns an approved record to drafting or planning; the handler re-checks
   them and fails the approval if they changed. Approval only changes the record's state: no handler
   posts, launches or spends, because nothing external is connected.
4. **Ask an agent** (`askAgentAboutRecord`): the record is described as text and attached as data to
   an ordinary task (`Task.subjectType`/`subjectId`), so runs, limits, reservations and audit are
   unchanged and the record's page lists the work done on it.
5. **Views** (`insight.ts`): Research Lab (runs that produced research briefs), Analytics and Calendar
   are read-only queries over existing records.
6. **UI**: `/finance`, `/ecommerce` (+ `/ecommerce/products/:id`), `/content` (+ `/content/:id`),
   `/marketing` (+ `/marketing/:id`), `/saas` (+ `/saas/:id`), `/research`, `/analytics`, `/calendar`.
   Forms post plain values to server actions (`lib/module-actions.ts`); validation happens in core.

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
