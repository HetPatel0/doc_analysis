"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
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

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type PdfViewerProps = {
  fileUrl: string;
  page: number;
  onPageChange: (page: number) => void;
};

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.2;

export function PdfViewer({ fileUrl, page, onPageChange }: PdfViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(640);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = viewport.clientWidth - 32;
      setContainerWidth(Math.max(240, Math.min(nextWidth, 1100)));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/60 px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(clampPage(page - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="number"
              min={1}
              max={numPages || undefined}
              value={page}
              onChange={(event) => handlePageInput(event.target.value)}
              aria-label="Page number"
              className="h-7 w-14 rounded-md border border-border bg-background px-1.5 text-center text-xs text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span>/ {numPages || "–"}</span>
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(clampPage(page + 1))}
            disabled={!numPages || page >= numPages}
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
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
            className="inline-flex h-7 min-w-12 items-center justify-center rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => adjustZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="outline"
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
            className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/20 p-4"
      >
        {loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <p>Could not render the PDF.</p>
            <p className="text-xs">{loadError}</p>
          </div>
        ) : (
          <Document
            key={fileUrl}
            file={fileUrl}
            onLoadSuccess={({ numPages: total }) => {
              setNumPages(total);
              setIsLoading(false);
              setLoadError(null);
              if (page > total) {
                onPageChange(total);
              }
            }}
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
              <Page
                pageNumber={page}
                width={containerWidth * zoom}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="overflow-hidden rounded-lg border border-border bg-white shadow-sm"
                loading={
                  <div className="flex h-40 items-center justify-center">
                    <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                  </div>
                }
              />
            )}
          </Document>
        )}
      </div>
    </div>
  );
}
