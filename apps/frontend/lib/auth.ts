import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { db } from "./db";

const appUrl =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

export const auth = betterAuth({
  appName: "Bookify",
  baseURL: appUrl,
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "dev-only-better-auth-secret-change-me-in-production",
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [nextCookies()],
});
