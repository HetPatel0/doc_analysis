"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";

import { ScrollArea } from "@/components/scroll-area";
import type { DocumentSummary } from "@/lib/workspace-types";

type DocumentInsightsProps = {
  document: DocumentSummary;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 py-5 first:pt-0 last:pb-0">
      <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DocumentInsights({ document }: DocumentInsightsProps) {
  const [openAnswers, setOpenAnswers] = useState<Record<number, boolean>>({});

  const summary = document.summary?.trim();
  const keyPoints = document.keyPoints ?? [];
  const actionItems = document.actionItems ?? [];
  const quiz = document.quiz ?? [];
  const hasInsights =
    Boolean(summary) ||
    keyPoints.length > 0 ||
    actionItems.length > 0 ||
    quiz.length > 0;

  if (!hasInsights) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Sparkles className="size-4 text-muted-foreground/50" />
        <p className="text-[13px] font-medium text-foreground">No insights yet</p>
        <p className="max-w-xs text-[11.5px] leading-5 text-muted-foreground">
          {document.status === "ready"
            ? "A summary was not generated for this document. Re-uploading it will try again."
            : "A summary, key points, action items, and a short quiz are generated automatically once indexing finishes."}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="px-5 py-5">
        {summary ? (
          <Section title="Summary">
            <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-foreground/85">
              {summary}
            </p>
          </Section>
        ) : null}

        {keyPoints.length > 0 ? (
          <Section title="Key points">
            <ul className="flex flex-col gap-2">
              {keyPoints.map((point) => (
                <li
                  key={point}
                  className="flex gap-3 text-[13.5px] leading-6 text-foreground/85"
                >
                  <span
                    aria-hidden
                    className="mt-2.5 size-1 shrink-0 rounded-full bg-foreground/30"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {actionItems.length > 0 ? (
          <Section title="Action items">
            <ul className="flex flex-col gap-2">
              {actionItems.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 text-[13.5px] leading-6 text-foreground/85"
                >
                  <span
                    aria-hidden
                    className="mt-2 size-3 shrink-0 bg-foreground/[0.1]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {quiz.length > 0 ? (
          <Section title="Quick quiz">
            <ol className="flex flex-col gap-4">
              {quiz.map((item, index) => {
                const isOpen = Boolean(openAnswers[index]);

                return (
                  <li key={`${index}-${item.question}`} className="flex flex-col gap-1.5">
                    <p className="text-[13.5px] leading-6 text-foreground/90">
                      <span className="mr-2 font-mono text-[11px] text-muted-foreground/60">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {item.question}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenAnswers((current) => ({
                          ...current,
                          [index]: !current[index],
                        }))
                      }
                      className="inline-flex w-fit items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {isOpen ? (
                        <ChevronUp className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                      {isOpen ? "Hide answer" : "Show answer"}
                    </button>
                    {isOpen ? (
                      <p className="text-[13px] leading-6 text-muted-foreground">
                        {item.answer || "No answer generated."}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Section>
        ) : null}
      </div>
    </ScrollArea>
  );
}
