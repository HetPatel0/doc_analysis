"use client";

import { useCallback, useState } from "react";

import { reportError } from "@/lib/errors";
import type { DocumentSummary, WorkspaceState } from "@/lib/workspace-types";

type ErrorResponse = { detail?: string };

function hasInsights(document: DocumentSummary | null): boolean {
  if (!document) {
    return false;
  }

  return (
    Boolean(document.summary) ||
    (document.keyPoints?.length ?? 0) > 0 ||
    (document.actionItems?.length ?? 0) > 0 ||
    (document.quiz?.length ?? 0) > 0
  );
}

/**
 * Workspace snapshots do not carry generated insights. Keep the details we
 * already fetched for the same document instead of clobbering them on refresh.
 */
function mergeDocumentDetails(
  next: DocumentSummary | null,
  current: DocumentSummary | null
): DocumentSummary | null {
  if (!next) {
    return next;
  }

  if (
    !current ||
    current.documentId !== next.documentId ||
    hasInsights(next) ||
    !hasInsights(current)
  ) {
    return next;
  }

  return {
    ...next,
    summary: current.summary,
    keyPoints: current.keyPoints,
    actionItems: current.actionItems,
    quiz: current.quiz,
  };
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [document, setDocument] = useState<DocumentSummary | null>(null);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  const refresh = useCallback(async (): Promise<WorkspaceState | null> => {
    setIsWorkspaceLoading(true);

    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const result =
        ((await response.json()) as WorkspaceState & ErrorResponse) ?? {};

      if (!response.ok) {
        throw new Error(result.detail ?? "Could not load workspace.");
      }

      setWorkspace(result);
      setDocument((current) =>
        mergeDocumentDetails(result.activeDocument, current)
      );
      return result;
    } catch (error) {
      reportError(error, { scope: "useWorkspace.refresh" });
      throw error;
    } finally {
      setIsWorkspaceLoading(false);
    }
  }, []);

  const deleteDocument = useCallback(async (documentId: string) => {
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "DELETE",
      });
      const result = ((await response.json()) as ErrorResponse) ?? {};

      if (!response.ok) {
        throw new Error(result.detail ?? "Could not delete the document.");
      }

      setDocument(null);
    } catch (error) {
      reportError(error, { scope: "useWorkspace.deleteDocument" });
      throw error;
    } finally {
      setIsDeleting(false);
    }
  }, []);

  const selectDocument = useCallback(async (documentId: string) => {
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const result =
        ((await response.json()) as WorkspaceState & ErrorResponse) ?? {};

      if (!response.ok) {
        throw new Error(result.detail ?? "Could not switch documents.");
      }

      setWorkspace(result);
      setDocument((current) =>
        mergeDocumentDetails(result.activeDocument, current)
      );
      return result;
    } catch (error) {
      reportError(error, { scope: "useWorkspace.selectDocument" });
      throw error;
    }
  }, []);

  return {
    workspace,
    document,
    setDocument,
    isWorkspaceLoading,
    isDeleting,
    refresh,
    deleteDocument,
    selectDocument,
  };
}
