"use client";

import { FileText, LoaderCircle, Plus, Trash2 } from "lucide-react";

import type { DocumentSummary } from "@/lib/workspace-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DocSidebarProps = {
  documents: DocumentSummary[];
  activeDocumentId: string | null;
  deletingDocumentId?: string | null;
  uploadDisabled?: boolean;
  isUploading?: boolean;
  onSelect: (documentId: string) => void;
  onDelete: (documentId: string) => void;
  onUpload: () => void;
};

const statusLabel: Record<DocumentSummary["status"], string> = {
  queued: "Queued",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

export function DocSidebar({
  documents,
  activeDocumentId,
  deletingDocumentId,
  uploadDisabled = false,
  isUploading = false,
  onSelect,
  onDelete,
  onUpload,
}: DocSidebarProps) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-background/60">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Documents</p>
          <p className="text-xs text-muted-foreground">
            {documents.length} {documents.length === 1 ? "file" : "files"}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={onUpload}
          disabled={uploadDisabled}
          aria-label="Upload PDF"
        >
          {isUploading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {documents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
            <FileText className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No documents yet. Upload a PDF to start.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {documents.map((doc) => {
              const isActive = doc.documentId === activeDocumentId;
              const isDeleting = doc.documentId === deletingDocumentId;

              return (
                <li key={doc.documentId}>
                  <div
                    className={cn(
                      "group flex items-start gap-2 rounded-xl border px-2.5 py-2 transition-colors",
                      isActive
                        ? "border-foreground/20 bg-card shadow-sm"
                        : "border-transparent hover:border-border hover:bg-card/60"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(doc.documentId)}
                      disabled={isActive}
                      aria-current={isActive}
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                    >
                      <p className="truncate text-sm font-medium text-foreground">
                        {doc.fileName}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full px-2 py-0 text-[10px]",
                            doc.status === "failed" &&
                              "border-destructive/40 text-destructive"
                          )}
                        >
                          {statusLabel[doc.status]}
                        </Badge>
                        {doc.status === "ready" && doc.chunksIndexed ? (
                          <span>{doc.chunksIndexed} chunks</span>
                        ) : null}
                        {doc.chatsUsed ? (
                          <span>{doc.chatsUsed} chats</span>
                        ) : null}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(doc.documentId)}
                      disabled={isDeleting}
                      aria-label={`Delete ${doc.fileName}`}
                      className="mt-0.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDeleting ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
