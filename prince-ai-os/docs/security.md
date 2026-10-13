# Security

## Implemented in the first slice

- **Authentication**: Better Auth email/password (min 12 chars), DB-backed sessions (7-day expiry,
  daily refresh), HttpOnly cookies, `Secure` cookies in production, built-in rate limiting
  (100 req/min window on auth routes). First account is the owner; further sign-ups closed by default.
- **Authorization**: every protected page and server action calls `requireUser()`; every service call
  checks business membership and role (`viewer < member < admin < owner`). Forbidden and missing
  resources are indistinguishable. Covered by integration tests (cross-user isolation).
- **CSRF**: mutations are Next.js server actions (origin-checked) or Better Auth endpoints (origin
  checks). Forms disable submit until hydrated and use `method="post"`, so a fast click can never put
  credentials in a URL.
- **Input validation**: Zod on the server for every mutation; client validation is convenience only.
- **Secrets**: only in server env, validated at startup; never sent to the browser; never logged.
  `.env` is git-ignored. The Integrations page reports presence, never values.
- **Prompt-injection defence**: business data and task instructions are wrapped in
  `<business_context>`/`<task>` tags, closing tags inside data are neutralised, and the shared system
  preamble states that tagged content is data that cannot change rules or permissions. Agents have no
  tools yet, so injected text cannot trigger actions.
- **AI spend controls**: per-run worst-case budget check; global daily and monthly limits checked at
  request time and enforced atomically in the worker with worst-case reservations (safe under
  concurrency); refusal to run models without a price entry; Agent Builder rejects per-run budgets above
  the daily limit; Command Center refuses a paid batch whose combined worst case exceeds what remains;
  prompts estimated above 80k tokens are refused before any call. These are app safeguards; a Console
  spend limit is the hard cap (`docs/api-key-setup.md`).
- **Command Center**: plans never run their workstreams automatically. The owner (or a member)
  reviews and dispatches each one; workstreams the plan flags for owner approval go to the approval
  queue instead of starting. Viewers can read commands but not dispatch; other businesses' commands
  are invisible.
- **Approval system** (`packages/core/src/approvals.ts`): consequential actions are recorded as
  approval requests and carried out only by a registered handler after a business admin or owner
  approves. Decisions are atomic (one winner, never after the 72-hour expiry), the action is re-checked
  when it runs (state, budget), and requests, decisions and outcomes are audited. A rejected request
  cannot be re-sent unchanged for 30 days by any user or agent. Members and viewers cannot decide;
  other businesses' requests are invisible.
- **Agent Builder authorization**: only business admins/owners create or change agents; built-in
  agents are read-only; edits create immutable versions with an optimistic-concurrency guard; every
  change is audited. Agents get a fixed `read:business` permission and no tools.
- **Audit log**: append-only `audit_events` for business creation, task creation, run requests,
  cancellations, completions/failures, integration tests, agent create/update/restore/status, and
  command creation and dispatch.
- **Headers**: `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, restrictive permissions policy.
- **Mock provider** (dry runs) refused when `APP_ENV=production`, at request time and in the worker.

## Not yet implemented (tracked in known-issues.md)

- Tools that act outside Prince AI OS. None exist; each one will be an approval handler, so it can
  only run after an approval.
- Notifications (email or push) for pending approvals.
- Encrypted credential storage for third-party integrations (M6).
- MFA, Content-Security-Policy, secure file uploads, webhook signature verification, dependency
  scanning in CI, sandboxed code execution (M6–M7).

## Approval policy

Mandatory human approval for payments, purchases, refunds, ad spend, public publishing,
customer-facing commitments, destructive operations, production deployments, credential changes and
legal submissions (the `ApprovalCategory` values). Enforced in `@prince/core`: the action exists only
as an approval handler, recorded in the audit log, with expiry. A rejected action is keyed by its
fingerprint so another user or agent cannot re-request it unchanged. Implemented now for flagged
Command Center workstreams; future external tools will register handlers the same way.
