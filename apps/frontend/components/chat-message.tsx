"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { Check, Copy, FileText, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { splitSourceFooter } from "@/lib/citations";
import type { Citation } from "@/lib/workspace-types";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: boolean;
  retryPrompt?: string;
  citations?: Citation[];
};

type ChatMessageProps = {
  message: Message;
  onRetry?: (prompt: string) => void;
  onCitationClick?: (page: number) => void;
};

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

const CITATION_TOKEN = /\[(?:source:\s*)?p\.\s*(\d+)(?:,\s*chunk\s*\d+)?\]/gi;

function citationNodes(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  CITATION_TOKEN.lastIndex = 0;
  while ((match = CITATION_TOKEN.exec(value))) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }

    const page = Number.parseInt(match[1], 10);
    nodes.push({
      type: "link",
      url: `#pdf-page-${page}`,
      children: [{ type: "text", value: `p. ${page}` }],
    });
    lastIndex = match.index + match[0].length;
  }

  if (nodes.length === 0) {
    return [];
  }

  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) });
  }

  return nodes;
}

/** Turn inline `[p. 3]` / `[p. 3, chunk 2]` mentions into page links. */
function remarkCitationLinks() {
  return (tree: unknown) => {
    const root = tree as MarkdownNode;

    function walk(node: MarkdownNode) {
      if (!node.children) {
        return;
      }

      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && child.value) {
          const replacement = citationNodes(child.value);
          return replacement.length > 0 ? replacement : [child];
        }

        walk(child);
        return [child];
      });
    }

    walk(root);
  };
}

export function ChatMessage({
  message,
  onRetry,
  onCitationClick,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => splitSourceFooter(message.content), [message.content]);
  const citations = message.citations?.length
    ? message.citations
    : parsed.citations;
  const body = citations.length > 0 && parsed.citations.length > 0
    ? parsed.body
    : message.content;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
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

  function CitationAnchor({ href, children }: ComponentProps<"a">) {
    const pageMatch = href?.match(/^#pdf-page-(\d+)$/);
    const page = pageMatch ? Number.parseInt(pageMatch[1], 10) : null;

    if (page && onCitationClick) {
      return (
        <button
          type="button"
          onClick={() => onCitationClick(page)}
          title={`Jump to page ${page}`}
          className="mx-0.5 inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 align-baseline text-[0.75em] font-medium text-accent-foreground no-underline transition-colors hover:bg-accent/70"
        >
          {children}
        </button>
      );
    }

    return <a href={href}>{children}</a>;
  }

  if (message.role === "user") {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-foreground">
          <p className="whitespace-pre-wrap text-sm leading-6 break-words">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="group/msg flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p
          className={cn(
            "text-[11px] font-medium uppercase tracking-[0.16em]",
            message.error ? "text-destructive" : "text-muted-foreground/80"
          )}
        >
          {message.error ? "Error" : "Assistant"}
        </p>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
          {canRetry ? (
            <button
              type="button"
              onClick={() => onRetry?.(message.retryPrompt!)}
              aria-label="Retry message"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              Retry
            </button>
          ) : null}
          {message.content && !message.streaming ? (
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy answer"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "prose prose-sm max-w-none text-sm leading-7 break-words dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1",
          message.error && "text-destructive"
        )}
      >
        {body ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkCitationLinks]}
            components={{ a: CitationAnchor }}
          >
            {body}
          </ReactMarkdown>
        ) : (
          <span className="inline-block size-2 animate-pulse rounded-full bg-muted-foreground" />
        )}
      </div>

      {citations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
            Sources
          </span>
          {citations.map((citation, index) => {
            const label = citation.label;
            return citation.page && onCitationClick ? (
              <button
                key={`${citation.label}-${citation.page}-${index}`}
                type="button"
                onClick={() => onCitationClick(citation.page!)}
                title={`Jump to page ${citation.page}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <FileText className="size-3" />
                {label}
              </button>
            ) : (
              <span
                key={`${citation.label}-${citation.page ?? "none"}-${index}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                <FileText className="size-3" />
                {label}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
