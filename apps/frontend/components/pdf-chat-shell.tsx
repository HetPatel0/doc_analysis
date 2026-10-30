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
  const viewerPage =
    viewer.documentId === activeDocumentId ? viewer.page : 1;
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

  const composerHint =
    limitReached && !isAuthenticated
      ? "Guest limit reached. Log in to continue."
      : documentReady
        ? chat.isSending
          ? "Waiting for the response…"
          : "Enter to send · Shift + Enter for a new line"
        : document
          ? "Document is indexing…"
          : "Add a PDF to enable chat";

  return (
    <main className="app-canvas flex h-[100dvh] w-full overflow-hidden">
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
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
              B
            </div>
            {documents.length > 1 ? (
              <select
                value={activeDocumentId ?? ""}
                onChange={(event) =>
                  void handleSelectDocument(event.target.value)
                }
                aria-label="Switch document"
                className="min-w-0 max-w-[180px] truncate rounded-md border border-border/70 bg-card/70 px-2 py-1 text-xs text-foreground"
              >
                {documents.map((doc) => (
                  <option key={doc.documentId} value={doc.documentId}>
                    {doc.fileName}
                  </option>
                ))}
              </select>
            ) : (
              <p className="truncate text-sm font-semibold tracking-tight">
                Bookify
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
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
                className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuth("sign-in")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground"
              >
                <LogIn className="size-3.5" />
                Log in
              </button>
            )}
          </div>
        </div>

        {/* Mobile pane switcher */}
        <div className="flex shrink-0 gap-1 border-b border-border/70 p-2 md:hidden">
          {(["document", "chat"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              aria-pressed={mobileTab === tab}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                mobileTab === tab
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 md:flex-row">
          <section
            className={cn(
              "min-h-0 min-w-0 flex-1 md:flex",
              mobileTab === "document" ? "flex" : "hidden"
            )}
          >
            <DocumentPanel
              key={document?.documentId ?? "none"}
              document={document}
              page={viewerPage}
              onPageChange={setViewerPage}
              isDeleting={Boolean(
                document && deletingDocumentId === document.documentId
              )}
              onDelete={
                document ? () => void handleDelete(document.documentId) : undefined
              }
            />
          </section>

          <section
            className={cn(
              "min-h-0 min-w-0 border-border/70 md:flex md:w-[400px] md:flex-none md:border-l lg:w-[420px] xl:w-[470px]",
              mobileTab === "chat" ? "flex" : "hidden"
            )}
          >
            <PdfDropzone
              onFile={(file) => void handleUpload(file)}
              onInvalid={(message) => chat.appendAssistant(message)}
              disabled={uploadDisabled}
              isUploading={isPreparing}
              progress={uploadProgress}
              className="flex h-full min-h-0 w-full flex-col"
            >
              <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3.5">
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
                            : "bg-muted-foreground/50"
                    )}
                  />
                  <p className="shrink-0 text-sm font-medium text-foreground">
                    Assistant
                  </p>
                  {document ? (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {document.fileName}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {document ? statusText[document.status] : "No document"}
                </span>
              </div>

              <div
                ref={messagesViewportRef}
                onScroll={handleMessagesScroll}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                {isChatEmpty ? (
                  <div className="flex min-h-full items-center justify-center px-6 py-10">
                    <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
                      <div className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                        <FileText className="size-5" />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-base font-semibold tracking-tight text-foreground">
                          Start with a PDF
                        </p>
                        <p className="text-[13px] leading-6 text-muted-foreground">
                          Guest mode includes one document and three questions.
                          Drag a file anywhere in this panel, or choose one
                          below.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadDisabled}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPreparing ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <FileText className="size-4" />
                        )}
                        Choose PDF
                      </button>
                      {!uploadAllowed && !isAuthenticated ? (
                        <p className="text-xs text-muted-foreground">
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
                  <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-5">
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

              <div className="shrink-0 px-3 pb-3 pt-1">
                {documentReady ? (
                  <div className="flex flex-wrap gap-1.5 pb-2">
                    {starterPrompts.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                        onClick={() => chat.setPrompt(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="glass rounded-2xl border border-border/70 p-1.5 shadow-sm">
                  <Textarea
                    value={chat.prompt}
                    onChange={(event) => chat.setPrompt(event.target.value)}
                    placeholder={
                      documentReady
                        ? "Ask about the PDF…"
                        : document
                          ? "Wait until indexing finishes"
                          : "Upload a PDF to enable chat"
                    }
                    disabled={
                      !documentReady ||
                      chat.isSending ||
                      (limitReached && !isAuthenticated)
                    }
                    className="min-h-[52px] max-h-40 resize-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none focus-visible:ring-0"
                  />
                  <div className="flex items-center justify-between gap-2 px-0.5 pb-0.5">
                    <div className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadDisabled}
                        aria-label={document ? "Replace PDF" : "Upload PDF"}
                      >
                        {isPreparing ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Paperclip className="size-3.5" />
                        )}
                      </button>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {document?.fileName ?? "No document loaded"}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden max-w-[150px] truncate text-[11px] text-muted-foreground sm:block">
                        {composerHint}
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
                        className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {chat.isSending ? (
                          <Square className="size-3.5" />
                        ) : (
                          <ArrowUp className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
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
