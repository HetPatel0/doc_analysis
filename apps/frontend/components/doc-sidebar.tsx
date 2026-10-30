"use client";

import {
  FileText,
  LoaderCircle,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Sun,
  Trash2,
  UserPlus,
} from "lucide-react";

import { ScrollArea } from "@/components/scroll-area";
import type { DocumentSummary } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

type DocSidebarProps = {
  documents: DocumentSummary[];
  activeDocumentId: string | null;
  deletingDocumentId?: string | null;
  uploadDisabled?: boolean;
  isUploading?: boolean;
  remainingChats: number | null;
  isAuthenticated: boolean;
  userEmail?: string | null;
  theme: "light" | "dark";
  onSelect: (documentId: string) => void;
  onDelete: (documentId: string) => void;
  onUpload: () => void;
  onToggleTheme: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  onSignOut: () => void;
};

const statusLabel: Record<DocumentSummary["status"], string> = {
  queued: "Queued",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

const statusTone: Record<DocumentSummary["status"], string> = {
  queued: "bg-muted-foreground/50",
  indexing: "bg-amber-500",
  ready: "bg-emerald-500",
  failed: "bg-destructive",
};

export function DocSidebar({
  documents,
  activeDocumentId,
  deletingDocumentId,
  uploadDisabled = false,
  isUploading = false,
  remainingChats,
  isAuthenticated,
  userEmail,
  theme,
  onSelect,
  onDelete,
  onUpload,
  onToggleTheme,
  onSignIn,
  onSignUp,
  onSignOut,
}: DocSidebarProps) {
  return (
    <aside className="hidden h-full w-[264px] shrink-0 flex-col bg-sidebar/70 backdrop-blur-2xl xl:flex">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <div className="flex size-7 shrink-0 items-center justify-center bg-primary font-mono text-[12px] font-semibold text-primary-foreground">
          B
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            Bookify
          </p>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
            Document workspace
          </p>
        </div>
      </div>

      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={onUpload}
          disabled={uploadDisabled}
          className="flex h-9 w-full items-center gap-2 px-2.5 text-[12.5px] font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isUploading ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin" />
          ) : (
            <Plus className="size-4 shrink-0" />
          )}
          <span className="truncate">
            {isUploading ? "Adding PDF…" : "Add PDF"}
          </span>
        </button>
      </div>

      <div className="flex items-center justify-between px-4 pb-1.5 pt-4">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
          Library
        </p>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
          {String(documents.length).padStart(2, "0")}
        </span>
      </div>

      <ScrollArea className="flex-1">
        {documents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-5 pb-10 text-center">
            <FileText className="size-4 text-muted-foreground/50" />
            <p className="text-[11.5px] leading-5 text-muted-foreground/80">
              No documents yet.
              <br />
              Add a PDF to start reading.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col px-2 pb-4">
            {documents.map((doc) => {
              const isActive = doc.documentId === activeDocumentId;
              const isDeleting = doc.documentId === deletingDocumentId;

              return (
                <li key={doc.documentId}>
                  <div
                    className={cn(
                      "group relative flex items-start gap-2 px-2.5 py-2 transition-colors",
                      isActive
                        ? "bg-foreground/[0.06]"
                        : "hover:bg-foreground/[0.035]"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-[7px] size-1.5 shrink-0 rounded-full",
                        statusTone[doc.status]
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => onSelect(doc.documentId)}
                      disabled={isActive}
                      aria-current={isActive}
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                    >
                      <p
                        title={doc.fileName}
                        className={cn(
                          "truncate text-[12.5px] leading-5",
                          isActive
                            ? "font-medium text-foreground"
                            : "text-foreground/85"
                        )}
                      >
                        {doc.fileName}
                      </p>
                      <p className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
                        {statusLabel[doc.status]}
                        {doc.status === "ready" && doc.chunksIndexed
                          ? ` · ${doc.chunksIndexed} chunks`
                          : ""}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(doc.documentId)}
                      disabled={isDeleting}
                      aria-label={`Delete ${doc.fileName}`}
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center text-muted-foreground/60 opacity-0 transition-[opacity,color] hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                    >
                      {isDeleting ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      <div className="mt-auto shrink-0 px-4 pb-4 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          {isAuthenticated ? (
            <>
              Signed in · <span className="text-muted-foreground">Unlimited</span>
            </>
          ) : (
            <>
              Guest ·{" "}
              <span className="tabular-nums text-muted-foreground">
                {remainingChats ?? 0}/3 chats
              </span>
            </>
          )}
        </p>

        {isAuthenticated ? (
          <div className="mt-2.5 flex items-center gap-1">
            <div
              title={userEmail ?? "Signed in"}
              className="flex min-w-0 flex-1 items-center gap-2 py-0.5"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-semibold text-accent-foreground">
                {(userEmail ?? "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {userEmail ?? "Signed in"}
              </span>
            </div>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              {theme === "dark" ? (
                <Sun className="size-3.5" />
              ) : (
                <Moon className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 bg-foreground/[0.05] text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/[0.09]"
            >
              <LogIn className="size-3.5" />
              Log in
            </button>
            <button
              type="button"
              onClick={onSignUp}
              className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 bg-primary text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <UserPlus className="size-3.5" />
              Sign up
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              {theme === "dark" ? (
                <Sun className="size-3.5" />
              ) : (
                <Moon className="size-3.5" />
              )}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
