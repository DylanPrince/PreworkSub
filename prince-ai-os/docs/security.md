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
- **AI spend controls**: per-run worst-case budget check, global daily and monthly hard limits, refusal
  to run models without a price entry.
- **Audit log**: append-only `audit_events` for business creation, task creation, run requests,
  cancellations, completions/failures, and integration tests.
- **Headers**: `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, restrictive permissions policy.
- **Mock provider** refused when `APP_ENV=production`.

## Not yet implemented (tracked in known-issues.md)

- Approval system for consequential actions (M4). Until it exists, no agent has any tool that can act
  externally.
- Encrypted credential storage for third-party integrations (M6).
- MFA, Content-Security-Policy, secure file uploads, webhook signature verification, dependency
  scanning in CI, sandboxed code execution (M6–M7).

## Approval policy (target design, M4)

Mandatory human approval for payments, purchases, refunds, ad spend, public publishing,
customer-facing commitments, destructive operations, production deployments, credential changes and
legal submissions. Enforced in `@prince/core` before any tool executes, recorded in the audit log, with
expiry. A denied action is keyed by action fingerprint so another agent cannot re-request it.
