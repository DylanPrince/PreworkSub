import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { db, env } from "./server";

export const auth = betterAuth({
  appName: "Prince AI OS",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, window: 60, max: 100 },
  advanced: { useSecureCookies: env.NODE_ENV === "production" },
  databaseHooks: {
    user: {
      create: {
        // Single-owner by default: the first account is the owner; later sign-ups need opt-in.
        before: async (user) => {
          if (!env.AUTH_ALLOW_SIGNUP && (await db.user.count()) > 0) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-ups are closed. Ask the owner for access.",
            });
          }
          return { data: user };
        },
      },
    },
  },
  plugins: [nextCookies()],
});
