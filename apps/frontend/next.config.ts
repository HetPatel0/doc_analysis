import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: rootDir,
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "bookify",
  project: process.env.SENTRY_PROJECT ?? "bookify-frontend",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  tunnelRoute: "/sentry-tunnel",
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
