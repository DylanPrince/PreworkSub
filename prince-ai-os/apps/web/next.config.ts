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

const nextConfig: NextConfig = {
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
