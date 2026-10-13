# Implementation plan

Built in vertical slices. A milestone is done only when it meets the Definition of Done in `CLAUDE.md`.

| Milestone                     | Scope                                                                                                                                                                      | Status                                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1 Foundation**             | Monorepo, Next.js app, Postgres + Prisma migrations, Better Auth, app shell with 19-section sidebar, dark/light themes, env validation, Docker Compose services, tests, CI | **Done** (first slice)                                                                                                                                                                                         |
| **M2 Functional dashboard**   | Overview with live metrics and charts, business workspaces, agent registry + detail, tasks, activity log                                                                   | **Partially done**: overview, businesses, agent registry/detail, tasks, activity are live. Remaining: business switching in the shell, editing/archiving businesses, task filters/search, drill-down analytics |
| **M3 First working AI agent** | Anthropic integration, execution service, real background job, persistent run history, structured output, token/cost tracking, error handling, Command Center interaction  | **Done except the live check**: execution, spending protection, provider status, Agent Builder and Command Center are live and tested. Remaining: first real Claude run (needs your key and authorization).    |
| **M4 Orchestration**          | Multi-agent workflows (sequential, parallel, conditional), scheduling, approval system enforced in backend, retry/cancel controls, workflow visualisation, loop limits     | **In progress**: approval system and workflows (dependencies, approval gates, run once per step, cancel, resume on retry) done and tested (session 3). Remaining: scheduling, conditions, graph visualisation  |
| **M5 Business modules**       | Research workspace, Content Studio, e-commerce foundation, marketing foundation, finance dashboard with source-labelled records, SaaS workspace                            | **Done** (session 3): finance, e-commerce, content, marketing, SaaS, research, analytics and calendar are live and tested, with approvals for publishing and spend. External connections are M6                |
| **M6 External integrations**  | Shopify, Meta, Google/YouTube, TikTok, GitHub, Stripe (read-only), email, S3 — each verified against official docs, encrypted credentials, test connection                 | Not started                                                                                                                                                                                                    |
| **M7 Production hardening**   | Security audit, MFA, rate-limit tuning, monitoring/alerting, backups, deployment config, performance tests, runbook                                                        | Not started                                                                                                                                                                                                    |

## Next slice (recommended order)

1. ~~Agent Builder~~ (done, session 2).
2. ~~AI Command Center v1~~ (done, session 3: plan, review, dispatch in dependency order).
3. ~~Approval system~~ (done, session 3).
4. ~~Workflows~~ (done, session 3).
5. ~~M5 business modules~~ (done, session 3). The remaining 16 roster agents are deferred at the
   owner's request.
6. First live Claude run (needs your key and authorization).
7. Business switcher in the shell + per-business budgets; workflow scheduling.
