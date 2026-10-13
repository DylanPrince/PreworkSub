import path from "node:path";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Load the monorepo root .env so every package shares one configuration file.
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
