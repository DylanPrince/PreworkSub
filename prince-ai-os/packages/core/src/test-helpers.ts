/** Test doubles shared by the integration suites. Not exported from the package. */
import {
  ProviderError,
  type AIProvider,
  type StructuredCompletionRequest,
  type TokenUsage,
} from "@prince/ai";
import type { RunQueue } from "./run-queue";

export class MemoryQueue implements RunQueue {
  jobs: { runId: string; attempts: number }[] = [];
  started = new Set<string>();
  async enqueue(runId: string, opts: { attempts: number }) {
    this.jobs.push({ runId, ...opts });
  }
  async remove(runId: string) {
    if (this.started.has(runId)) return false;
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.runId !== runId);
    return this.jobs.length < before;
  }
}

export const DEFAULT_USAGE: TokenUsage = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 200,
};

/** Stand-in for the Claude provider: fixed output or error, optional latency, honours abort. */
export class ScriptedProvider implements AIProvider {
  readonly name = "anthropic" as const;
  calls = 0;
  /** Requests received, without the schema, for asserting what would have been sent. */
  requests: Omit<StructuredCompletionRequest<unknown>, "outputSchema" | "signal">[] = [];
  constructor(
    private readonly behaviour: {
      output?: unknown;
      error?: ProviderError;
      delayMs?: number;
      usage?: TokenUsage;
    },
  ) {}
  isConfigured() {
    return true;
  }
  async completeStructured<T>(req: StructuredCompletionRequest<T>) {
    this.calls += 1;
    const { outputSchema: _s, signal: _a, ...rest } = req;
    this.requests.push(rest);
    if (this.behaviour.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.behaviour.delayMs);
        req.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new ProviderError("cancelled", "Request was cancelled", false));
        });
      });
    }
    if (this.behaviour.error) throw this.behaviour.error;
    return {
      provider: this.name,
      model: "claude-opus-5-5",
      output: this.behaviour.output as T,
      rawText: JSON.stringify(this.behaviour.output),
      usage: this.behaviour.usage ?? DEFAULT_USAGE,
      stopReason: "end_turn",
      latencyMs: 42,
    };
  }
}
