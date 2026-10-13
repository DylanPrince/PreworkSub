import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_PRICES,
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
