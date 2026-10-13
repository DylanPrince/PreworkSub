import { z } from "zod";

/**
 * Server-side environment schema. Imported by the web app (server only) and the worker.
 * Never import this from client components: it reads secrets.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * Deployment environment, independent of NODE_ENV (a local `next start` runs with
   * NODE_ENV=production). Production-only safety rules key off this value.
   */
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  /** After the first (owner) account exists, new sign-ups are refused unless this is "true". */
  AUTH_ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  AI_PROVIDER: z.enum(["anthropic", "mock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  AI_DEFAULT_MODEL: z.string().min(1).default("claude-opus-5-5"),
  AI_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(50),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (result.data.APP_ENV === "production" && result.data.AI_PROVIDER === "mock") {
    throw new Error("AI_PROVIDER=mock is not allowed when APP_ENV=production");
  }
  return result.data;
}

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
