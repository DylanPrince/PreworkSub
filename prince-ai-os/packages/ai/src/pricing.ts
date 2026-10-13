import type { TokenUsage } from "./types";

export interface ModelPriceInput {
  model: string;
  displayName: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

/**
 * Default price table seeded into the ModelPrice table (USD per million tokens, Anthropic
 * first-party API, global inference, standard speed). Verified on 2026-10-13 against
 * https://platform.claude.com/docs/en/about-claude/pricing and the model IDs and availability on
 * https://platform.claude.com/docs/en/about-claude/models/overview (all four models Active).
 * Cache writes use the 5-minute TTL rate (1.25x input).
 *
 * Claude Haiku 5.5 is billed at a higher rate when a prompt exceeds 100k input tokens. The flat
 * row below is the up-to-100k rate; the executor refuses prompts estimated above
 * MAX_ESTIMATED_INPUT_TOKENS, so runs stay inside that tier.
 *
 * Prices are editable in the database; these values are only defaults and must be re-verified
 * before relying on them for accounting.
 */
export const PRICES_VERIFIED_ON = "2026-10-13";
export const PRICES_SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/pricing";

/** Earlier seeded defaults, so the seed can correct rows nobody has edited since. */
export const SUPERSEDED_DEFAULT_PRICES: Omit<ModelPriceInput, "displayName">[] = [
  // Seeded 2026-10-06 with the cache-read rate of Opus 5.5 by mistake.
  {
    model: "claude-sonnet-5-5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.2,
  },
];

export const DEFAULT_MODEL_PRICES: ModelPriceInput[] = [
  {
    model: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheWritePerMTok: 5,
    cacheReadPerMTok: 0.2,
  },
  {
    model: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.1,
  },
  {
    model: "claude-haiku-5-5",
    displayName: "Claude Haiku 5.5",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheWritePerMTok: 0.125,
    cacheReadPerMTok: 0.01,
  },
  {
    model: "claude-fable-5-1",
    displayName: "Claude Fable 5.1",
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheWritePerMTok: 12.5,
    cacheReadPerMTok: 0.25,
  },
  {
    model: "mock",
    displayName: "Mock provider (no charge)",
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheWritePerMTok: 0,
    cacheReadPerMTok: 0,
  },
];

/** Selectable models in the UI. Only identifiers with a price entry are offered. */
export const SELECTABLE_MODELS = DEFAULT_MODEL_PRICES.filter((p) => p.model !== "mock").map(
  (p) => ({
    id: p.model,
    label: p.displayName,
  }),
);

export function computeCostUsd(
  usage: TokenUsage,
  price: Omit<ModelPriceInput, "model" | "displayName">,
): number {
  const perToken = (perMTok: number) => perMTok / 1_000_000;
  const cost =
    usage.inputTokens * perToken(price.inputPerMTok) +
    usage.outputTokens * perToken(price.outputPerMTok) +
    usage.cacheCreationInputTokens * perToken(price.cacheWritePerMTok) +
    usage.cacheReadInputTokens * perToken(price.cacheReadPerMTok);
  // Round to 6 decimal places to match the Decimal(12,6) column.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Upper-bound cost of a run before it executes (used for budget pre-checks). */
export function estimateMaxCostUsd(
  inputTokensEstimate: number,
  maxOutputTokens: number,
  price: Omit<ModelPriceInput, "model" | "displayName">,
): number {
  return computeCostUsd(
    {
      inputTokens: inputTokensEstimate,
      outputTokens: maxOutputTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    price,
  );
}

/**
 * Largest estimated prompt (in tokens) the executor sends. Estimates carry 25% headroom, so real
 * prompts stay well under the 100k-token point where Claude Haiku 5.5's long-context rate applies.
 */
export const MAX_ESTIMATED_INPUT_TOKENS = 80_000;

/** Rough token estimate (≈4 chars/token) for pre-flight budget checks only, never for billing. */
export function roughTokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}
