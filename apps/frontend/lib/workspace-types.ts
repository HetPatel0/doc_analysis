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

export type DocumentSummary = {
  documentId: string;
  fileName: string;
  status: "queued" | "indexing" | "ready" | "failed";
  chunksIndexed: number | null;
  chatsUsed: number;
  createdAt: string;
  summary?: string | null;
  keyPoints?: string[];
  actionItems?: string[];
  quiz?: QuizQuestion[];
};

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
