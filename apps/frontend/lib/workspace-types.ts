export const GUEST_CHAT_LIMIT = 3;
export const GUEST_UPLOAD_LIMIT = 1;

export type ViewerState = {
  isAuthenticated: boolean;
  name: string | null;
  email: string | null;
};

export type DocumentSummary = {
  documentId: string;
  fileName: string;
  status: "queued" | "indexing" | "ready" | "failed";
  chunksIndexed: number | null;
  chatsUsed: number;
  createdAt: string;
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
};

export type UploadDocumentResponse = {
  document: DocumentSummary;
};

export type ChatDocumentResponse = {
  answer: string;
  remainingChats: number | null;
};
