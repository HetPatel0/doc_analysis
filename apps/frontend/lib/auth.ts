import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { db } from "./db";

function parseCsvEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const appUrl =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

const allowedHosts = Array.from(
  new Set([
    ...parseCsvEnv(process.env.BETTER_AUTH_ALLOWED_HOSTS),
    new URL(appUrl).host,
    "localhost:3000",
    "127.0.0.1:3000",
  ])
);

const trustedOrigins = Array.from(
  new Set([
    appUrl,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...parseCsvEnv(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
  ])
);

export const auth = betterAuth({
  appName: "Bookify",
  baseURL: {
    fallback: appUrl,
    allowedHosts,
    protocol: "auto",
  },
  trustedOrigins,
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
