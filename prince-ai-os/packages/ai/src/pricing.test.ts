import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_PRICES,
  MAX_ESTIMATED_INPUT_TOKENS,
  SUPERSEDED_DEFAULT_PRICES,
  computeCostUsd,
  estimateMaxCostUsd,
  roughTokenEstimate,
} from "./pricing";

const opus = DEFAULT_MODEL_PRICES.find((p) => p.model === "claude-opus-5-5")!;

describe("computeCostUsd", () => {
  it("prices every usage component per million tokens", () => {
    const cost = computeCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationInputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
      },
      opus,
    );
    expect(cost).toBeCloseTo(4 + 20 + 5 + 0.2, 6);
  });

  it("rounds to 6 decimal places", () => {
    expect(
      computeCostUsd(
        { inputTokens: 1, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        opus,
      ),
    ).toBe(0.000004);
  });

  it("is zero for the mock price entry", () => {
    const mock = DEFAULT_MODEL_PRICES.find((p) => p.model === "mock")!;
    expect(
      computeCostUsd(
        {
          inputTokens: 5000,
          outputTokens: 5000,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        mock,
      ),
    ).toBe(0);
  });
});

describe("estimates", () => {
  it("bounds a run by estimated input plus max output", () => {
    expect(estimateMaxCostUsd(1000, 4096, opus)).toBeCloseTo((1000 * 4 + 4096 * 20) / 1_000_000, 6);
  });
  it("estimates ~4 characters per token", () => {
    expect(roughTokenEstimate("abcdefgh")).toBe(2);
  });
  it("only lists model ids that have prices", () => {
    expect(new Set(DEFAULT_MODEL_PRICES.map((p) => p.model)).size).toBe(
      DEFAULT_MODEL_PRICES.length,
    );
  });
});

describe("default price table", () => {
  // Values as published on the Anthropic pricing page, verified 2026-10-13. A change here must
  // come from a fresh check of that page, not from adjusting the test.
  it.each([
    ["claude-fable-5-1", 10, 50, 12.5, 0.25],
    ["claude-opus-5-5", 4, 20, 5, 0.2],
    ["claude-sonnet-5-5", 2, 10, 2.5, 0.1],
    ["claude-haiku-5-5", 0.1, 0.5, 0.125, 0.01],
  ] as const)("%s matches the verified rates", (model, input, output, cacheWrite, cacheRead) => {
    expect(DEFAULT_MODEL_PRICES.find((p) => p.model === model)).toMatchObject({
      inputPerMTok: input,
      outputPerMTok: output,
      cacheWritePerMTok: cacheWrite,
      cacheReadPerMTok: cacheRead,
    });
  });

  it("keeps the input estimate cap below Haiku 5.5's long-context tier", () => {
    expect(MAX_ESTIMATED_INPUT_TOKENS).toBeLessThan(100_000);
  });

  it("never lists a current default as superseded", () => {
    for (const old of SUPERSEDED_DEFAULT_PRICES) {
      const current = DEFAULT_MODEL_PRICES.find((p) => p.model === old.model)!;
      expect(current).not.toMatchObject(old);
    }
  });
});
