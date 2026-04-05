"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowUp,
  FileText,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

const features = [
  "Upload a single PDF and index it from the browser.",
  "Keep the conversation focused on one source document.",
  "Use your existing LangChain and Chroma backend without changing the UI.",
];

export default function PdfChatShell() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
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

  const statusLabel = useMemo(() => {
    if (isPreparing) return "Indexing document";
    if (selectedFile && documentId) return "Ready to chat";
    if (selectedFile) return "Upload required";
    return "Waiting for PDF";
  }, [documentId, isPreparing, selectedFile]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

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
    <main className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(circle_at_top,rgba(23,23,23,0.08),transparent_60%)]" />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col px-4 py-8 sm:px-6 lg:py-10">
        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Card className="border-border/80 bg-card/90 backdrop-blur-sm">
            <CardHeader className="gap-4">
              <Badge variant="outline" className="w-fit">
                Minimal PDF chat
              </Badge>
              <div className="space-y-3">
                <CardTitle className="max-w-xl font-serif text-4xl leading-tight sm:text-5xl">
                  Clean interface for uploading a PDF and chatting with it.
                </CardTitle>
                <CardDescription className="max-w-xl text-base">
                  A focused frontend for Bookify with a simple upload step,
                  clear status, and a conversation area backed by your FastAPI
                  RAG service.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="grid gap-3 sm:grid-cols-3">
                {features.map((feature) => (
                  <div
                    key={feature}
                    className="rounded-2xl border border-border/70 bg-background/80 p-4 text-sm leading-6 text-muted-foreground"
                  >
                    {feature}
                  </div>
                ))}
              </div>

              <div className="rounded-3xl border border-dashed border-border bg-background/90 p-5 sm:p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Paperclip className="size-4" />
                      Add your source document
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Upload one PDF to unlock the chat workspace and prompt
                      suggestions.
                    </p>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  <Button
                    size="lg"
                    className="h-11 rounded-xl px-5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPreparing}
                  >
                    <FileText className="size-4" />
                    Choose PDF
                  </Button>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Badge className="gap-2 rounded-full px-3 py-1.5">
                    {isPreparing ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                    {statusLabel}
                  </Badge>

                  {selectedFile ? (
                    <div className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground">
                      {selectedFile.name}
                    </div>
                  ) : (
                    <div className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground">
                      No file selected yet
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="flex min-h-[42rem] flex-col border-border/80 bg-card/95">
            <CardHeader className="border-b border-border/70 pb-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <MessageSquare className="size-5" />
                    Document chat
                  </CardTitle>
                  <CardDescription>
                    Ask questions once your PDF is attached.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {selectedFile && documentId ? "1 document loaded" : "No document"}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
              <div className="flex-1 space-y-3 overflow-hidden rounded-[1.5rem] border border-border/70 bg-background/80 p-3 sm:p-4">
                <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm",
                        message.role === "assistant"
                          ? "self-start border border-border bg-card text-card-foreground"
                          : "self-end bg-primary text-primary-foreground"
                      )}
                    >
                      {message.content}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {starterPrompts.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="rounded-full border border-border bg-background px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => setPrompt(item)}
                    disabled={!selectedFile || !documentId || isPreparing || isSending}
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="size-3.5" />
                      {item}
                    </span>
                  </button>
                ))}
              </div>

              <div className="rounded-[1.75rem] border border-border/80 bg-background p-3 shadow-sm">
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={
                    selectedFile && documentId
                      ? "Ask about the PDF..."
                      : "Upload a PDF to enable chat"
                  }
                  disabled={!selectedFile || !documentId || isPreparing || isSending}
                  className="min-h-28 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                  <p className="text-xs text-muted-foreground">
                    {selectedFile && documentId
                      ? isSending
                        ? "Waiting for the answer..."
                        : "The composer is active."
                      : "The composer unlocks after upload."}
                  </p>
                  <Button
                    size="icon-lg"
                    className="rounded-2xl"
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
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
