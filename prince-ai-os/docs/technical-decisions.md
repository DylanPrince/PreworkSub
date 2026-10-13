# Technical decisions (Phase 0 research)

Validated on 2026-10-13 against the package registry and vendor documentation available in this
environment. Versions are pinned in `package.json` files.

| Area             | Choice                                                                                                     | Version                      | Alternatives considered                         | Why                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Node.js                                                                                                    | 22 LTS                       | Bun                                             | Installed, LTS, supported by every dependency                                                                                                                                                 |
| Package manager  | pnpm workspaces                                                                                            | 10.28                        | npm, Turborepo                                  | Strict dependency isolation; no extra build orchestrator needed yet                                                                                                                           |
| Web              | Next.js App Router                                                                                         | 16.4.0                       | Remix, Vite SPA + API                           | Brief's preference; server actions give built-in CSRF origin checks                                                                                                                           |
| UI               | React, Tailwind CSS v4, shadcn-style components, Lucide, Recharts                                          | 19.3 / 4.3 / – / 1.56 / 3.10 | MUI, Chakra                                     | Brief's preference. shadcn components are hand-authored in `components/ui` (same pattern: Radix Slot + CVA + tailwind-merge) because the shadcn registry CLI is not needed for six primitives |
| Data fetching    | Server components + TanStack Query for polling                                                             | 5.104                        | SWR                                             | Brief's preference; only used where the client needs live data                                                                                                                                |
| Forms/validation | React Hook Form + Zod 4                                                                                    | 7.90 / 4.6                   | Formik                                          | Zod schemas are shared by server validation                                                                                                                                                   |
| Database         | PostgreSQL + Prisma ORM                                                                                    | 16 / 7.10                    | Drizzle                                         | Brief's preference. Prisma 7 requires a driver adapter (`@prisma/adapter-pg`) and `prisma.config.ts`; `prisma@latest` on npm is an 8.0 RC, so the stable 7.10 line is pinned                  |
| Queue            | Redis + BullMQ                                                                                             | 7 / 6.3                      | pg-boss, Inngest                                | Brief's preference; retries, backoff, job ids for idempotency, failed set as dead letter                                                                                                      |
| Auth             | Better Auth (email + password, DB sessions)                                                                | 1.7.7                        | Auth.js v5 (still beta), Clerk (paid, external) | Stable, self-hosted, Prisma adapter, plugins for 2FA/RBAC later                                                                                                                               |
| AI               | Official Anthropic TypeScript SDK, Messages API, structured outputs (`messages.parse` + `zodOutputFormat`) | 0.133.0                      | Raw HTTP, Vercel AI SDK                         | Official SDK, typed errors, provider-reported usage including cache tokens                                                                                                                    |
| Default model    | `claude-opus-5-5`                                                                                          | –                            | –                                               | Current default Opus model per Anthropic model table (cached 2026-10-06). Configurable per agent version and via `AI_DEFAULT_MODEL`                                                           |
| Tests            | Vitest 5, React Testing Library, Playwright 1.64                                                           | –                            | Jest                                            | Fast, ESM-native; Playwright uses the preinstalled Chromium                                                                                                                                   |
| Lint/format      | ESLint 9 flat config (+ eslint-config-next 16, typescript-eslint), Prettier                                | 9.39 / 3.6                   | Biome                                           | `eslint-config-next` only supports ESLint 9 flat config cleanly; TypeScript is pinned to 6.0 because typescript-eslint does not yet support TS 7                                              |

## Claude API details relied on

- Model ids used without date suffixes: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`,
  `claude-fable-5-1` (only ids with a price entry are offered).
- Prices (USD / MTok, first-party API): Opus 5.5 $4 in / $20 out / $0.20 cache read; Sonnet 5.5 $2 / $10 /
  $0.20; Haiku 5.5 $0.10 / $0.50; Fable 5.1 $10 / $50 / $0.25. Cache writes priced at 1.25× input
  (5-minute TTL). Stored in the `ModelPrice` table with source and verification date.
- Usage fields: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`.
- Opus 5.5 rejects disabled thinking and forced `tool_choice`; the provider sends neither and relies on
  structured outputs for JSON.
- `stop_reason: "refusal"` and `"max_tokens"` are handled as non-retryable failures.
- SDK retries are disabled (`maxRetries: 0`); BullMQ owns retries so every attempt is visible.
- **Not enabled yet:** the server-side `fallbacks` beta (routes refused requests to another model). It
  changes which model is billed; it will be added with explicit cost attribution in Milestone 3.

## Deliberate simplifications

- One web app + one worker. No microservices.
- Agents have no tools yet (analysis-only). Tool use arrives with the orchestration milestone.
- Spend limits are environment variables; per-business budgets and UI editing come later.
