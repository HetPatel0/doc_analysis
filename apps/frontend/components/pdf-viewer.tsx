"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs, type DocumentProps } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type PdfViewerProps = {
  fileUrl: string;
  page: number;
  onPageChange: (page: number) => void;
};

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.2;
const DEFAULT_ASPECT = 1.294; // A4-ish fallback for the loading skeleton.

type PdfDocument = Parameters<
  NonNullable<DocumentProps["onLoadSuccess"]>
>[0];

export function PdfViewer({ fileUrl, page, onPageChange }: PdfViewerProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  // `null` means "not measured yet". Nothing is rendered until the real width
  // is known, so the first paint never shows the 300×150 canvas placeholder.
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT);
  const [isLoading, setIsLoading] = useState(true);
  const [pageReady, setPageReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const viewport = viewportRef.current;
    if (!frame || !viewport) {
      return;
    }

    let raf = 0;
    const updateWidth = () => {
      const measured = viewport.clientWidth;
      // A hidden mobile pane reports 0; wait for the next observer tick.
      if (measured < 240) {
        return;
      }

      const nextWidth = Math.max(240, Math.min(measured - 32, 1100));
      // Only react to real layout changes: sub-pixel churn here causes the
      // PDF canvas to redraw constantly (visible flicker).
      setContainerWidth((current) =>
        current === null || Math.abs(current - nextWidth) >= 2
          ? nextWidth
          : current
      );
    };

    updateWidth();
    // Observe the outer frame, never the scroll container: observing the
    // scroller feeds scrollbar appearance back into the page width.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateWidth);
    });
    observer.observe(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  function clampPage(nextPage: number) {
    if (!numPages) {
      return Math.max(1, nextPage);
    }
    return Math.min(Math.max(1, nextPage), numPages);
  }

  function handlePageInput(raw: string) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      onPageChange(clampPage(parsed));
    }
  }

  function adjustZoom(delta: number) {
    setZoom((current) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + delta).toFixed(2))))
    );
  }

  async function handleLoadSuccess(pdf: PdfDocument) {
    const total = pdf.numPages;
    setNumPages(total);
    setIsLoading(false);
    setLoadError(null);

    try {
      const firstPage = await pdf.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      if (viewport.width > 0) {
        setAspectRatio(viewport.height / viewport.width);
      }
    } catch {
      // Keep the fallback aspect ratio; purely cosmetic.
    }

    if (page > total) {
      onPageChange(total);
    }
  }

  const pageWidth = (containerWidth ?? 0) * zoom;

  return (
    <div ref={frameRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-card/40 px-2.5">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onPageChange(clampPage(page - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
            <input
              type="number"
              min={1}
              max={numPages || undefined}
              value={page}
              onChange={(event) => handlePageInput(event.target.value)}
              aria-label="Page number"
              className="h-6 w-11 rounded-md border border-border/80 bg-background px-1 text-center text-xs tabular-nums text-foreground [appearance:textfield] focus-visible:border-ring focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="tabular-nums">/ {numPages || "–"}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onPageChange(clampPage(page + 1))}
            disabled={!numPages || page >= numPages}
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => adjustZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <Minus className="size-3.5" />
          </Button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
            className="inline-flex h-6 min-w-11 items-center justify-center rounded-md px-1 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => adjustZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open PDF in a new tab"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 [scrollbar-gutter:stable]"
      >
        {loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <p>Could not render the PDF.</p>
            <p className="text-xs">{loadError}</p>
          </div>
        ) : containerWidth === null ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Document
            key={fileUrl}
            file={fileUrl}
            onLoadSuccess={handleLoadSuccess}
            onLoadError={(error) => {
              setIsLoading(false);
              setLoadError(error.message);
            }}
            loading={
              <div className="flex h-40 items-center justify-center">
                <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
              </div>
            }
            className="flex flex-col items-center"
          >
            {isLoading ? null : (
              <div
                className="relative"
                style={{ width: pageWidth }}
                data-pdf-page-frame
              >
                {!pageReady ? (
                  <div
                    aria-hidden
                    className="absolute inset-x-0 top-0 animate-pulse rounded-md bg-muted/80"
                    style={{ height: pageWidth * aspectRatio }}
                  />
                ) : null}
                <Page
                  pageNumber={page}
                  width={pageWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onRenderSuccess={() => setPageReady(true)}
                  className={cn(
                    "relative z-10 overflow-hidden rounded-md bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08),0_12px_32px_-12px_rgba(0,0,0,0.18)] transition-opacity duration-300",
                    pageReady ? "opacity-100" : "opacity-0"
                  )}
                />
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  );
}
