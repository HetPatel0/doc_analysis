"use client";

import { useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: boolean;
  retryPrompt?: string;
};

type ChatMessageProps = {
  message: Message;
  onRetry?: (prompt: string) => void;
};

export function ChatMessage({ message, onRetry }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; no-op.
    }
  }

  const canRetry =
    message.role === "assistant" &&
    message.error &&
    Boolean(message.retryPrompt) &&
    Boolean(onRetry);

  return (
    <div
      className={cn(
        "max-w-[52rem] rounded-2xl px-4 py-3",
        message.role === "assistant"
          ? message.error
            ? "self-start border border-destructive/40 bg-destructive/5 text-foreground"
            : "self-start border border-border bg-background text-foreground"
          : "self-end bg-primary text-primary-foreground"
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] opacity-60">
          {message.role === "assistant" ? "Assistant" : "You"}
        </p>
        <div className="flex items-center gap-2">
          {canRetry ? (
            <button
              type="button"
              onClick={() => onRetry?.(message.retryPrompt!)}
              aria-label="Retry message"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] opacity-80 transition-opacity hover:opacity-100"
            >
              <RotateCcw className="size-3" />
              Retry
            </button>
          ) : null}
          {message.role === "assistant" && message.content && !message.streaming ? (
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy answer"
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] opacity-60 transition-opacity hover:opacity-100"
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
      </div>
      {message.role === "assistant" ? (
        <div className="prose prose-sm max-w-none text-sm leading-6 break-words whitespace-pre-wrap dark:prose-invert">
          {message.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          ) : (
            <span className="inline-block size-2 animate-pulse rounded-full bg-muted-foreground" />
          )}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
      )}
    </div>
  );
}
