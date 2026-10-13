import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

describe("parseServerEnv", () => {
  it("applies safe defaults", () => {
    const env = parseServerEnv(valid);
    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.AUTH_ALLOW_SIGNUP).toBe(false);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("treats a blank API key as unset", () => {
    expect(parseServerEnv({ ...valid, ANTHROPIC_API_KEY: "  " }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("rejects missing or weak secrets without echoing values", () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: valid.DATABASE_URL, BETTER_AUTH_SECRET: "short" }),
    ).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseServerEnv({ BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("refuses the mock provider in production", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "production", AI_PROVIDER: "mock" })).toThrow(
      /not allowed/,
    );
  });
});
