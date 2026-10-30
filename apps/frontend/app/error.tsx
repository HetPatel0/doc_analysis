"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="app-canvas flex h-[100dvh] items-center justify-center px-4">
      <div className="glass-strong flex max-w-md flex-col items-center gap-4 px-6 py-10 text-center shadow-[0_40px_120px_-48px_rgba(0,0,0,0.55)]">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Unexpected error
          </p>
          <p className="text-lg font-semibold tracking-tight text-foreground">
            Something went wrong
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            The app hit an unexpected error. You can try again, and the issue has
            been reported.
          </p>
        </div>
        <Button onClick={() => unstable_retry()}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
      </div>
    </main>
  );
}
