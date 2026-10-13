# Technical decisions (Phase 0 research)

Validated on 2026-10-13 against the package registry and vendor documentation available in this
environment. Versions are pinned in `package.json` files.

| Area             | Choice                                                                                                                                                     | Version                      | Alternatives considered                         | Why                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Node.js                                                                                                                                                    | 22 LTS                       | Bun                                             | Installed, LTS, supported by every dependency                                                                                                                                                 |
| Package manager  | pnpm workspaces                                                                                                                                            | 10.28                        | npm, Turborepo                                  | Strict dependency isolation; no extra build orchestrator needed yet                                                                                                                           |
| Web              | Next.js App Router                                                                                                                                         | 16.4.0                       | Remix, Vite SPA + API                           | Brief's preference; server actions give built-in CSRF origin checks                                                                                                                           |
| UI               | React, Tailwind CSS v4, shadcn-style components, Lucide, Recharts                                                                                          | 19.3 / 4.3 / – / 1.56 / 3.10 | MUI, Chakra                                     | Brief's preference. shadcn components are hand-authored in `components/ui` (same pattern: Radix Slot + CVA + tailwind-merge) because the shadcn registry CLI is not needed for six primitives |
| Data fetching    | Server components + TanStack Query for polling                                                                                                             | 5.104                        | SWR                                             | Brief's preference; only used where the client needs live data                                                                                                                                |
| Forms/validation | React Hook Form + Zod 4                                                                                                                                    | 7.90 / 4.6                   | Formik                                          | Zod schemas are shared by server validation                                                                                                                                                   |
| Database         | PostgreSQL + Prisma ORM                                                                                                                                    | 16 / 7.10                    | Drizzle                                         | Brief's preference. Prisma 7 requires a driver adapter (`@prisma/adapter-pg`) and `prisma.config.ts`; `prisma@latest` on npm is an 8.0 RC, so the stable 7.10 line is pinned                  |
| Queue            | Redis + BullMQ                                                                                                                                             | 7 / 6.3                      | pg-boss, Inngest                                | Brief's preference; retries, backoff, job ids for idempotency, failed set as dead letter                                                                                                      |
| Auth             | Better Auth (email + password, DB sessions)                                                                                                                | 1.7.7                        | Auth.js v5 (still beta), Clerk (paid, external) | Stable, self-hosted, Prisma adapter, plugins for 2FA/RBAC later                                                                                                                               |
| AI               | Official Anthropic TypeScript SDK, Messages API, structured outputs (`messages.create` with a `zodOutputFormat` schema, parsed after `stop_reason` checks) | 0.133.0                      | Raw HTTP, Vercel AI SDK                         | Official SDK, typed errors, provider-reported usage including cache tokens                                                                                                                    |
| Default model    | `claude-opus-5-5`                                                                                                                                          | –                            | –                                               | Current default Opus model per Anthropic model table (cached 2026-10-06). Configurable per agent version and via `AI_DEFAULT_MODEL`                                                           |
| Tests            | Vitest 5, React Testing Library, Playwright 1.64                                                                                                           | –                            | Jest                                            | Fast, ESM-native; Playwright uses the preinstalled Chromium                                                                                                                                   |
| Lint/format      | ESLint 9 flat config (+ eslint-config-next 16, typescript-eslint), Prettier                                                                                | 9.39 / 3.6                   | Biome                                           | `eslint-config-next` only supports ESLint 9 flat config cleanly; TypeScript is pinned to 6.0 because typescript-eslint does not yet support TS 7                                              |

## Claude API details relied on

Verified on 2026-10-13 against the official documentation: models overview
(https://platform.claude.com/docs/en/about-claude/models/overview), pricing
(https://platform.claude.com/docs/en/about-claude/pricing), the Opus 5.5 page, effort and structured
outputs.

- Model ids used without date suffixes, all listed as **Active**: `claude-opus-5-5` (retires no
  sooner than 2027-09-22), `claude-sonnet-5-5` (2027-09-28), `claude-haiku-5-5` (2027-10-07),
  `claude-fable-5-1` (2027-09-01). All four have a 1M-token context window, 128K max output, and
  support structured outputs. Only ids with a price entry are offered.
- Prices (USD / MTok, first-party API, global inference): Opus 5.5 $4 in / $20 out / $5 cache write /
  $0.20 cache read; Sonnet 5.5 $2 / $10 / $2.50 / **$0.10** (the seed had $0.20 until 2026-10-13; the
  seed now corrects rows still holding that value and leaves edited rows alone); Haiku 5.5 $0.10 /
  $0.50 / $0.125 / $0.01 for prompts up to 100k tokens ($0.50 / $2.50 above that); Fable 5.1 $10 /
  $50 / $12.50 / $0.25. Cache writes priced at the 5-minute TTL rate. US-only inference
  (`inference_geo`) costs 1.1x and is not used. Stored in the `ModelPrice` table with source and
  verification date.
- Prompts estimated above 80k tokens are refused before any call, so Haiku 5.5's long-context rate
  never applies and the flat price rows stay valid.
- Opus 5.5 and Fable 5.1 always use adaptive thinking (`thinking: {type: "disabled"}` is rejected).
  Thinking counts toward `max_tokens` and is billed as output; `usage.output_tokens_details.thinking_tokens`
  reports it and is recorded per run. The reservation already covers it because `max_tokens` bounds
  all output.
- Effort is sent as `output_config.effort` (`low`, `medium`, `high`; the API also accepts `xhigh`
  and `max`, not offered yet). Defaults when omitted: medium on Opus 5.5 and Haiku 5.5, high on the
  others. Built-in agents set `medium` with 8k to 12k output tokens.
- Structured outputs: schemas must avoid `minLength`/`maxLength`, numeric bounds, `minItems` other
  than 0 or 1, and recursion; the current output schemas use none of these. A refusal or
  `max_tokens` stop may not match the schema, which is why `stop_reason` is checked before parsing.
- Usage fields: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
  `output_tokens_details.thinking_tokens`.
- `stop_reason: "refusal"` and `"max_tokens"` are handled as non-retryable failures with their usage.
- SDK retries are disabled (`maxRetries: 0`); BullMQ owns retries so every attempt is visible.
- **Not enabled:** the server-side `fallbacks` beta (routes refused requests to another model). It
  changes which model is billed and needs explicit cost attribution first.

## Deliberate simplifications

- One web app + one worker. No microservices.
- Agents have no tools yet (analysis-only). Tool use arrives with the orchestration milestone.
- Spend limits are environment variables; per-business budgets and UI editing come later.
