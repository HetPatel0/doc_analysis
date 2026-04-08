"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  FileText,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Paperclip,
  UserPlus,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import type {
  ChatDocumentResponse,
  DocumentSummary,
  UploadDocumentResponse,
  WorkspaceState,
} from "@/lib/workspace-types";
import { GUEST_CHAT_LIMIT } from "@/lib/workspace-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ErrorResponse = {
  detail?: string;
};

const starterPrompts = [
  "Summarize the PDF in five bullet points.",
  "List the key action items.",
  "Explain the main argument in plain English.",
];

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Upload one PDF to begin. Guest mode allows one document and three chat messages before login is required.",
  },
];

export default function PdfChatShell() {
  const sessionQuery = authClient.useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [document, setDocument] = useState<DocumentSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const isAuthenticated = workspace?.viewer.isAuthenticated ?? false;
  const remainingChats = workspace?.limits.remainingChats ?? null;
  const limitReached = workspace?.limits.limitReached ?? false;
  const uploadAllowed = workspace?.limits.uploadAllowed ?? true;
  const documentReady = document?.status === "ready";

  const canSend =
    Boolean(document?.documentId) &&
    documentReady &&
    Boolean(prompt.trim()) &&
    !isSending &&
    !isPreparing &&
    (!limitReached || isAuthenticated);

  async function loadWorkspace() {
    setIsWorkspaceLoading(true);

    try {
      const response = await fetch("/api/workspace", {
        cache: "no-store",
      });
      const result = ((await response.json()) as WorkspaceState & ErrorResponse) ?? {};

      if (!response.ok) {
        throw new Error(result.detail ?? "Could not load workspace.");
      }

      setWorkspace(result);
      setDocument(result.activeDocument);

      if (result.activeDocument && messages.length === 1 && messages[0]?.id === "welcome") {
        setMessages([
          {
            id: "workspace-document",
            role: "assistant",
            content: `Current document: "${result.activeDocument.fileName}". ${
              result.activeDocument.status === "ready"
                ? "You can ask questions now."
                : "Indexing is still in progress."
            }`,
          },
        ]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Could not load the workspace.",
        },
      ]);
    } finally {
      setIsWorkspaceLoading(false);
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

  async function pollDocumentStatus(documentId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await fetch(`/api/documents/${documentId}`, {
        cache: "no-store",
      });
      const result = ((await response.json()) as DocumentSummary & ErrorResponse) ?? {};

      if (!response.ok || !result.documentId) {
        throw new Error(result.detail ?? "Could not fetch document status.");
      }

      setDocument(result);

      if (result.status === "ready") {
        await loadWorkspace();
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `The document is ready. Indexed ${result.chunksIndexed ?? 0} chunks from "${result.fileName}".`,
          },
        ]);
        return;
      }

      if (result.status === "failed") {
        throw new Error("Document indexing failed. Please try another PDF.");
      }
    }

    throw new Error("Indexing is taking too long. Please try again shortly.");
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (file.type !== "application/pdf") {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Only PDF files are supported.",
        },
      ]);
      return;
    }

    setIsPreparing(true);
    setMessages([
      {
        id: "uploading-document",
        role: "assistant",
        content: `Uploading "${file.name}" and preparing the document.`,
      },
    ]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      const result =
        ((await response.json()) as UploadDocumentResponse & ErrorResponse) ?? {};

      if (!response.ok || !result.document) {
        throw new Error(result.detail ?? "Could not upload the PDF.");
      }

      setDocument(result.document);
      await loadWorkspace();
      await pollDocumentStatus(result.document.documentId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not upload the PDF.";

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
        },
      ]);

      if (/Guest mode/i.test(message)) {
        setShowAuthForm(true);
      }
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleSend() {
    if (!document?.documentId || !prompt.trim()) {
      return;
    }

    const trimmedPrompt = prompt.trim();

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedPrompt,
      },
    ]);
    setPrompt("");
    setIsSending(true);

    try {
      const response = await fetch("/api/documents/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId: document.documentId,
          message: trimmedPrompt,
        }),
      });
      const result =
        ((await response.json()) as ChatDocumentResponse & ErrorResponse) ?? {};

      if (!response.ok || !result.answer) {
        throw new Error(result.detail ?? "Could not send the message.");
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
        },
      ]);
      await loadWorkspace();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not send the message.";

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
        },
      ]);

      if (/guest chats|log in/i.test(message)) {
        setShowAuthForm(true);
      }
    } finally {
      setIsSending(false);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setAuthError(null);
    setIsAuthPending(true);

    try {
      const result =
        authMode === "sign-in"
          ? await authClient.signIn.email({
              email: authEmail,
              password: authPassword,
            })
          : await authClient.signUp.email({
              name: authName,
              email: authEmail,
              password: authPassword,
            });

      if (result.error) {
        throw new Error(result.error.message ?? "Authentication failed.");
      }

      setAuthName("");
      setAuthEmail("");
      setAuthPassword("");
      setShowAuthForm(false);
      await loadWorkspace();
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Authentication failed."
      );
    } finally {
      setIsAuthPending(false);
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    setDocument(null);
    setMessages(initialMessages);
    await loadWorkspace();
  }

  const topBadge = isAuthenticated
    ? "Unlimited chats"
    : `${remainingChats ?? GUEST_CHAT_LIMIT} / ${GUEST_CHAT_LIMIT} chats left`;

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-4xl flex-col rounded-[2rem] border border-border bg-card shadow-lg">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />

        <header className="border-b border-border px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-background text-sm font-semibold">
                  B
                </span>
                <div>
                  <p className="text-base font-semibold tracking-[-0.02em] text-foreground">
                    Bookify
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Chat with one PDF at a time.
                  </p>
                </div>
              </div>
              {document ? (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                  <Badge variant="outline" className="rounded-full px-2.5 py-1">
                    {document.status}
                  </Badge>
                  <span>{document.fileName}</span>
                  {document.chunksIndexed ? (
                    <span>{document.chunksIndexed} chunks indexed</span>
                  ) : null}
                </div>
              ) : (
                <p className="pt-1 text-xs text-muted-foreground">
                  Upload a PDF to start the conversation.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full px-3 py-1.5">{topBadge}</Badge>
              {isAuthenticated ? (
                <>
                  <div className="hidden rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground sm:block">
                    {workspace?.viewer.email ?? "Signed in"}
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
          <section className="border-b border-border bg-background/70 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {authMode === "sign-in" ? "Log in to continue" : "Create an account"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Guest mode is capped at one PDF and three chats.
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full px-3 py-1">
                  <LockKeyhole className="mr-1 size-3.5" />
                  Auth required for more usage
                </Badge>
              </div>

              <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleAuthSubmit}>
                {authMode === "sign-up" ? (
                  <Input
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                    placeholder="Full name"
                    autoComplete="name"
                    required
                  />
                ) : null}
                <Input
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="Email"
                  type="email"
                  autoComplete="email"
                  required
                  className={cn(authMode === "sign-in" && "sm:col-span-2")}
                />
                <Input
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="Password"
                  type="password"
                  autoComplete={
                    authMode === "sign-in" ? "current-password" : "new-password"
                  }
                  required
                  className="sm:col-span-2"
                />

                <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    {authMode === "sign-in"
                      ? "No account yet?"
                      : "Already have an account?"}
                    <button
                      type="button"
                      className="ml-2 text-foreground underline underline-offset-4"
                      onClick={() =>
                        setAuthMode((current) =>
                          current === "sign-in" ? "sign-up" : "sign-in"
                        )
                      }
                    >
                      {authMode === "sign-in" ? "Create one" : "Log in"}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowAuthForm(false)}
                    >
                      Close
                    </Button>
                    <Button type="submit" disabled={isAuthPending}>
                      {isAuthPending ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : authMode === "sign-in" ? (
                        <LogIn className="size-4" />
                      ) : (
                        <UserPlus className="size-4" />
                      )}
                      {authMode === "sign-in" ? "Log in" : "Create account"}
                    </Button>
                  </div>
                </div>
              </form>

              {authError ? (
                <p className="text-sm text-destructive">{authError}</p>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col overflow-y-auto px-5 py-5 sm:px-6">
            {!document && !isWorkspaceLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-[1.75rem] border border-dashed border-border bg-background px-6 py-12 text-center">
                <div className="space-y-2">
                  <p className="text-lg font-medium text-foreground">
                    Upload a PDF to start
                  </p>
                  <p className="max-w-md text-sm leading-6 text-muted-foreground">
                    Guest mode gives one document and three questions. Log in if
                    you want to keep going after that.
                  </p>
                </div>
                <Button
                  size="lg"
                  className="h-11 rounded-xl px-5"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isPreparing || (!uploadAllowed && !isAuthenticated)}
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
            ) : (
              <div className="flex min-h-full flex-col gap-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[46rem] rounded-2xl px-4 py-3",
                      message.role === "assistant"
                        ? "self-start border border-border bg-background text-foreground"
                        : "self-end bg-primary text-primary-foreground"
                    )}
                  >
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] opacity-60">
                      {message.role === "assistant" ? "Assistant" : "You"}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {message.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 transition-colors hover:border-foreground/15 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isPreparing || (!uploadAllowed && !isAuthenticated)}
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
                  Logged in as {workspace?.viewer.email ?? "user"}
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
                    onClick={() => setPrompt(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="rounded-[1.5rem] border border-border bg-background p-3">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  documentReady
                    ? "Ask about the PDF..."
                    : document
                      ? "Wait until indexing finishes"
                      : "Upload a PDF to enable chat"
                }
                disabled={!documentReady || isSending || (limitReached && !isAuthenticated)}
                className="min-h-28 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
              />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  {limitReached && !isAuthenticated
                    ? "Guest limit reached. Log in to continue with this document."
                    : documentReady
                      ? isSending
                        ? "Waiting for the response."
                        : "Document is ready."
                      : document
                        ? "Document is indexing."
                        : "No document uploaded yet."}
                </p>
                <Button size="icon-lg" className="rounded-xl" onClick={handleSend} disabled={!canSend}>
                  {isSending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
