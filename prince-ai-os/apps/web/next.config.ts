import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// One .env at the monorepo root serves web, worker and Prisma. Existing process env wins.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Extra hosts allowed to call Server Actions, comma-separated (e.g. a Codespaces forwarded host,
// whose proxy sends X-Forwarded-Host localhost:3000 while the browser's Origin is *.app.github.dev).
const serverActionsAllowedOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { allowedOrigins: serverActionsAllowedOrigins },
  },
  transpilePackages: [
    "@prince/shared",
    "@prince/ai",
    "@prince/agents",
    "@prince/core",
    "@prince/database",
  ],
  serverExternalPackages: ["bullmq", "ioredis", "pg"],
  poweredByHeader: false,
  typedRoutes: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
