import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider, mapAnthropicError } from "./anthropic";
import { MockProvider } from "./mock";
import { ProviderError } from "./types";

const schema = z.object({ answer: z.string() });
const base = {
  model: "claude-opus-5-5",
  system: "s",
  maxOutputTokens: 100,
  outputSchema: schema,
  timeoutMs: 1000,
};

describe("AnthropicProvider", () => {
  it("reports not_configured without calling the network when no key is set", async () => {
    const p = new AnthropicProvider(undefined);
    expect(p.isConfigured()).toBe(false);
    await expect(p.completeStructured({ ...base, prompt: "hi" })).rejects.toMatchObject({
      code: "not_configured",
      retryable: false,
    });
  });

  it("maps SDK errors to retryable and non-retryable codes", () => {
    const headers = new Headers();
    expect(mapAnthropicError(new Anthropic.RateLimitError(429, {}, "rate", headers))).toMatchObject(
      { code: "rate_limited", retryable: true },
    );
    expect(
      mapAnthropicError(new Anthropic.AuthenticationError(401, {}, "auth", headers)),
    ).toMatchObject({ code: "authentication", retryable: false });
    expect(mapAnthropicError(new Anthropic.BadRequestError(400, {}, "bad", headers))).toMatchObject(
      { code: "bad_request", retryable: false },
    );
    expect(
      mapAnthropicError(new Anthropic.InternalServerError(500, {}, "boom", headers)),
    ).toMatchObject({ retryable: true });
    expect(mapAnthropicError(new Error("x"))).toBeInstanceOf(ProviderError);
  });
});

describe("MockProvider", () => {
  it("returns schema-valid output with $0-model usage", async () => {
    const r = await new MockProvider({ delayMs: 1 }).completeStructured({
      ...base,
      prompt: "hi",
      mockOutput: () => ({ answer: "x" }),
    });
    expect(r.model).toBe("mock");
    expect(r.output).toEqual({ answer: "x" });
    expect(r.usage.inputTokens).toBeGreaterThan(0);
  });

  it("rejects output that does not match the schema", async () => {
    await expect(
      new MockProvider({ delayMs: 1 }).completeStructured({
        ...base,
        prompt: "hi",
        mockOutput: () => ({ wrong: 1 }) as never,
      }),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("supports cancellation", async () => {
    const c = new AbortController();
    const p = new MockProvider({ delayMs: 1000 }).completeStructured({
      ...base,
      prompt: "hi",
      signal: c.signal,
      mockOutput: () => ({ answer: "x" }),
    });
    c.abort();
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
  });
});
