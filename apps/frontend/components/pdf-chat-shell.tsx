"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowUp,
  FileText,
  LoaderCircle,
  RefreshCcw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type UploadResponse = {
  document_id: string;
  file_name: string;
  status: "queued";
};

type DocumentStatusResponse = {
  document_id: string;
  file_name: string;
  status: "queued" | "indexing" | "ready" | "failed";
  chunks_indexed?: number | null;
  error?: string | null;
};

type ChatResponse = {
  answer: string;
};

type ErrorResponse = {
  detail?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

const starterPrompts = [
  "Summarize the document in 5 bullet points.",
  "What are the key chapters or sections?",
  "List the most important action items.",
];

export default function PdfChatShell() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [chunksIndexed, setChunksIndexed] = useState<number | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Upload a PDF to start. Once it is indexed, ask for summaries, explanations, or specific passages.",
    },
  ]);

  const canSend =
    Boolean(selectedFile) &&
    Boolean(documentId) &&
    Boolean(prompt.trim()) &&
    !isPreparing &&
    !isSending;

  const isReady = Boolean(selectedFile && documentId && !isPreparing);

  const statusLabel = useMemo(() => {
    if (isPreparing) return "Indexing";
    if (selectedFile && documentId) return "Ready";
    if (selectedFile) return "Needs retry";
    return "No document";
  }, [documentId, isPreparing, selectedFile]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (file.type !== "application/pdf") {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Please upload a PDF file so the chat can stay document-focused.",
        },
      ]);
      return;
    }

    setSelectedFile(file);
    setDocumentId(null);
    setChunksIndexed(null);
    setIsPreparing(true);
    setMessages([
      {
        id: "upload-ready",
        role: "assistant",
        content: `Attached "${file.name}". Uploading and indexing the document now.`,
      },
    ]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      const result = ((await response.json()) as UploadResponse & ErrorResponse) ?? {};

      if (!response.ok || !result.document_id) {
        throw new Error(result.detail ?? "Upload failed.");
      }

      setDocumentId(result.document_id);

      let status: DocumentStatusResponse | null = null;

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const statusResponse = await fetch(
          `${API_URL}/documents/${result.document_id}`
        );
        const statusResult =
          ((await statusResponse.json()) as DocumentStatusResponse & ErrorResponse) ??
          {};

        if (!statusResponse.ok || !statusResult.status) {
          throw new Error(statusResult.detail ?? "Could not check document status.");
        }

        status = statusResult;

        if (status.status === "ready") {
          break;
        }

        if (status.status === "failed") {
          throw new Error(status.error ?? "Document indexing failed.");
        }
      }

      if (!status || status.status !== "ready") {
        throw new Error("Indexing is taking too long. Please try again in a moment.");
      }

      setChunksIndexed(status.chunks_indexed ?? null);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Your PDF is ready. Indexed ${status.chunks_indexed ?? 0} chunks from "${status.file_name}". Ask for a summary, a chapter breakdown, or something specific.`,
        },
      ]);
    } catch (error) {
      setDocumentId(null);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Could not upload the PDF. Make sure the backend server is running.",
        },
      ]);
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleSend() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || !selectedFile || !documentId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedPrompt,
    };

    setMessages((current) => [...current, userMessage]);
    setPrompt("");
    setIsSending(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_id: documentId,
          message: trimmedPrompt,
        }),
      });

      const result = ((await response.json()) as ChatResponse & ErrorResponse) ?? {};

      if (!response.ok || !result.answer) {
        throw new Error(result.detail ?? "Chat request failed.");
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Could not get a response from the backend.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        <section className="border-b border-border/80 pb-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Document Workspace
              </p>
              <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.6rem]">
                A quieter interface for reading a PDF through chat.
              </h1>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                Upload one file, wait for indexing, then ask direct questions.
                The layout is intentionally stripped back so the document stays
                central.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border bg-card px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Status
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {statusLabel}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Source
                </p>
                <p className="mt-2 truncate text-sm font-medium text-foreground">
                  {selectedFile ? selectedFile.name : "None selected"}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Chunks
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {chunksIndexed ?? "Pending"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 pt-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[1.75rem] border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Source document
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Keep the workspace tied to a single PDF for cleaner answers.
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPreparing}
                className="group flex w-full items-center justify-between rounded-2xl border border-dashed border-border bg-background px-4 py-4 text-left transition-colors hover:border-foreground/25 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {selectedFile ? "Replace PDF" : "Choose PDF"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedFile ? selectedFile.name : "Select a single file"}
                  </p>
                </div>
                {isPreparing ? (
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                ) : selectedFile ? (
                  <RefreshCcw className="size-4 text-muted-foreground transition-transform group-hover:rotate-45" />
                ) : (
                  <FileText className="size-4 text-muted-foreground" />
                )}
              </button>

              <div className="rounded-2xl border border-border bg-background">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    State
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium",
                      isReady &&
                        "border-emerald-200 bg-emerald-50 text-emerald-800",
                      isPreparing &&
                        "border-amber-200 bg-amber-50 text-amber-800",
                      !selectedFile &&
                        "border-border bg-background text-muted-foreground",
                      selectedFile &&
                        !documentId &&
                        !isPreparing &&
                        "border-rose-200 bg-rose-50 text-rose-800"
                    )}
                  >
                    {statusLabel}
                  </Badge>
                </div>
                <dl className="space-y-4 px-4 py-4 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Filename</dt>
                    <dd className="max-w-[12rem] text-right text-foreground">
                      {selectedFile ? selectedFile.name : "No file selected"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Document ID</dt>
                    <dd className="max-w-[12rem] break-all text-right font-mono text-xs text-foreground">
                      {documentId ?? "Unavailable"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Indexed chunks</dt>
                    <dd className="text-right text-foreground">
                      {chunksIndexed ?? "Pending"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Quick prompts
                </p>
                <div className="space-y-2">
                  {starterPrompts.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm leading-5 text-muted-foreground transition-colors hover:border-foreground/15 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setPrompt(item)}
                      disabled={!isReady || isSending}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="flex min-h-[38rem] flex-col rounded-[1.75rem] border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Conversation
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isReady
                    ? "Ask focused questions about the uploaded PDF."
                    : "Upload a document to enable the composer."}
                </p>
              </div>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {isReady ? "1 document active" : "No active document"}
              </Badge>
            </div>

            <div className="flex flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex-1 overflow-hidden rounded-[1.5rem] border border-border bg-background">
                <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 sm:p-5">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[48rem] rounded-2xl px-4 py-3",
                        message.role === "assistant"
                          ? "self-start border border-border bg-card text-card-foreground"
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
              </div>

              <div className="mt-4 rounded-[1.5rem] border border-border bg-background p-3">
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={
                    isReady
                      ? "Ask about structure, summaries, details, or passages."
                      : "Upload a PDF to enable chat"
                  }
                  disabled={!isReady || isSending}
                  className="min-h-28 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">
                    {isSending
                      ? "Waiting for a response."
                      : isReady
                        ? "One document in context."
                        : "The composer unlocks after indexing."}
                  </p>
                  <Button
                    size="icon-lg"
                    className="rounded-xl"
                    onClick={handleSend}
                    disabled={!canSend}
                  >
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
        </section>
      </div>
    </main>
  );
}
