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
    <main className="flex h-[100dvh] items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-[1.5rem] border border-border bg-card px-6 py-10 text-center shadow-lg">
        <div className="space-y-2">
          <p className="text-lg font-semibold text-foreground">
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
