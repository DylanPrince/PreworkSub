---
name: security-audit
description: Review a change or the codebase against Prince AI OS security requirements. Use before merging auth, data-access, integration, agent-tool or payment-adjacent changes.
---

# Security audit

Check each item and report findings with file:line:

- Every new page/action/route calls `requireUser()` (or returns 401) and every data access is scoped by
  membership. Missing vs forbidden must look identical.
- Server-side Zod validation for every input; no trust in client validation.
- No secrets in client bundles (`"use client"` files must not import `@/lib/server`, `@/lib/auth`, or
  `@prince/shared` env helpers), logs, audit metadata or error messages returned to the browser.
- Untrusted text reaches models only through `buildUserPrompt` wrappers.
- Any new agent tool that acts externally is behind backend-enforced approval and audited.
- Budgets enforced before provider calls; new models have a `ModelPrice` row.
- Dependencies: `pnpm audit --prod` and review new packages for maintenance and trust.
- Update `docs/security.md` and `docs/known-issues.md` with anything deferred.
