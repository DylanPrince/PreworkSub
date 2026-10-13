import { roughTokenEstimate } from "./pricing";
import {
  ProviderError,
  type AIProvider,
  type StructuredCompletionRequest,
  type StructuredCompletionResult,
} from "./types";

/**
 * Deterministic local provider for development and automated tests. It never calls a network
 * service, always reports model "mock" and $0 cost, and the UI labels its runs as mock output.
 * Refused in production by env validation.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock" as const;

  constructor(private readonly opts: { delayMs?: number } = {}) {}

  isConfigured(): boolean {
    return true;
  }

  async completeStructured<T>(
    req: StructuredCompletionRequest<T>,
  ): Promise<StructuredCompletionResult<T>> {
    const started = performance.now();
    if (!req.mockOutput)
      throw new ProviderError("bad_request", "Mock provider requires a mockOutput factory", false);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, this.opts.delayMs ?? 300);
      req.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new ProviderError("cancelled", "Request was cancelled", false));
      });
    });
    if (/\[mock:fail\]/i.test(req.prompt)) {
      throw new ProviderError(
        "provider_error",
        "Mock provider simulated failure ([mock:fail] in instructions)",
        false,
      );
    }
    const parsed = req.outputSchema.safeParse(req.mockOutput());
    if (!parsed.success)
      throw new ProviderError("invalid_output", "Mock output failed schema validation", false);
    const rawText = JSON.stringify(parsed.data);
    return {
      provider: this.name,
      model: "mock",
      output: parsed.data,
      rawText,
      usage: {
        inputTokens: roughTokenEstimate(req.system + req.prompt),
        outputTokens: roughTokenEstimate(rawText),
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      stopReason: "end_turn",
      latencyMs: Math.round(performance.now() - started),
    };
  }
}
