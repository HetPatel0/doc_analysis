"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RotateCcw } from "lucide-react";

export default function GlobalError({
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
    <html lang="en">
      <body>
        <main
          style={{
            display: "flex",
            minHeight: "100dvh",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ maxWidth: "28rem", textAlign: "center" }}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
              Something went wrong
            </h2>
            <p style={{ color: "#666", marginTop: "0.5rem" }}>
              The app hit an unexpected error. The issue has been reported.
            </p>
            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{
                marginTop: "1.25rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 1rem",
                background: "#1f2937",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              <RotateCcw style={{ width: "1rem", height: "1rem" }} />
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
