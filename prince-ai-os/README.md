# Prince AI OS

Mission control for an AI-operated business portfolio. Status: **Milestone 1 complete, first
vertical slice of M2/M3 working** (see `docs/progress.md`). Not production-ready.

## What works today

- Sign up (owner) / sign in, protected app shell with 19 sections (8 live, 11 marked Planned).
- Business workspaces with member-scoped data isolation.
- Agent registry: 20-agent roster, 4 executable agents (Executive Coordinator, Market Research,
  Copywriting, Financial Analyst) with versioned configuration, budgets, timeouts and retry policy.
- Tasks → background agent runs (BullMQ worker) → structured, validated output, token usage, cost,
  latency, execution timeline, cancel and retry.
- Overview dashboard computed from real records (AI cost, tokens, outcomes, latency, activity).
- Integrations status (Anthropic: requires your API key; everything else honestly not connected).

## Quick start

```bash
cd prince-ai-os
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm install
pnpm services:up                # or point DATABASE_URL / REDIS_URL at local services
pnpm db:deploy && pnpm db:seed
pnpm dev                        # http://localhost:3000
```

Set `AI_PROVIDER=mock` to try the full pipeline without an API key (outputs are clearly labelled mock,
$0). Set `ANTHROPIC_API_KEY` and `AI_PROVIDER=anthropic` for real Claude runs (usage is billed by
Anthropic, capped by `AI_DAILY_BUDGET_USD` / `AI_MONTHLY_BUDGET_USD`).

## Docs

`docs/architecture.md` · `docs/implementation-plan.md` · `docs/technical-decisions.md` ·
`docs/decisions.md` · `docs/integrations.md` · `docs/security.md` · `docs/progress.md` ·
`docs/known-issues.md` · `docs/next-steps.md` · `CLAUDE.md`
