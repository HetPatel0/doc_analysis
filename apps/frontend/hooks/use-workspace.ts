"use client";

import { useCallback, useState } from "react";

import { reportError } from "@/lib/errors";
import type { DocumentSummary, WorkspaceState } from "@/lib/workspace-types";

type ErrorResponse = { detail?: string };

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
      setDocument(result.activeDocument);
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
      setDocument(result.activeDocument);
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
