"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { splitSourceFooter } from "@/lib/citations";
import { cn } from "@/lib/utils";
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

const CITATION_TOKEN =
  /\[(?:source:\s*)?p\.\s*(\d+)(?:,\s*chunk\s*\d+)?\]/gi;

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

/** Turn inline `[p. 3]` / `[Source: p. 3, chunk 2]` mentions into page links. */
function remarkCitationLinks() {
  return (tree: unknown) => {
    const root = tree as MarkdownNode;

    function walk(node: MarkdownNode, insideLink = false) {
      if (!node.children) {
        return;
      }

      const nested = insideLink || node.type === "link" || node.type === "linkReference";

      node.children = node.children.flatMap((child) => {
        if (!nested && child.type === "text" && child.value) {
          const replacement = citationNodes(child.value);
          if (replacement.length > 0) {
            return replacement;
          }
        }

        walk(child, nested);
        return [child];
      });
    }

    walk(root);
  };
}

function pageLabel(citation: Citation) {
  return citation.page ? `p. ${citation.page}` : citation.label;
}

export function ChatMessage({
  message,
  onRetry,
  onCitationClick,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(
    () => splitSourceFooter(message.content),
    [message.content]
  );
  const citations = message.citations?.length
    ? message.citations
    : parsed.citations;
  const body =
    citations.length > 0 && parsed.citations.length > 0
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
          className="mx-0.5 inline text-[11px] font-medium text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:decoration-primary"
        >
          {`p. ${page}`}
        </button>
      );
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-4"
      >
        {children}
      </a>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex w-full flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
          You
        </span>
        <p className="whitespace-pre-wrap bg-foreground/[0.045] px-3.5 py-2.5 text-[13.5px] leading-6 break-words text-foreground">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className="group/msg flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.18em]",
            message.error ? "text-destructive" : "text-muted-foreground/60"
          )}
        >
          {message.error ? "Error" : "Assistant"}
        </span>

        <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
          {canRetry ? (
            <button
              type="button"
              onClick={() => onRetry?.(message.retryPrompt!)}
              aria-label="Retry message"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
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
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "prose prose-sm max-w-none text-[13.5px] leading-6 break-words dark:prose-invert prose-p:my-2 prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold prose-headings:tracking-tight prose-li:my-0.5 prose-ol:my-2 prose-pre:bg-foreground/[0.05] prose-pre:text-foreground prose-code:bg-foreground/[0.06] prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-strong:text-foreground prose-strong:font-semibold prose-a:text-primary",
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
          <span className="inline-block size-1.5 animate-pulse bg-foreground/50" />
        )}
      </div>

      {citations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/50">
            Pages
          </span>
          {citations.map((citation, index) =>
            citation.page && onCitationClick ? (
              <button
                key={`${citation.label}-${citation.page}-${index}`}
                type="button"
                onClick={() => onCitationClick(citation.page!)}
                title={`Jump to page ${citation.page}`}
                className="text-[11px] text-muted-foreground underline-offset-[3px] transition-colors hover:text-primary hover:underline"
              >
                {pageLabel(citation)}
              </button>
            ) : (
              <span
                key={`${citation.label}-${citation.page ?? "none"}-${index}`}
                className="text-[11px] text-muted-foreground/80"
              >
                {pageLabel(citation)}
              </span>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
