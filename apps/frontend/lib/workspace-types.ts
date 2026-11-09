export const GUEST_CHAT_LIMIT = 3;
export const GUEST_UPLOAD_LIMIT = 1;

export type ViewerState = {
  isAuthenticated: boolean;
  name: string | null;
  email: string | null;
};

export type Citation = {
  label: string;
  page: number | null;
  chunk?: number | null;
};

export type QuizQuestion = {
  question: string;
  answer: string;
};

export type SourceKind = "pdf" | "docx" | "txt" | "md" | "url";

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  pdf: "PDF",
  docx: "DOCX",
  txt: "TXT",
  md: "Markdown",
  url: "URL",
};

export function normalizeSourceKind(
  value: string | null | undefined
): SourceKind | null {
  if (!value) {
    return null;
  }

  const candidate = value.trim().toLowerCase();
  return candidate in SOURCE_KIND_LABEL ? (candidate as SourceKind) : null;
}

/** Fallback when a snapshot has no backend kind (the frontend DB has no column). */
export function sourceKindFromFileName(fileName: string): SourceKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (lower.endsWith(".docx")) {
    return "docx";
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "md";
  }
  if (lower.endsWith(".txt")) {
    return "txt";
  }
  return "pdf";
}

export function sourceKindOf(document: {
  fileName: string;
  sourceKind?: SourceKind;
}): SourceKind {
  return document.sourceKind ?? sourceKindFromFileName(document.fileName);
}

export function isPdfDocument(document: {
  fileName: string;
  sourceKind?: SourceKind;
}): boolean {
  return sourceKindOf(document) === "pdf";
}

export type DocumentSummary = {
  documentId: string;
  fileName: string;
  status: "queued" | "indexing" | "ready" | "failed";
  chunksIndexed: number | null;
  chatsUsed: number;
  createdAt: string;
  /** Set from backend responses; derived from the file name as a fallback. */
  sourceKind?: SourceKind;
  mimeType?: string;
  summary?: string | null;
  keyPoints?: string[];
  actionItems?: string[];
  quiz?: QuizQuestion[];
  /** Indexing failure message from the backend, if any. */
  error?: string | null;
  /** pending while insights generate; ready/unavailable once they finish. */
  insightsStatus?: "pending" | "ready" | "unavailable";
  /** True when queued/indexing has not progressed for too long. */
  stalled?: boolean;
};

export function hasDocumentInsights(
  document: DocumentSummary | null
): boolean {
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

export type WorkspaceState = {
  viewer: ViewerState;
  limits: {
    maxChats: number | null;
    remainingChats: number | null;
    chatsUsed: number;
    uploadCount: number;
    uploadAllowed: boolean;
    limitReached: boolean;
  };
  activeDocument: DocumentSummary | null;
  documents: DocumentSummary[];
};

export type UploadDocumentResponse = {
  document: DocumentSummary;
};

export type ChatDocumentResponse = {
  answer: string;
  remainingChats: number | null;
  sources?: string[];
};
