"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowUp,
  FileText,
  LoaderCircle,
  LogIn,
  Moon,
  Paperclip,
  Plus,
  Square,
  Sun,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { toErrorMessage } from "@/lib/errors";
import { uploadPdfWithProgress, validatePdfFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { GUEST_CHAT_LIMIT, type DocumentSummary } from "@/lib/workspace-types";

import { AuthForm, type AuthMode } from "@/components/auth-form";
import { ChatMessage } from "@/components/chat-message";
import { DocSidebar } from "@/components/doc-sidebar";
import { DocumentPanel } from "@/components/document-panel";
import { PdfDropzone } from "@/components/pdf-dropzone";
import { ScrollArea } from "@/components/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import { useWorkspace } from "@/hooks/use-workspace";

type ErrorResponse = { detail?: string };

const starterPrompts = [
  "Summarize this PDF",
  "List the key action items",
  "Explain the main argument",
];

const statusText: Record<DocumentSummary["status"], string> = {
  queued: "Queued",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

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

  // Warm the PDF chunk during idle startup so opening the first document never
  // shows a dynamic-import spinner.
  useEffect(() => {
    void import("@/components/pdf-viewer");
  }, []);

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
  const userEmail = workspace.workspace?.viewer.email ?? null;
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
  const viewerPage = viewer.documentId === activeDocumentId ? viewer.page : 1;
  const setDocument = workspace.setDocument;

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
          setDocument(result);
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
  }, [activeDocumentId, document?.status, setDocument]);

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
      setMobileTab("document");
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

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    setShowAuthForm(true);
  }

  const uploadDisabled = isPreparing || (!uploadAllowed && !isAuthenticated);
  const isChatEmpty =
    !document &&
    !workspace.isWorkspaceLoading &&
    chat.messages.every((message) => message.id === "welcome");
  const showStarters =
    documentReady && chat.messages.every((message) => message.role !== "user");

  const composerHint =
    limitReached && !isAuthenticated
      ? "Guest limit reached — log in to continue"
      : documentReady
        ? chat.isSending
          ? "Waiting for the response…"
          : "Enter to send · Shift + Enter for a new line"
        : document
          ? "Document is indexing…"
          : "Add a PDF to enable chat";

  return (
    <main className="app-canvas relative flex h-[100dvh] w-full overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      <DocSidebar
        documents={documents}
        activeDocumentId={activeDocumentId}
        deletingDocumentId={deletingDocumentId}
        uploadDisabled={uploadDisabled}
        isUploading={isPreparing}
        remainingChats={remainingChats ?? GUEST_CHAT_LIMIT}
        isAuthenticated={isAuthenticated}
        userEmail={userEmail}
        theme={theme}
        onSelect={(documentId) => void handleSelectDocument(documentId)}
        onDelete={(documentId) => void handleDelete(documentId)}
        onUpload={() => fileInputRef.current?.click()}
        onToggleTheme={toggleTheme}
        onSignIn={() => openAuth("sign-in")}
        onSignUp={() => openAuth("sign-up")}
        onSignOut={() => void handleSignOut()}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3 xl:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center bg-primary font-mono text-[10px] font-semibold text-primary-foreground">
              B
            </div>
            {documents.length > 1 ? (
              <select
                value={activeDocumentId ?? ""}
                onChange={(event) =>
                  void handleSelectDocument(event.target.value)
                }
                aria-label="Switch document"
                className="max-w-[170px] truncate bg-foreground/[0.05] px-2 py-1 text-[11px] text-foreground outline-none"
              >
                {documents.map((doc) => (
                  <option key={doc.documentId} value={doc.documentId}>
                    {doc.fileName}
                  </option>
                ))}
              </select>
            ) : (
              <p className="truncate text-[13px] font-semibold tracking-tight">
                Bookify
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadDisabled}
              aria-label="Add PDF"
              className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40"
            >
              {isPreparing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
            </button>
            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="flex h-8 items-center px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuth("sign-in")}
                className="flex h-7 items-center gap-1.5 bg-primary px-2.5 text-[11px] font-medium text-primary-foreground"
              >
                <LogIn className="size-3.5" />
                Log in
              </button>
            )}
          </div>
        </div>

        {/* Mobile pane switcher */}
        <div className="flex shrink-0 gap-1 px-2 pb-1 md:hidden">
          {(["document", "chat"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              aria-pressed={mobileTab === tab}
              className={cn(
                "flex h-8 flex-1 items-center justify-center text-[11px] font-medium capitalize transition-colors",
                mobileTab === tab
                  ? "bg-foreground/[0.07] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
          <section
            className={cn(
              "min-h-0 min-w-0 flex-1 md:flex",
              mobileTab === "document" ? "flex" : "hidden"
            )}
          >
            <DocumentPanel
              document={document}
              isLoading={workspace.isWorkspaceLoading}
              page={viewerPage}
              onPageChange={setViewerPage}
              isDeleting={Boolean(
                document && deletingDocumentId === document.documentId
              )}
              onDelete={
                document
                  ? () => void handleDelete(document.documentId)
                  : undefined
              }
            />
          </section>

          <section
            className={cn(
              "min-h-0 min-w-0 bg-card/40 backdrop-blur-2xl md:flex md:w-[352px] md:shrink-0 lg:w-[380px] xl:w-[400px] 2xl:w-[440px]",
              mobileTab === "chat" ? "flex" : "hidden"
            )}
          >
            <PdfDropzone
              onFile={(file) => void handleUpload(file)}
              onInvalid={(message) => chat.appendAssistant(message)}
              disabled={uploadDisabled}
              isUploading={isPreparing}
              progress={uploadProgress}
              className="flex h-full min-h-0 w-full min-w-0 flex-col"
            >
              <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      document?.status === "ready"
                        ? "bg-emerald-500"
                        : document?.status === "failed"
                          ? "bg-destructive"
                          : document
                            ? "animate-pulse bg-amber-500"
                            : "bg-muted-foreground/40"
                    )}
                  />
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Assistant
                  </span>
                  {document ? (
                    <span
                      title={document.fileName}
                      className="min-w-0 truncate text-[11px] text-muted-foreground/60"
                    >
                      {document.fileName}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                  {document ? statusText[document.status] : "Idle"}
                </span>
              </div>

              <ScrollArea
                viewportRef={messagesViewportRef}
                onScroll={handleMessagesScroll}
                className="flex-1"
              >
                {isChatEmpty ? (
                  <div className="flex h-full items-center justify-center px-6 py-10">
                    <div className="flex w-full max-w-[300px] flex-col gap-4">
                      <div className="flex size-9 items-center justify-center bg-foreground/[0.05]">
                        <FileText className="size-4 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[15px] font-semibold tracking-tight text-foreground">
                          Start with a document
                        </p>
                        <p className="text-[12px] leading-5 text-muted-foreground">
                          Drop a PDF anywhere in this panel, or choose a file.
                          Guest mode includes one document and three questions.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadDisabled}
                        className="inline-flex h-8 w-fit items-center gap-2 bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isPreparing ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <FileText className="size-3.5" />
                        )}
                        Choose PDF
                      </button>
                      {!uploadAllowed && !isAuthenticated ? (
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          Guest upload already used.{" "}
                          <button
                            type="button"
                            onClick={() => openAuth("sign-in")}
                            className="font-medium text-foreground underline underline-offset-4"
                          >
                            Log in
                          </button>{" "}
                          to add another file.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-4 py-5">
                    {chat.messages.map((message) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        onRetry={(retryPrompt) =>
                          void chat.handleSend(retryPrompt)
                        }
                        onCitationClick={handleCitationClick}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>

              <div className="shrink-0 px-3 pb-3">
                {showStarters ? (
                  <div className="flex flex-col gap-0.5 pb-2">
                    {starterPrompts.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => chat.setPrompt(item)}
                        className="flex w-fit items-center gap-2 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <span aria-hidden className="text-muted-foreground/40">
                          ›
                        </span>
                        {item}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="bg-card/70 shadow-[0_1px_0_0_rgba(0,0,0,0.02),0_18px_48px_-32px_rgba(0,0,0,0.5)] backdrop-blur-xl">
                  <Textarea
                    value={chat.prompt}
                    onChange={(event) => chat.setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        if (canSend) {
                          void chat.handleSend();
                        }
                      }
                    }}
                    placeholder={
                      documentReady
                        ? "Ask about the document…"
                        : document
                          ? "Wait until indexing finishes"
                          : "Add a PDF to enable chat"
                    }
                    disabled={
                      !documentReady ||
                      chat.isSending ||
                      (limitReached && !isAuthenticated)
                    }
                    className="max-h-40 min-h-[52px] resize-none px-3 py-3 text-[13px] leading-6"
                  />

                  <div className="flex items-center gap-2 px-2 pb-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadDisabled}
                      aria-label={document ? "Replace PDF" : "Upload PDF"}
                      className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isPreparing ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Paperclip className="size-3.5" />
                      )}
                    </button>

                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground/60">
                      {document?.fileName ?? "No document loaded"}
                    </span>

                    <button
                      type="button"
                      onClick={
                        chat.isSending
                          ? chat.handleStop
                          : () => void chat.handleSend()
                      }
                      disabled={!chat.isSending && !canSend}
                      aria-label={
                        chat.isSending ? "Stop generating" : "Send message"
                      }
                      className="flex size-8 shrink-0 items-center justify-center bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {chat.isSending ? (
                        <Square className="size-3" />
                      ) : (
                        <ArrowUp className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                <p className="mt-1.5 truncate px-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/50">
                  {composerHint}
                </p>
              </div>
            </PdfDropzone>
          </section>
        </div>
      </div>

      {showAuthForm && !isAuthenticated ? (
        <AuthForm
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={() => setShowAuthForm(false)}
          onAuthenticated={handleAuthenticated}
        />
      ) : null}
    </main>
  );
}
