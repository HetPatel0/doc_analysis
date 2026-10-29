"use client";

import { useState } from "react";
import { BadgeCheck, ChevronDown, ChevronUp, ListChecks, Sparkles } from "lucide-react";

import type { DocumentSummary } from "@/lib/workspace-types";

type DocumentInsightsProps = {
  document: DocumentSummary;
};

export function DocumentInsights({ document }: DocumentInsightsProps) {
  const [openAnswers, setOpenAnswers] = useState<Record<number, boolean>>({});

  const summary = document.summary?.trim();
  const keyPoints = document.keyPoints ?? [];
  const actionItems = document.actionItems ?? [];
  const quiz = document.quiz ?? [];
  const hasInsights =
    Boolean(summary) || keyPoints.length > 0 || actionItems.length > 0 || quiz.length > 0;

  if (!hasInsights) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Sparkles className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No insights yet</p>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">
          {document.status === "ready"
            ? "A summary was not generated for this document. Re-uploading it will try again."
            : "A summary, key points, action items, and a short quiz are generated automatically once indexing finishes."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {summary ? (
        <section className="rounded-2xl border border-border bg-background p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Summary</h2>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {summary}
          </p>
        </section>
      ) : null}

      {keyPoints.length > 0 ? (
        <section className="rounded-2xl border border-border bg-background p-4">
          <div className="mb-2 flex items-center gap-2">
            <BadgeCheck className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Key points</h2>
          </div>
          <ul className="space-y-1.5 text-sm leading-6 text-muted-foreground">
            {keyPoints.map((point) => (
              <li key={point} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {actionItems.length > 0 ? (
        <section className="rounded-2xl border border-border bg-background p-4">
          <div className="mb-2 flex items-center gap-2">
            <ListChecks className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Action items</h2>
          </div>
          <ul className="space-y-1.5 text-sm leading-6 text-muted-foreground">
            {actionItems.map((item) => (
              <li key={item} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-1.5 size-3 shrink-0 rounded border border-muted-foreground/40"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {quiz.length > 0 ? (
        <section className="rounded-2xl border border-border bg-background p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Quick quiz
          </h2>
          <ol className="space-y-2">
            {quiz.map((item, index) => {
              const isOpen = Boolean(openAnswers[index]);
              return (
                <li
                  key={`${index}-${item.question}`}
                  className="rounded-xl border border-border/70 bg-muted/20 p-3"
                >
                  <p className="text-sm font-medium text-foreground">
                    {index + 1}. {item.question}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenAnswers((current) => ({
                        ...current,
                        [index]: !current[index],
                      }))
                    }
                    className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {isOpen ? (
                      <ChevronUp className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    {isOpen ? "Hide answer" : "Show answer"}
                  </button>
                  {isOpen ? (
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      {item.answer || "No answer generated."}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
