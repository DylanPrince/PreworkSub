import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ProviderError,
  type AIProvider,
  type StructuredCompletionRequest,
  type StructuredCompletionResult,
  type TokenUsage,
} from "./types";

function usageFrom(u: Anthropic.Usage | undefined): TokenUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
    thinkingTokens: u?.output_tokens_details?.thinking_tokens ?? 0,
  };
}

export function mapAnthropicError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIUserAbortError)
    return new ProviderError("cancelled", "Request was cancelled", false);
  if (error instanceof Anthropic.APIConnectionTimeoutError)
    return new ProviderError("timeout", "Claude API request timed out", true);
  if (error instanceof Anthropic.AuthenticationError)
    return new ProviderError("authentication", "Anthropic API key was rejected", false);
  if (error instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("permission", "API key lacks permission for this request", false);
  if (error instanceof Anthropic.NotFoundError)
    return new ProviderError("bad_request", `Model or resource not found: ${error.message}`, false);
  if (error instanceof Anthropic.RateLimitError)
    return new ProviderError("rate_limited", "Claude API rate limit reached", true);
  if (error instanceof Anthropic.BadRequestError)
    return new ProviderError("bad_request", error.message, false);
  if (error instanceof Anthropic.InternalServerError)
    return new ProviderError("overloaded", "Claude API server error", true);
  if (error instanceof Anthropic.APIConnectionError)
    return new ProviderError("network", "Could not reach the Claude API", true);
  if (error instanceof Anthropic.APIError)
    return new ProviderError("provider_error", error.message, (error.status ?? 500) >= 500);
  return new ProviderError(
    "provider_error",
    error instanceof Error ? error.message : String(error),
    false,
  );
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic | undefined;

  constructor(
    private readonly apiKey: string | undefined,
    /** Test seam: a fake fetch exercises the real SDK request/response handling offline. */
    private readonly clientOptions: { fetch?: typeof fetch; baseURL?: string } = {},
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private getClient(): Anthropic {
    if (!this.apiKey) {
      throw new ProviderError(
        "not_configured",
        "ANTHROPIC_API_KEY is not configured. Add it to the server environment to run agents.",
        false,
      );
    }
    // Retries are owned by the job queue (BullMQ backoff), so the SDK does not retry on its own.
    this.client ??= new Anthropic({ apiKey: this.apiKey, maxRetries: 0, ...this.clientOptions });
    return this.client;
  }

  /** Cheap credential check used by the Integrations page. Does not generate tokens. */
  async testConnection(
    model: string,
  ): Promise<{ ok: true; displayName: string } | { ok: false; error: string }> {
    try {
      const info = await this.getClient().models.retrieve(model);
      return { ok: true, displayName: info.display_name };
    } catch (error) {
      return { ok: false, error: mapAnthropicError(error).message };
    }
  }

  async completeStructured<T>(
    req: StructuredCompletionRequest<T>,
  ): Promise<StructuredCompletionResult<T>> {
    const client = this.getClient();
    const started = performance.now();
    // Only the JSON schema is sent. Parsing happens below, after stop_reason is checked, so a
    // refusal or truncated output is reported as such (with its billed usage) rather than as a
    // generic parse failure.
    const { type, schema } = zodOutputFormat(req.outputSchema);
    try {
      const response = await client.messages.create(
        {
          model: req.model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
          output_config: {
            format: { type, schema },
            ...(req.effort ? { effort: req.effort } : {}),
          },
        },
        { timeout: req.timeoutMs, signal: req.signal },
      );
      const latencyMs = Math.round(performance.now() - started);
      const usage = usageFrom(response.usage);
      const rawText = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();

      if (response.stop_reason === "refusal") {
        throw new ProviderError("refusal", "The model declined this request", false, usage);
      }
      if (response.stop_reason === "max_tokens") {
        throw new ProviderError(
          "max_tokens",
          "Output hit the agent's max output token limit before completing (thinking counts toward it)",
          false,
          usage,
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new ProviderError("invalid_output", "Model output was not valid JSON", true, usage);
      }
      const parsed = req.outputSchema.safeParse(json);
      if (!parsed.success) {
        throw new ProviderError(
          "invalid_output",
          "Model output did not match the agent's output schema",
          true,
          usage,
        );
      }
      return {
        provider: this.name,
        model: response.model,
        output: parsed.data,
        rawText,
        usage,
        stopReason: response.stop_reason,
        latencyMs,
      };
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}
