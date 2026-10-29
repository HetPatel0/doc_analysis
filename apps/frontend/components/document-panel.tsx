"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { FileText, LoaderCircle, Sparkles } from "lucide-react";

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
};

export function DocumentPanel({ document, page, onPageChange }: DocumentPanelProps) {
  const [tab, setTab] = useState<"pdf" | "insights">("pdf");

  if (!document) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-muted/10 px-6 text-center">
        <FileText className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No PDF selected</p>
        <p className="max-w-xs text-xs leading-5 text-muted-foreground">
          Upload or pick a document to read it side by side with the chat.
        </p>
      </div>
    );
  }

  const hasInsights =
    Boolean(document.summary) ||
    (document.keyPoints?.length ?? 0) > 0 ||
    (document.actionItems?.length ?? 0) > 0 ||
    (document.quiz?.length ?? 0) > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("pdf")}
            aria-pressed={tab === "pdf"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === "pdf"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
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
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === "insights"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="size-3.5" />
            Insights
            {hasInsights ? (
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            ) : null}
          </button>
        </div>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {document.fileName}
        </p>
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
