import * as Sentry from "@sentry/nextjs";

type ErrorContext = Record<string, unknown>;

export function reportError(error: unknown, context?: ErrorContext): void {
  if (process.env.NODE_ENV !== "production") {
    console.error(error, context ?? "");
  }

  const exception = error instanceof Error ? error : new Error(String(error));
  Sentry.captureException(
    exception,
    context ? { extra: context } : undefined
  );
}

export function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
