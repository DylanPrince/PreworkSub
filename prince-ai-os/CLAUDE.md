# Prince AI OS

AI business operating system: create, operate and monitor multiple businesses through
application-managed AI agents, while the owner keeps control of money, publishing, legal and security.

## Architecture (see docs/architecture.md)

- `apps/web` — Next.js 16 App Router UI, Better Auth, server actions, `/api/v1/*` route handlers.
- `apps/worker` — BullMQ worker that executes agent runs (`executeRun`).
- `packages/core` — service layer (access control, businesses, tasks, runs, executor, budgets, estimates,
  Agent Builder, Command Center, metrics, audit).
- `packages/ai` — provider abstraction, Anthropic SDK provider, mock provider, price table.
- `packages/agents` — agent registry, output schemas and contracts (mock output + evaluation), prompt assembly.
- `packages/database` — Prisma 7 schema, migrations, seed. `packages/shared` — env, queue contracts.

UI → server action → `@prince/core` → Prisma. Never call Prisma or the AI provider from components.

## Commands (run from this directory)

```bash
pnpm install                 # also runs prisma generate
pnpm services:up             # Postgres + Redis via Docker (or use local services)
pnpm db:migrate              # dev migrations; pnpm db:deploy in CI/prod
pnpm db:seed                 # idempotent: price table + executable agents
pnpm dev                     # web (3000) + worker
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test                    # vitest: unit + components + integration (needs Postgres)
pnpm test:e2e                # Playwright on a production build (needs Postgres + Redis)
pnpm build
```

Never run `prisma migrate reset` or anything that wipes a database without the owner's explicit approval.

## Conventions

- TypeScript strict, ESM, Zod for every server input. Validate in `@prince/core`, not only in forms.
- Every business-data query is scoped by membership (`accessibleBusinessIds` / `requireBusinessRole`).
- Mutations write an `audit_events` row. Never put secrets or prompt contents in logs or audit metadata.
- Metrics must not be fabricated: untracked values render "Not tracked yet"; demo/estimated data is labelled.
- Planned features get an honest `PlannedPage`, never sample data.
- New executable agent = registry template + instructions + output contract (`packages/agents/src/contracts.ts`:
  schema, `mockOutput`, `evaluate`) + tests. Owners can also build agents in the UI (Agent Builder).
- Paid Claude calls only through `executeRun`, which reserves worst-case cost first. Never add a code
  path that calls the provider without a reservation.
- Model ids: only ids present in the `ModelPrice` table. Default `claude-opus-5-5`.

## Security boundaries

- Secrets only in server env (`packages/shared/src/env.ts`). Never in client code, commits or chat.
- Untrusted content (business data, task text, future web/tool results) is wrapped by `buildUserPrompt`.
- Consequential actions (payments, purchases, refunds, ad spend, publishing, deployments, credential
  changes, legal submissions, destructive ops) never run directly: the caller records
  `requestApproval(...)` and the action runs only from a handler in `APPROVAL_HANDLERS`
  (`packages/core/src/approvals.ts`) after an admin or owner approves. No agent has a tool that acts
  externally yet; any future one must go through this path.
- Ask the owner before: paid services, deploys, exposing the app publicly, credential changes,
  deleting data, modifying external accounts.

## Definition of done

UI works · backend works · data persists · input validated · authorization enforced · errors handled ·
loading/empty states · tests pass (typecheck, lint, vitest, e2e, build) · docs updated
(`docs/progress.md`, `docs/known-issues.md`) · no fabricated data or fake integration status.

## Two kinds of agents

`.claude/agents/*` are Claude Code development subagents that help build this repo.
`Agent` rows in the database are Prince AI OS workers with jobs, budgets and run history.

## Resuming work

Read `docs/progress.md`, `docs/known-issues.md`, `docs/next-steps.md`; check `git log`; run the test
commands above before building on previous work.
