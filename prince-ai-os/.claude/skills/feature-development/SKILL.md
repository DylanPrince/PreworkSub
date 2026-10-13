---
name: feature-development
description: Build a Prince AI OS feature as a vertical slice (schema, service, UI, tests, docs). Use when adding or extending any product capability.
---

# Feature development

1. Read `CLAUDE.md`, `docs/implementation-plan.md` and `docs/known-issues.md`. Confirm which milestone the feature belongs to.
2. Data: change `packages/database/prisma/schema.prisma` if needed (see the database-migration skill).
3. Service: add logic to `packages/core/src/<area>.ts`.
   - Zod-validate input and throw `ValidationError` with field errors.
   - Scope by membership with `requireBusinessRole` / `accessibleBusinessIds`.
   - Write an audit event for every mutation.
4. UI: server component page under `apps/web/app/(app)/`, mutations via `apps/web/lib/actions.ts`.
   Include loading, empty and error states. No sample data; untracked metrics show "Not tracked yet".
5. Tests: unit tests next to the code, an integration test in `packages/core/src/*.int.test.ts` for
   authorization and persistence, and a Playwright step in `tests/e2e/` for the main flow.
6. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build`.
7. Update `docs/progress.md` and `docs/known-issues.md`. If a sidebar section goes live, change its
   `status` in `apps/web/lib/nav.ts`.
