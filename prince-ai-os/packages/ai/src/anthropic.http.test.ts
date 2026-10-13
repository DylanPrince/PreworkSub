import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "./anthropic";

/**
 * Exercises the real Anthropic SDK request/response path against a fake HTTP layer, so these
 * tests cover serialisation, structured-output parsing and error mapping without network access
 * or API charges.
 */

const FAKE_KEY = "sk-ant-test-not-a-real-key";
const schema = z.object({ answer: z.string(), confidence: z.enum(["low", "high"]) });
const request = {
  model: "claude-opus-5-5",
  system: "You are a test.",
  prompt: "<task>Say hi</task>",
  maxOutputTokens: 256,
  outputSchema: schema,
  timeoutMs: 5_000,
};

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_test", ...headers },
  });
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify({ answer: "hi", confidence: "high" }) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 10,
    },
    ...overrides,
  };
}

function provider(respond: (c: Captured, signal?: AbortSignal | null) => Promise<Response>) {
  const calls: Captured[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const c: Captured = {
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    };
    calls.push(c);
    return respond(c, init?.signal);
  }) as typeof fetch;
  return {
    calls,
    p: new AnthropicProvider(FAKE_KEY, { fetch: fakeFetch, baseURL: "https://api.test" }),
  };
}

const errorBody = (type: string, msg: string) => ({ type: "error", error: { type, message: msg } });

describe("AnthropicProvider over HTTP", () => {
  it("sends a structured-output request and returns parsed output with usage", async () => {
    const { p, calls } = provider(async () => json(200, message()));
    const r = await p.completeStructured(request);
    expect(r.output).toEqual({ answer: "hi", confidence: "high" });
    expect(r.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 10,
      thinkingTokens: 0,
    });
    expect(r.provider).toBe("anthropic");
    expect(r.stopReason).toBe("end_turn");

    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe("https://api.test/v1/messages");
    expect(c.headers.get("x-api-key")).toBe(FAKE_KEY);
    expect(c.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 256,
      system: "You are a test.",
    });
    expect(c.body.messages).toEqual([{ role: "user", content: "<task>Say hi</task>" }]);
    expect(c.body.output_config).toMatchObject({ format: { type: "json_schema" } });
    // Without an explicit effort the model's default applies, so none is sent.
    expect(c.body.output_config).not.toHaveProperty("effort");
    // The key travels only in the auth header, never in the payload.
    expect(JSON.stringify(c.body)).not.toContain(FAKE_KEY);
  });

  it("sends the configured effort and records thinking tokens", async () => {
    const { p, calls } = provider(async () =>
      json(
        200,
        message({
          usage: {
            input_tokens: 120,
            output_tokens: 900,
            output_tokens_details: { thinking_tokens: 700 },
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      ),
    );
    const r = await p.completeStructured({ ...request, effort: "low" });
    expect(calls[0]!.body.output_config).toMatchObject({
      format: { type: "json_schema" },
      effort: "low",
    });
    // Thinking is part of output tokens (and of the cost), reported separately for visibility.
    expect(r.usage).toMatchObject({ outputTokens: 900, thinkingTokens: 700 });
  });

  it("does not retry inside the SDK (the job queue owns retries)", async () => {
    const { p, calls } = provider(async () =>
      json(429, errorBody("rate_limit_error", "slow down"), { "retry-after": "0" }),
    );
    await expect(p.completeStructured(request)).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    [401, "authentication_error", "authentication", false],
    [403, "permission_error", "permission", false],
    [400, "invalid_request_error", "bad_request", false],
    [404, "not_found_error", "bad_request", false],
    [500, "api_error", "overloaded", true],
    [529, "overloaded_error", "overloaded", true],
  ] as const)("maps HTTP %i to %s/%s (retryable: %s)", async (status, type, code, retryable) => {
    const { p } = provider(async () => json(status, errorBody(type, "nope")));
    await expect(p.completeStructured(request)).rejects.toMatchObject({ code, retryable });
  });

  it("treats a refusal as a non-retryable failure and keeps the billed usage", async () => {
    const { p } = provider(async () =>
      json(200, message({ stop_reason: "refusal", content: [{ type: "text", text: "" }] })),
    );
    await expect(p.completeStructured(request)).rejects.toMatchObject({
      code: "refusal",
      retryable: false,
      usage: expect.objectContaining({ inputTokens: 120 }),
    });
  });

  it("reports truncated output (max_tokens) with usage instead of a broken parse", async () => {
    const { p } = provider(async () =>
      json(
        200,
        message({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"answer":"h' }] }),
      ),
    );
    await expect(p.completeStructured(request)).rejects.toMatchObject({
      code: "max_tokens",
      usage: expect.objectContaining({ outputTokens: 30 }),
    });
  });

  it("maps a caller abort to cancelled", async () => {
    const controller = new AbortController();
    const { p } = provider(
      (_c, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const pending = p.completeStructured({ ...request, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ code: "cancelled", retryable: false });
  });

  it("maps the per-agent timeout to a retryable timeout", async () => {
    const { p } = provider(
      (_c, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(p.completeStructured({ ...request, timeoutMs: 30 })).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    });
  });

  it("maps a network failure to a retryable network error", async () => {
    const { p } = provider(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(p.completeStructured(request)).rejects.toMatchObject({
      code: "network",
      retryable: true,
    });
  });

  it("checks credentials with a metadata call that generates no tokens", async () => {
    const { p, calls } = provider(async () =>
      json(200, {
        type: "model",
        id: "claude-opus-5-5",
        display_name: "Claude Opus 5.5",
        created_at: "2026-01-01T00:00:00Z",
      }),
    );
    await expect(p.testConnection("claude-opus-5-5")).resolves.toEqual({
      ok: true,
      displayName: "Claude Opus 5.5",
    });
    expect(calls[0]!.url).toBe("https://api.test/v1/models/claude-opus-5-5");
  });
});

describe("AnthropicProvider output validation", () => {
  it("reports schema mismatches as retryable invalid_output and keeps usage for cost tracking", async () => {
    const { p } = provider(async () =>
      json(
        200,
        message({ content: [{ type: "text", text: '{"answer":"hi","confidence":"maybe"}' }] }),
      ),
    );
    await expect(p.completeStructured(request)).rejects.toMatchObject({
      code: "invalid_output",
      retryable: true,
      usage: expect.objectContaining({ inputTokens: 120, outputTokens: 30 }),
    });
  });

  it("reports non-JSON output as invalid_output with usage", async () => {
    const { p } = provider(async () =>
      json(200, message({ content: [{ type: "text", text: "Sure! Here you go" }] })),
    );
    await expect(p.completeStructured(request)).rejects.toMatchObject({
      code: "invalid_output",
      usage: expect.objectContaining({ inputTokens: 120 }),
    });
  });
});
