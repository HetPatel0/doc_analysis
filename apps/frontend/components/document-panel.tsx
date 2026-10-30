"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { FileText, LoaderCircle, Trash2 } from "lucide-react";

import { DocumentInsights } from "@/components/document-insights";
import type { DocumentSummary } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

/**
 * Same silhouette as the first PDF page, used while the workspace snapshot or
 * the viewer chunk is still loading. Keeping the pane occupied with paper
 * avoids the blank pane that used to flash before the document appeared.
 */
function PaperPlaceholder() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 justify-center px-5 py-6">
      <div className="h-full w-full max-w-[980px] bg-muted/40" />
    </div>
  );
}

const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => <PaperPlaceholder />,
  }
);

type DocumentPanelProps = {
  document: DocumentSummary | null;
  isLoading?: boolean;
  page: number;
  onPageChange: (page: number) => void;
  isDeleting?: boolean;
  onDelete?: () => void;
};

export function DocumentPanel({
  document,
  isLoading = false,
  page,
  onPageChange,
  isDeleting = false,
  onDelete,
}: DocumentPanelProps) {
  const [tab, setTab] = useState<"pdf" | "insights">("pdf");

  if (!document) {
    // While the workspace snapshot is still in flight, show a paper-shaped
    // placeholder instead of the empty state. Without it the pane says
    // "No document selected" and then swaps to a PDF, which reads as flicker.
    if (isLoading) {
      return <PaperPlaceholder />;
    }

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <FileText className="size-4 text-muted-foreground/50" />
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-medium text-foreground">
            No document selected
          </p>
          <p className="max-w-xs text-[11.5px] leading-5 text-muted-foreground">
            Add a PDF to read it here, side by side with the chat.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={() => setTab("pdf")}
            aria-pressed={tab === "pdf"}
            className={cn(
              "flex items-center gap-1.5 text-[12px] font-medium transition-colors",
              tab === "pdf"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1 rounded-full transition-colors",
                tab === "pdf" ? "bg-primary" : "bg-transparent"
              )}
            />
            PDF
          </button>

          <button
            type="button"
            onClick={() => setTab("insights")}
            aria-pressed={tab === "insights"}
            className={cn(
              "flex items-center gap-1.5 text-[12px] font-medium transition-colors",
              tab === "insights"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1 rounded-full transition-colors",
                tab === "insights" ? "bg-primary" : "bg-transparent"
              )}
            />
            Insights
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <p
            title={document.fileName}
            className="hidden min-w-0 truncate font-mono text-[10px] tracking-[0.02em] text-muted-foreground/70 sm:block"
          >
            {document.fileName}
          </p>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label="Delete document"
              className="flex size-7 shrink-0 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-foreground/[0.06] hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isDeleting ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            tab === "pdf" ? "flex" : "hidden"
          )}
        >
          {document.status === "ready" ? (
            <PdfViewer
              key={document.documentId}
              fileUrl={`/api/documents/${document.documentId}/file`}
              page={page}
              onPageChange={onPageChange}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <LoaderCircle className="size-4 animate-spin text-muted-foreground/60" />
              <p className="text-[12px] text-muted-foreground">
                {document.status === "failed"
                  ? "This document could not be indexed."
                  : "Preparing the PDF preview…"}
              </p>
            </div>
          )}
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            tab === "insights" ? "flex" : "hidden"
          )}
        >
          <DocumentInsights document={document} />
        </div>
      </div>
    </div>
  );
}
