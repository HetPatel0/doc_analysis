"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";

import { ScrollArea } from "@/components/scroll-area";
import { cn } from "@/lib/utils";

export type TextChunk = {
  /** 1-based chunk number, matching citation labels. */
  chunk: number;
  page: number | null;
  startIndex: number | null;
  label: string;
};

type TextViewerProps = {
  documentId: string;
  /** 1-based chunk to scroll to and highlight, usually from a citation. */
  chunk: number | null;
};

type Segment = {
  chunk: number | null;
  text: string;
};

type LoadedText = {
  documentId: string;
  text: string;
  chunks: TextChunk[];
};

/**
 * Split the full document text at chunk offsets so each citation can scroll to
 * its own block. Chunks overlap in storage, so segments are cut at the next
 * chunk's start instead of using the chunk's own length, which would duplicate
 * text on screen.
 */
function buildSegments(text: string, chunks: TextChunk[]): Segment[] {
  const positioned = chunks
    .filter(
      (chunk) =>
        chunk.startIndex !== null &&
        chunk.startIndex >= 0 &&
        chunk.startIndex < text.length
    )
    .sort((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0));

  if (positioned.length === 0) {
    return [{ chunk: null, text }];
  }

  const segments: Segment[] = [];
  let cursor = 0;

  positioned.forEach((chunk, index) => {
    const start = chunk.startIndex!;
    if (start > cursor) {
      segments.push({ chunk: null, text: text.slice(cursor, start) });
    }

    const nextStart =
      index + 1 < positioned.length
        ? positioned[index + 1].startIndex!
        : text.length;

    segments.push({
      chunk: chunk.chunk,
      text: text.slice(Math.max(start, cursor), nextStart),
    });
    cursor = Math.max(cursor, nextStart);
  });

  if (cursor < text.length) {
    segments.push({ chunk: null, text: text.slice(cursor) });
  }

  return segments.filter((segment) => segment.text.length > 0);
}

export function TextViewer({ documentId, chunk }: TextViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<LoadedText | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);

    async function load() {
      try {
        const [fileResponse, chunksResponse] = await Promise.all([
          fetch(`/api/documents/${documentId}/file`, { cache: "no-store" }),
          fetch(`/api/documents/${documentId}/chunks`, { cache: "no-store" }),
        ]);

        if (!fileResponse.ok) {
          const body = (await fileResponse.json().catch(() => null)) as {
            detail?: string;
          } | null;
          throw new Error(body?.detail ?? "Could not load the document text.");
        }

        const text = await fileResponse.text();
        let chunks: TextChunk[] = [];

        if (chunksResponse.ok) {
          const body = (await chunksResponse.json()) as {
            chunks?: TextChunk[];
          };
          chunks = body.chunks ?? [];
        }

        if (!cancelled) {
          setLoaded({ documentId, text, chunks });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the document text."
          );
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const segments = useMemo(
    () => (loaded ? buildSegments(loaded.text, loaded.chunks) : []),
    [loaded]
  );

  useEffect(() => {
    if (!chunk || !loaded) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const target = containerRef.current?.querySelector<HTMLElement>(
        `[data-chunk="${chunk}"]`
      );

      if (!viewport || !target) {
        return;
      }

      // Scroll the custom ScrollArea viewport, not the page.
      const offset =
        target.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop -
        16;
      viewport.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
    });

    return () => cancelAnimationFrame(frame);
  }, [chunk, loaded]);

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <FileText className="size-4 text-muted-foreground/60" />
        <p className="text-[12px] text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <LoaderCircle className="size-4 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
      <div className="mx-auto w-full max-w-[760px] px-6 py-8">
        <article
          ref={containerRef}
          className="flex flex-col gap-1 text-[13.5px] leading-7 text-foreground/90"
        >
          {segments.map((segment, index) => (
            <div
              key={`${segment.chunk ?? "body"}-${index}`}
              data-chunk={segment.chunk ?? undefined}
              className={cn(
                "whitespace-pre-wrap break-words rounded-sm px-2 py-0.5 transition-colors",
                segment.chunk !== null &&
                  segment.chunk === chunk &&
                  "bg-amber-500/10 ring-1 ring-amber-500/20"
              )}
            >
              {segment.text}
            </div>
          ))}
        </article>
      </div>
    </ScrollArea>
  );
}
