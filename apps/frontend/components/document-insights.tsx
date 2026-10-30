"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  ListChecks,
  type LucideProps,
  Sparkles,
} from "lucide-react";

import type { DocumentSummary } from "@/lib/workspace-types";

type DocumentInsightsProps = {
  document: DocumentSummary;
};

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Icon className="size-3.5" />
        </span>
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      </div>
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
        <div className="flex size-11 items-center justify-center rounded-2xl border border-border bg-card/60">
          <Sparkles className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No insights yet</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {document.status === "ready"
              ? "A summary was not generated for this document. Re-uploading it will try again."
              : "A summary, key points, action items, and a short quiz are generated automatically once indexing finishes."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {summary ? (
        <SectionCard icon={Sparkles} title="Summary">
          <p className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">
            {summary}
          </p>
        </SectionCard>
      ) : null}

      {keyPoints.length > 0 ? (
        <SectionCard icon={BadgeCheck} title="Key points">
          <ul className="space-y-2 text-[13px] leading-6 text-muted-foreground">
            {keyPoints.map((point) => (
              <li key={point} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary/60"
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {actionItems.length > 0 ? (
        <SectionCard icon={ListChecks} title="Action items">
          <ul className="space-y-2 text-[13px] leading-6 text-muted-foreground">
            {actionItems.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-1.5 size-3.5 shrink-0 rounded border border-border bg-background"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {quiz.length > 0 ? (
        <SectionCard icon={BadgeCheck} title="Quick quiz">
          <ol className="space-y-2">
            {quiz.map((item, index) => {
              const isOpen = Boolean(openAnswers[index]);
              return (
                <li
                  key={`${index}-${item.question}`}
                  className="rounded-lg border border-border/60 bg-background/60 p-3"
                >
                  <p className="text-[13px] font-medium leading-5 text-foreground">
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
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {isOpen ? (
                      <ChevronUp className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    {isOpen ? "Hide answer" : "Show answer"}
                  </button>
                  {isOpen ? (
                    <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
                      {item.answer || "No answer generated."}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </SectionCard>
      ) : null}
    </div>
  );
}
