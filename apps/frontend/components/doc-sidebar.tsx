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
    <aside className="glass hidden h-full w-[268px] shrink-0 flex-col border-r border-sidebar-border lg:flex">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
          B
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">
            Bookify
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            Document workspace
          </p>
        </div>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onUpload}
          disabled={uploadDisabled}
          className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-card/60 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUploading ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Plus className="size-4 text-muted-foreground" />
          )}
          <span className="truncate">
            {isUploading ? "Adding PDF…" : "Add PDF"}
          </span>
        </button>
      </div>

      <div className="mt-5 flex items-center justify-between px-4 pb-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Library
        </p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {documents.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {documents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 pb-8 text-center">
            <FileText className="size-5 text-muted-foreground/70" />
            <p className="text-xs leading-5 text-muted-foreground">
              No documents yet.
              <br />
              Add a PDF to start reading.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {documents.map((doc) => {
              const isActive = doc.documentId === activeDocumentId;
              const isDeleting = doc.documentId === deletingDocumentId;

              return (
                <li key={doc.documentId}>
                  <div
                    className={cn(
                      "group relative flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-foreground hover:bg-muted/70"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
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
                        className="truncate text-[13px] font-medium leading-5"
                      >
                        {doc.fileName}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{statusLabel[doc.status]}</span>
                        {doc.status === "ready" && doc.chunksIndexed ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>{doc.chunksIndexed} chunks</span>
                          </>
                        ) : null}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(doc.documentId)}
                      disabled={isDeleting}
                      aria-label={`Delete ${doc.fileName}`}
                      className="mt-0.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
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
      </div>

      <div className="border-t border-sidebar-border px-3 py-3">
        <p className="px-1 pb-2 text-[11px] text-muted-foreground">
          {isAuthenticated ? (
            <>
              Signed in
              <span className="mx-1 text-muted-foreground/50">·</span>
              <span className="text-foreground/80">Unlimited chats</span>
            </>
          ) : (
            <>
              Guest mode
              <span className="mx-1 text-muted-foreground/50">·</span>
              <span className="tabular-nums text-foreground/80">
                {remainingChats ?? 0} of 3 chats left
              </span>
            </>
          )}
        </p>

        {isAuthenticated ? (
          <div className="flex items-center gap-1.5">
            <div
              title={userEmail ?? "Signed in"}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                {(userEmail ?? "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {userEmail ?? "Signed in"}
              </span>
            </div>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg border border-sidebar-border bg-card/60 text-xs font-medium text-foreground transition-colors hover:bg-card"
              >
                <LogIn className="size-3.5" />
                Log in
              </button>
              <button
                type="button"
                onClick={onSignUp}
                className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <UserPlus className="size-3.5" />
                Sign up
              </button>
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label="Toggle theme"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {theme === "dark" ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
