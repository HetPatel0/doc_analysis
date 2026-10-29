"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowUp,
  FileText,
  LoaderCircle,
  LogIn,
  LogOut,
  Moon,
  Paperclip,
  Square,
  Sun,
  Trash2,
  UserPlus,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { toErrorMessage } from "@/lib/errors";
import { uploadPdfWithProgress, validatePdfFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { GUEST_CHAT_LIMIT, type DocumentSummary } from "@/lib/workspace-types";

import { AuthForm, type AuthMode } from "@/components/auth-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat-message";
import { DocSidebar } from "@/components/doc-sidebar";
import { DocumentPanel } from "@/components/document-panel";
import { PdfDropzone } from "@/components/pdf-dropzone";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import { useWorkspace } from "@/hooks/use-workspace";

type ErrorResponse = { detail?: string };

const starterPrompts = [
  "Summarize the PDF in five bullet points.",
  "List the key action items.",
  "Explain the main argument in plain English.",
];

export default function PdfChatShell() {
  const sessionQuery = authClient.useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const detailsFetchedRef = useRef<string | null>(null);

  const { theme, toggleTheme } = useTheme();
  const workspace = useWorkspace();

  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(
    null
  );
  const [viewer, setViewer] = useState<{
    documentId: string | null;
    page: number;
  }>({ documentId: null, page: 1 });
  const [mobileTab, setMobileTab] = useState<"chat" | "document">("chat");

  function scrollMessagesToBottom() {
    const viewport = messagesViewportRef.current;
    if (!viewport || !shouldAutoScrollRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
  }

  const chat = useChat({
    document: workspace.document,
    onStreamUpdate: scrollMessagesToBottom,
    onAfterSend: () => {
      void workspace.refresh().catch(() => undefined);
    },
    onLimitReached: () => setShowAuthForm(true),
  });

  const document = workspace.document;
  const documents = workspace.workspace?.documents ?? [];
  const isAuthenticated = workspace.workspace?.viewer.isAuthenticated ?? false;
  const remainingChats = workspace.workspace?.limits.remainingChats ?? null;
  const limitReached = workspace.workspace?.limits.limitReached ?? false;
  const uploadAllowed = workspace.workspace?.limits.uploadAllowed ?? true;
  const documentReady = document?.status === "ready";

  const canSend =
    Boolean(document?.documentId) &&
    documentReady &&
    Boolean(chat.prompt.trim()) &&
    !chat.isSending &&
    !isPreparing &&
    (!limitReached || isAuthenticated);

  async function loadWorkspace() {
    try {
      await workspace.refresh();
    } catch (error) {
      chat.appendAssistant(
        toErrorMessage(error, "Could not load the workspace.")
      );
    }
  }

  useEffect(() => {
    void loadWorkspace();
    // Better Auth updates its own session atom; this re-syncs app-specific state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQuery.data?.user?.id]);

  useEffect(() => {
    if (limitReached && !isAuthenticated) {
      setShowAuthForm(true);
    }
  }, [isAuthenticated, limitReached]);

  const activeDocumentId = document?.documentId ?? null;
  const viewerPage =
    viewer.documentId === activeDocumentId ? viewer.page : 1;

  useEffect(() => {
    if (!activeDocumentId || document?.status !== "ready") {
      return;
    }
    if (detailsFetchedRef.current === activeDocumentId) {
      return;
    }
    detailsFetchedRef.current = activeDocumentId;

    let cancelled = false;

    async function loadDocumentDetails() {
      try {
        const response = await fetch(`/api/documents/${activeDocumentId}`, {
          cache: "no-store",
        });
        const result =
          ((await response.json()) as DocumentSummary & ErrorResponse) ?? {};

        if (!cancelled && response.ok && result.documentId) {
          workspace.setDocument(result);
        } else if (!cancelled) {
          detailsFetchedRef.current = null;
        }
      } catch {
        // Insights are optional; keep the chat usable if this fails.
        if (!cancelled) {
          detailsFetchedRef.current = null;
        }
      }
    }

    void loadDocumentDetails();
    return () => {
      cancelled = true;
    };
  }, [activeDocumentId, document?.status, workspace]);

  function setViewerPage(page: number) {
    setViewer({ documentId: activeDocumentId, page });
  }

  function handleCitationClick(page: number) {
    setViewerPage(page);
    setMobileTab("document");
  }

  function handleMessagesScroll() {
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }

    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

    shouldAutoScrollRef.current = distanceFromBottom < 96;
  }

  async function pollDocumentStatus(documentId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await fetch(`/api/documents/${documentId}`, {
        cache: "no-store",
      });
      const result =
        ((await response.json()) as DocumentSummary & ErrorResponse) ?? {};

      if (!response.ok || !result.documentId) {
        throw new Error(result.detail ?? "Could not fetch document status.");
      }

      workspace.setDocument(result);

      if (result.status === "ready") {
        await workspace.refresh().catch(() => undefined);
        chat.appendAssistant(
          `The document is ready. Indexed ${result.chunksIndexed ?? 0} chunks from "${result.fileName}".`
        );
        return;
      }

      if (result.status === "failed") {
        throw new Error("Document indexing failed. Please try another PDF.");
      }
    }

    throw new Error("Indexing is taking too long. Please try again shortly.");
  }

  async function handleUpload(file: File) {
    const validationError = validatePdfFile(file);
    if (validationError) {
      chat.appendAssistant(validationError);
      return;
    }

    setIsPreparing(true);
    setUploadProgress(0);
    shouldAutoScrollRef.current = true;

    try {
      const result = await uploadPdfWithProgress(file, setUploadProgress);

      if (!result.document) {
        throw new Error("Could not upload the PDF.");
      }

      workspace.setDocument(result.document);
      await workspace.refresh().catch(() => undefined);
      await pollDocumentStatus(result.document.documentId);
      scrollMessagesToBottom();
    } catch (error) {
      const message = toErrorMessage(error, "Could not upload the PDF.");
      chat.appendAssistant(message);

      if (/guest mode/i.test(message)) {
        setShowAuthForm(true);
      }
    } finally {
      setIsPreparing(false);
      setUploadProgress(0);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (file) {
      void handleUpload(file);
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    workspace.setDocument(null);
    setShowAuthForm(false);
    await loadWorkspace();
  }

  async function handleDelete(documentId: string) {
    if (workspace.isDeleting) {
      return;
    }

    setDeletingDocumentId(documentId);

    try {
      await workspace.deleteDocument(documentId);
      await loadWorkspace();
    } catch (error) {
      chat.appendAssistant(
        toErrorMessage(error, "Could not delete the document.")
      );
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function handleSelectDocument(documentId: string) {
    if (documentId === document?.documentId) {
      return;
    }

    try {
      await workspace.selectDocument(documentId);
    } catch (error) {
      chat.appendAssistant(
        toErrorMessage(error, "Could not switch documents.")
      );
    }
  }

  async function handleAuthenticated() {
    setShowAuthForm(false);
    await loadWorkspace();
  }

  const topBadge = isAuthenticated
    ? "Unlimited chats"
    : `${remainingChats ?? GUEST_CHAT_LIMIT} / ${GUEST_CHAT_LIMIT} chats left`;

  const uploadDisabled = isPreparing || (!uploadAllowed && !isAuthenticated);

  return (
    <main className="h-[100dvh] overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <div className="mx-auto flex h-full max-w-7xl overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-lg">
        <div className="hidden h-full md:block">
          <DocSidebar
            documents={documents}
            activeDocumentId={document?.documentId ?? null}
            deletingDocumentId={deletingDocumentId}
            uploadDisabled={uploadDisabled}
            isUploading={isPreparing}
            onSelect={(documentId) => void handleSelectDocument(documentId)}
            onDelete={(documentId) => void handleDelete(documentId)}
            onUpload={() => fileInputRef.current?.click()}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />

          <header className="border-b border-border px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-background text-sm font-semibold">
                  B
                </span>
                <div>
                  <p className="text-base font-semibold tracking-[-0.02em] text-foreground">
                    Bookify
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Chat with your documents.
                  </p>
                </div>
              </div>
              {documents.length > 1 ? (
                <select
                  value={document?.documentId ?? ""}
                  onChange={(event) =>
                    void handleSelectDocument(event.target.value)
                  }
                  aria-label="Switch document"
                  className="block w-full max-w-xs rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground md:hidden"
            >
                  {documents.map((doc) => (
                    <option key={doc.documentId} value={doc.documentId}>
                      {doc.fileName}
                    </option>
                  ))}
                </select>
              ) : null}
              {document ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="rounded-full px-2.5 py-1">
                    {document.status}
                  </Badge>
                  <span>{document.fileName}</span>
                  {document.chunksIndexed ? (
                    <span>{document.chunksIndexed} chunks indexed</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleDelete(document.documentId)}
                    disabled={workspace.isDeleting || isPreparing}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 transition-colors hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingDocumentId === document.documentId ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                    Delete
                  </button>
                </div>
              ) : (
                <p className="pt-1 text-xs text-muted-foreground">
                  Upload a PDF to start the conversation.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full px-3 py-1.5">{topBadge}</Badge>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleTheme}
                aria-label="Toggle dark mode"
              >
                {theme === "dark" ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
              </Button>
              {isAuthenticated ? (
                <>
                  <div className="hidden rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground sm:block">
                    {workspace.workspace?.viewer.email ?? "Signed in"}
                  </div>
                  <Button variant="outline" onClick={handleSignOut}>
                    <LogOut className="size-4" />
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAuthMode("sign-in");
                      setShowAuthForm((current) => !current || authMode !== "sign-in");
                    }}
                  >
                    <LogIn className="size-4" />
                    Log in
                  </Button>
                  <Button
                    onClick={() => {
                      setAuthMode("sign-up");
                      setShowAuthForm((current) => !current || authMode !== "sign-up");
                    }}
                  >
                    <UserPlus className="size-4" />
                    Create account
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        {showAuthForm && !isAuthenticated ? (
          <AuthForm
            mode={authMode}
            onModeChange={setAuthMode}
            onClose={() => setShowAuthForm(false)}
            onAuthenticated={handleAuthenticated}
          />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="flex items-center gap-1 border-b border-border p-2 md:hidden">
            {(["chat", "document"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMobileTab(tab)}
                aria-pressed={mobileTab === tab}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  mobileTab === tab
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === "chat" ? "Chat" : "Document"}
              </button>
            ))}
          </div>

          <section
            className={cn(
              "min-h-0 flex-1 border-border md:flex md:max-w-[56%] md:border-r",
              mobileTab === "document" ? "flex" : "hidden"
            )}
          >
            <DocumentPanel
              key={document?.documentId ?? "none"}
              document={document}
              page={viewerPage}
              onPageChange={setViewerPage}
            />
          </section>

          <section
            className={cn(
              "min-h-0 flex-1 md:flex",
              mobileTab === "chat" ? "flex" : "hidden"
            )}
          >
            <PdfDropzone
              onFile={(file) => void handleUpload(file)}
              onInvalid={(message) => chat.appendAssistant(message)}
              disabled={uploadDisabled}
              isUploading={isPreparing}
              progress={uploadProgress}
              className="grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden"
            >
              <div
                ref={messagesViewportRef}
                onScroll={handleMessagesScroll}
                className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
              >
                {!document &&
                !workspace.isWorkspaceLoading &&
                chat.messages.every((message) => message.id === "welcome") ? (
                  <div className="flex min-h-full items-center justify-center">
                    <div className="flex max-w-xl flex-col items-center justify-center gap-5 rounded-[1.5rem] border border-dashed border-border bg-background px-6 py-12 text-center">
                      <div className="space-y-2">
                        <p className="text-lg font-medium text-foreground">
                          Upload a PDF to start
                        </p>
                        <p className="max-w-md text-sm leading-6 text-muted-foreground">
                          Guest mode gives one document and three questions. Log in if
                          you want to keep going after that. You can also drag a PDF
                          anywhere on this panel.
                        </p>
                      </div>
                      <Button
                        size="lg"
                        className="h-11 rounded-xl px-5"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadDisabled}
                      >
                        {isPreparing ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <FileText className="size-4" />
                        )}
                        Choose PDF
                      </Button>

                      {!uploadAllowed && !isAuthenticated ? (
                        <p className="text-sm text-muted-foreground">
                          Guest upload already used. Log in to upload another file.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-full flex-col gap-4 pb-2">
                    {chat.messages.map((message) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        onRetry={(retryPrompt) => void chat.handleSend(retryPrompt)}
                        onCitationClick={handleCitationClick}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-border bg-card px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 transition-colors hover:border-foreground/15 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadDisabled}
                    >
                      {isPreparing ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Paperclip className="size-3.5" />
                      )}
                      {document ? "Replace PDF" : "Upload PDF"}
                    </button>
                    {document ? (
                      <span>{document.fileName}</span>
                    ) : (
                      <span>No document loaded</span>
                    )}
                  </div>

                  {!isAuthenticated ? (
                    <span className="text-xs text-muted-foreground">
                      {remainingChats ?? GUEST_CHAT_LIMIT} guest chats remaining
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Logged in as {workspace.workspace?.viewer.email ?? "user"}
                    </span>
                  )}
                </div>

                {documentReady ? (
                  <div className="flex flex-wrap gap-2 pb-3">
                    {starterPrompts.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/15 hover:text-foreground"
                        onClick={() => chat.setPrompt(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="rounded-[1.5rem] border border-border bg-background p-3">
                  <Textarea
                    value={chat.prompt}
                    onChange={(event) => chat.setPrompt(event.target.value)}
                    placeholder={
                      documentReady
                        ? "Ask about the PDF..."
                        : document
                          ? "Wait until indexing finishes"
                          : "Upload a PDF to enable chat"
                    }
                    disabled={
                      !documentReady || chat.isSending || (limitReached && !isAuthenticated)
                    }
                    className="min-h-24 max-h-48 resize-y border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                    <p className="text-xs text-muted-foreground">
                      {limitReached && !isAuthenticated
                        ? "Guest limit reached. Log in to continue with this document."
                        : documentReady
                          ? chat.isSending
                            ? "Waiting for the response."
                            : "Document is ready."
                          : document
                            ? "Document is indexing."
                            : "No document uploaded yet."}
                    </p>
                    <Button
                      size="icon-lg"
                      className="rounded-xl"
                      onClick={chat.isSending ? chat.handleStop : () => void chat.handleSend()}
                      disabled={!chat.isSending && !canSend}
                      aria-label={chat.isSending ? "Stop generating" : "Send message"}
                    >
                      {chat.isSending ? (
                        <Square className="size-4" />
                      ) : (
                        <ArrowUp className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </PdfDropzone>
          </section>
        </div>
        </div>
      </div>
    </main>
  );
}
