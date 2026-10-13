import type { z } from "zod";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface StructuredCompletionRequest<T> {
  model: string;
  system: string;
  /** User turn content. Untrusted business data must be wrapped by the caller (see agents/prompt). */
  prompt: string;
  maxOutputTokens: number;
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
