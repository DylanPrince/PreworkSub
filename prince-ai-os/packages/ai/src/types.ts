import type { z } from "zod";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Part of outputTokens spent on thinking, when the provider reports it. Informational only:
   * it is already included in outputTokens and therefore in the cost. */
  thinkingTokens?: number;
}

export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface StructuredCompletionRequest<T> {
  model: string;
  system: string;
  /** User turn content. Untrusted business data must be wrapped by the caller (see agents/prompt). */
  prompt: string;
  /** Includes thinking tokens on models that think. */
  maxOutputTokens: number;
  /** Omitted: the model's default effort. */
  effort?: ReasoningEffort | null;
  outputSchema: z.ZodType<T>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Used only by the mock provider to produce deterministic, clearly-labelled output. */
  mockOutput?: () => T;
}

export interface StructuredCompletionResult<T> {
  provider: ProviderName;
  model: string;
  output: T;
  rawText: string;
  usage: TokenUsage;
  stopReason: string | null;
  latencyMs: number;
}

export type ProviderName = "anthropic" | "mock";

export type ProviderErrorCode =
  | "not_configured"
  | "authentication"
  | "permission"
  | "rate_limited"
  | "overloaded"
  | "bad_request"
  | "timeout"
  | "cancelled"
  | "refusal"
  | "max_tokens"
  | "invalid_output"
  | "network"
  | "provider_error";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly usage?: TokenUsage,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface AIProvider {
  readonly name: ProviderName;
  isConfigured(): boolean;
  completeStructured<T>(
    req: StructuredCompletionRequest<T>,
  ): Promise<StructuredCompletionResult<T>>;
}
