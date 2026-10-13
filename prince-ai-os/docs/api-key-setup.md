# Enabling real Claude calls safely

This guide covers where the Anthropic API key goes, how to confirm the spending protections are
active **before** the first paid request, and how to verify them without spending anything.

The key is read only by server processes (the Next.js server and the worker). It is never sent to
the browser, never shown in the UI, never written to logs or audit records, and must never be
committed or pasted into chat.

## 1. Create a dedicated key and an account-level cap

1. In the Anthropic Console, create a new API key used only by Prince AI OS, so it can be revoked
   on its own.
2. In the Console, set a spend limit for the workspace that owns the key. This is the only hard
   billing cap. Prince AI OS's own limits are application safeguards (see section 5).

## 2. Put the key in the server environment

Both processes must see the same values, and both must be restarted after a change: the
environment is read once at startup.

### Your own machine or a self-hosted server

Edit `prince-ai-os/.env` (create it from `.env.example` if missing). It is git-ignored; confirm
with:

```bash
cd prince-ai-os
git check-ignore -v .env   # must print a .gitignore rule; if it prints nothing, stop
```

Set:

```bash
ANTHROPIC_API_KEY=<paste the key here, in the file only>
AI_PROVIDER=anthropic        # makes Claude the default; keep "mock" to default to dry runs
AI_DAILY_BUDGET_USD=5
AI_MONTHLY_BUDGET_USD=50
```

Then restart: stop `pnpm dev` (or your process manager) and start it again so the web app and the
worker both reload. Do not use a `NEXT_PUBLIC_` prefix for any of these values; that would ship
them to the browser.

### A hosting platform

Add `ANTHROPIC_API_KEY`, `AI_PROVIDER`, `AI_DAILY_BUDGET_USD` and `AI_MONTHLY_BUDGET_USD` as
secret environment variables on **both** the web service and the worker service, then redeploy
both. (Deploying publicly is a separate decision that needs your approval; nothing in this repo
deploys on its own.)

### Optional: let Claude Code run a live check in this project

If you want Claude Code to run a paid verification for you in this project's cloud sessions, add
`ANTHROPIC_API_KEY` as an environment variable in the project's cloud environment (Project
settings → Cloud environment → the gear beside the selected environment). A new session picks it
up. Anything with access to that environment can use the key, so a separate low-limit key is
sensible there.

## 3. Verify protections before the first paid request (no cost)

1. **Startup log.** The worker prints one line on start:
   `"event":"worker.ready", ... "anthropicConfigured":true, "dailyBudgetUsd":5, "monthlyBudgetUsd":50`.
   If `anthropicConfigured` is `false`, the worker did not see the key.
2. **Header indicator.** Every page shows a status pill. Expect `Claude live · $0.00 / $5.00 today`.
   `Claude not configured` means the web server did not see the key; `Mock mode` means
   `AI_PROVIDER=mock` (paid runs are still available per task when a key is present).
3. **Integrations page → AI provider and spending protection.** Expect:
   - Anthropic API key configured: **Yes**
   - Agents can make real Claude calls: **Yes**
   - Within spending limits: **Yes**, with meters showing $5.00 daily and $50.00 monthly.
4. **Test connection** (Integrations page). This calls the models endpoint, which generates no
   tokens. Expect `Connected. Claude Opus 5.5 is available.` An authentication error means the key
   is wrong or revoked.
5. **Prove a limit blocks a call, for free.** Temporarily set `AI_DAILY_BUDGET_USD=0.01`, restart,
   and click **Run with Claude** on any task. The run fails with `budget_exceeded` ("Daily AI budget
   would be exceeded … this run could cost up to $…") and the timeline shows it was blocked before
   any API request. Cost recorded: none. Set the limit back to `5` and restart.

## 4. First paid run

1. Start with a dry run: **Dry run (mock)** on the task page or in Agent Builder. It is free and its
   output is labelled **Mock output**.
2. For the first real call, use a small task and, ideally, a custom agent on Claude Haiku 5.5 with a
   low max-output-token setting (Agent Builder → New agent). Click **Run with Claude** (or **Test
   with Claude** in Agent Builder).
3. On the run card confirm: the **Claude** badge (not Mock output), input/output tokens, a cost in
   dollars, and a `started` timeline event that lists the amount reserved before the call.
4. The header pill and the Integrations meters now include that cost.

## 5. What the limits do and do not do

- Before every paid attempt the worker estimates the worst case (estimated input tokens with
  headroom plus the agent's max output tokens, at the model's price) and **reserves** it inside a
  database transaction guarded by a Postgres advisory lock. Spent plus reserved must stay within
  both the daily and the monthly limit, so concurrent runs cannot jointly overshoot.
- When the call ends, the reservation is replaced by the actual cost from the provider's reported
  usage. Retries add to the same run's total. If a call is cancelled, times out or loses its
  connection before usage is reported, the reserved worst case is recorded as an **estimated** cost.
- Each agent also has a per-run budget; a run whose worst case exceeds it is refused before any
  call.
- When a limit is reached, new paid runs are refused at request time and again in the worker.
  Dry runs keep working and cost nothing.
- Days and months are UTC.
- These are application safeguards, not a billing cap. Requests made with the same key outside
  Prince AI OS, price changes not yet reflected in the price table (Settings), and the estimate
  for aborted calls can make Anthropic's bill differ. The Console spend limit from step 1 is the
  hard cap.

## 6. Rotating or revoking the key

Create the new key, replace the value in the server environment, restart both processes, run
**Test connection**, then revoke the old key in the Console. To stop all paid calls immediately,
remove `ANTHROPIC_API_KEY` (or revoke it) and restart; queued paid runs then fail with
`not_configured` instead of calling the API.
