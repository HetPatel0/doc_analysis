"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs, type DocumentProps } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Minus,
  Plus,
} from "lucide-react";

import { ScrollArea } from "@/components/scroll-area";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type PdfViewerProps = {
  fileUrl: string;
  page: number;
  onPageChange: (page: number) => void;
};

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.2;
const PAGE_GUTTER = 40; // px-5 on both sides
const MAX_PAGE_WIDTH = 980;
const DEFAULT_ASPECT = 1.294; // A4-ish fallback while the document loads.

type PdfDocument = Parameters<
  NonNullable<DocumentProps["onLoadSuccess"]>
>[0];

export function PdfViewer({ fileUrl, page, onPageChange }: PdfViewerProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [baseWidth, setBaseWidth] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const [renderedToken, setRenderedToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The skeleton state is derived from the identity of the render we are
  // waiting for, instead of being reset from an effect. Changing the document
  // or retrying produces a new token, so the skeleton returns without a
  // setState-in-effect cascade.
  const renderToken = `${fileUrl}-${reloadKey}`;
  const pageReady = renderedToken === renderToken;

  useLayoutEffect(() => {
    const frame = frameRef.current;

    if (!frame) {
      return;
    }

    let raf = 0;

    const measure = () => {
      const measured = frame.clientWidth;

      if (measured < 240) {
        return;
      }

      const next = Math.min(measured - PAGE_GUTTER, MAX_PAGE_WIDTH);

      // Only react to real layout changes; sub-pixel churn would redraw the
      // canvas and read as a flicker.
      setBaseWidth((current) =>
        current === null || Math.abs(current - next) >= 2 ? next : current
      );
    };

    measure();

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    observer.observe(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

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
      Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Number((current + delta).toFixed(2)))
      )
    );
  }

  async function handleLoadSuccess(pdf: PdfDocument) {
    setNumPages(pdf.numPages);
    setLoadError(null);

    try {
      const firstPage = await pdf.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });

      if (viewport.width > 0) {
        setAspect(viewport.height / viewport.width);
      }
    } catch {
      // Cosmetic only: keep the A4 fallback.
    }

    if (page > pdf.numPages) {
      onPageChange(pdf.numPages);
    }
  }

  const pageWidth = Math.round((baseWidth ?? 0) * zoom);
  const pageHeight = Math.round(pageWidth * aspect);

  return (
    <div
      ref={frameRef}
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col"
    >
      {loadError ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-[13px] text-foreground">Could not render the PDF</p>
          <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setReloadKey((current) => current + 1);
            }}
            className="mt-1 bg-foreground/[0.06] px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/[0.1]"
          >
            Try again
          </button>
        </div>
      ) : (
        <ScrollArea
          className="flex-1"
          viewportClassName="overflow-auto"
          viewportRef={viewportRef}
        >
          {baseWidth === null ? (
            <div className="h-full" />
          ) : (
            <div className="flex justify-center px-5 py-6">
              <div
                className="relative shrink-0"
                style={{ width: pageWidth, minHeight: pageHeight }}
                data-pdf-page-frame
              >
                {/*
                 * The skeleton sits on top of the page until the canvas has
                 * actually painted. The page is never faded in and the
                 * skeleton is removed in one step, so there is no flash of a
                 * white or default-sized canvas.
                 */}
                {!pageReady ? (
                  <div
                    aria-hidden
                    className="absolute inset-x-0 top-0 z-10 flex items-center justify-center bg-muted/50"
                    style={{ height: pageHeight }}
                  >
                    <LoaderCircle className="size-5 animate-spin text-muted-foreground/60" />
                  </div>
                ) : null}

                <Document
                  key={`${fileUrl}-${reloadKey}`}
                  file={fileUrl}
                  onLoadSuccess={handleLoadSuccess}
                  onLoadError={(error) => {
                    setRenderedToken(null);
                    setLoadError(error.message);
                  }}
                  loading={<span />}
                  error={<span />}
                  className="block"
                >
                  <Page
                    pageNumber={page}
                    width={pageWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onRenderSuccess={() => setRenderedToken(renderToken)}
                    className="block bg-white shadow-[0_1px_2px_rgba(15,17,21,0.10),0_24px_56px_-28px_rgba(15,17,21,0.45)]"
                  />
                </Document>
              </div>
            </div>
          )}
        </ScrollArea>
      )}

      <div className="flex h-10 shrink-0 items-center justify-between gap-2 bg-card/55 px-3 backdrop-blur-xl">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onPageChange(clampPage(page - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
            className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" />
          </button>

          <div className="flex items-center text-[11px] text-muted-foreground">
            <input
              type="number"
              min={1}
              max={numPages || undefined}
              value={page}
              onChange={(event) => handlePageInput(event.target.value)}
              aria-label="Page number"
              className="h-6 w-8 bg-transparent text-center tabular-nums text-foreground outline-none [appearance:textfield] hover:bg-foreground/[0.06] focus:bg-foreground/[0.06] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="px-0.5 tabular-nums">/ {numPages || "–"}</span>
          </div>

          <button
            type="button"
            onClick={() => onPageChange(clampPage(page + 1))}
            disabled={!numPages || page >= numPages}
            aria-label="Next page"
            className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => adjustZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
            className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <Minus className="size-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
            className="h-6 min-w-9 px-1 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            type="button"
            onClick={() => adjustZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <Plus className="size-3.5" />
          </button>

          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open PDF in a new tab"
            className="ml-1 flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
