---
name: agent-development
description: Add or change a Prince AI OS application agent (registry template, output schema, prompt, evaluation, budgets). Use when making a planned agent executable or changing agent behaviour.
---

# Agent development

Application agents are database rows executed by `apps/worker`, not Claude Code subagents.

1. Output contract: add a Zod schema to `packages/agents/src/schemas.ts` and register it in
   `OUTPUT_SCHEMAS` with a versioned key (`name.v1`). Use only objects, arrays, strings, numbers,
   booleans and enums (Claude structured outputs).
2. Template: in `packages/agents/src/registry.ts` replace the `planned(...)` entry with an
   `ImplementedAgentTemplate`: specific instructions, `allowedTools` (empty until tools exist),
   `permissions`, `maxOutputTokens`, `budgetUsdPerRun`, `timeoutMs`, `maxAttempts`, a clearly labelled
   `mockOutput`, and `evaluate` checks that catch real failure modes.
3. Instructions must forbid invented data and claims of external actions; the shared preamble in
   `prompt.ts` already covers untrusted-data handling. Do not weaken it.
4. Budget sanity: worst-case cost = estimated input + `maxOutputTokens` at the model's price must fit
   `budgetUsdPerRun` or every run is refused.
5. Seed: `pnpm db:seed` inserts new shared agents (existing ones are left untouched; configuration
   changes must create a new `AgentVersion`, never edit an old one).
6. Tests: `registry.test.ts` checks mock output and evaluation; add a failing-evaluation case.
