"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Link2, LoaderCircle, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { isValidImportUrl } from "@/lib/upload";

type UrlImportDialogProps = {
  onClose: () => void;
  /** Returns an error message, or null when the import was accepted. */
  onImport: (url: string) => Promise<string | null>;
};

export function UrlImportDialog({ onClose, onImport }: UrlImportDialogProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = isValidImportUrl(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsPending(true);

    try {
      const message = await onImport(url);
      if (message) {
        setError(message);
        return;
      }

      setUrl("");
      onClose();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-background/55 backdrop-blur-xl"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="url-import-title"
        className="glass-strong relative z-10 w-full max-w-[400px] p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.65)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex size-7 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>

        <div className="flex flex-col gap-1.5 pr-8">
          <div className="mb-3 flex size-9 items-center justify-center bg-primary/10 text-primary">
            <Link2 className="size-4" />
          </div>
          <h2
            id="url-import-title"
            className="text-[15px] font-semibold tracking-tight text-foreground"
          >
            Import a web page
          </h2>
          <p className="text-[11.5px] leading-5 text-muted-foreground">
            Fetch the readable text from one page. Crawling and PDF links are
            not supported.
          </p>
        </div>

        <form className="mt-5 flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
              Page URL
            </span>
            <Input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (error) {
                  setError(null);
                }
              }}
              placeholder="https://example.com/article"
              type="url"
              inputMode="url"
              autoComplete="url"
              autoFocus
              disabled={isPending}
              required
            />
          </label>

          {error ? (
            <p className="bg-destructive/10 px-3 py-2 text-[11.5px] leading-5 text-destructive">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isPending}
            className="mt-1 inline-flex h-9 items-center justify-center gap-2 bg-primary text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-3.5" />
            )}
            {isPending ? "Importing…" : "Import page"}
          </button>
        </form>
      </div>
    </div>
  );
}
