---
name: agent-development
description: Add or change a Prince AI OS application agent (registry template, output schema, prompt, evaluation, budgets). Use when making a planned agent executable or changing agent behaviour.
---

# Agent development

Application agents are database rows executed by `apps/worker`, not Claude Code subagents.

1. Output contract: reuse one from `packages/agents/src/contracts.ts` if it fits. Otherwise add a Zod
   schema to `schemas.ts` (`OUTPUT_SCHEMAS`, versioned key `name.v1`; only objects, arrays, strings,
   numbers, booleans and enums) and an `OUTPUT_CONTRACTS` entry with a label, a clearly labelled
   `mockOutput` (must contain "MOCK OUTPUT"), and `evaluate` checks that catch real failure modes.
   Contracts appear automatically in Agent Builder's output-format list.
2. Template: in `packages/agents/src/registry.ts` replace the `planned(...)` entry with an
   `ImplementedAgentTemplate`: specific instructions, `outputSchemaKey`, `allowedTools` (empty until
   tools exist), `permissions`, `maxOutputTokens`, `budgetUsdPerRun`, `timeoutMs`, `maxAttempts`.
3. Instructions must forbid invented data and claims of external actions; the shared preamble in
   `prompt.ts` already covers untrusted-data handling. Do not weaken it.
4. Budget sanity: worst-case cost = estimated input + `maxOutputTokens` at the model's price must fit
   `budgetUsdPerRun` or every run is refused.
5. Seed: `pnpm db:seed` inserts new shared agents (existing ones are left untouched; configuration
   changes must create a new `AgentVersion`, never edit an old one).
6. Tests: `registry.test.ts` checks every contract's mock output and evaluation; add a
   failing-evaluation case for new checks.
