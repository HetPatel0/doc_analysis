"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { FileText, LoaderCircle, Sparkles, Trash2 } from "lucide-react";

import { DocumentInsights } from "@/components/document-insights";
import type { DocumentSummary } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

type DocumentPanelProps = {
  document: DocumentSummary | null;
  page: number;
  onPageChange: (page: number) => void;
  isDeleting?: boolean;
  onDelete?: () => void;
};

export function DocumentPanel({
  document,
  page,
  onPageChange,
  isDeleting = false,
  onDelete,
}: DocumentPanelProps) {
  const [tab, setTab] = useState<"pdf" | "insights">("pdf");

  if (!document) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-2xl border border-border bg-card/60">
          <FileText className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No PDF selected</p>
          <p className="max-w-xs text-xs leading-5 text-muted-foreground">
            Add a document to read it here, side by side with the chat.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("pdf")}
            aria-pressed={tab === "pdf"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === "pdf"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            <FileText className="size-3.5" />
            PDF
          </button>
          <button
            type="button"
            onClick={() => setTab("insights")}
            aria-pressed={tab === "insights"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === "insights"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            <Sparkles className="size-3.5" />
            Insights
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <p
            title={document.fileName}
            className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block"
          >
            {document.fileName}
          </p>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label="Delete document"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
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

      {tab === "pdf" ? (
        document.status === "ready" ? (
          <PdfViewer
            fileUrl={`/api/documents/${document.documentId}/file`}
            page={page}
            onPageChange={onPageChange}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {document.status === "failed"
                ? "This document could not be indexed."
                : "Preparing the PDF preview…"}
            </p>
          </div>
        )
      ) : (
        <DocumentInsights document={document} />
      )}
    </div>
  );
}
