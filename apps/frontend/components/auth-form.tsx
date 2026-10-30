"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, LockKeyhole, LogIn, UserPlus, X } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { reportError, toErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AuthMode = "sign-in" | "sign-up";

type AuthFormProps = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onAuthenticated: () => void | Promise<void>;
};

export function AuthForm({
  mode,
  onModeChange,
  onClose,
  onAuthenticated,
}: AuthFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setIsPending(true);

    try {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ name, email, password });

      if (result.error) {
        throw new Error(result.error.message ?? "Authentication failed.");
      }

      setName("");
      setEmail("");
      setPassword("");
      await onAuthenticated();
    } catch (submitError) {
      reportError(submitError, { scope: "AuthForm.handleSubmit" });
      setError(toErrorMessage(submitError, "Authentication failed."));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-background/60 backdrop-blur-md"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        className="glass-strong relative z-10 w-full max-w-sm rounded-2xl border border-border/70 p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex flex-col gap-1.5 pr-8">
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {mode === "sign-in" ? (
              <LogIn className="size-5" />
            ) : (
              <UserPlus className="size-5" />
            )}
          </div>
          <h2
            id="auth-title"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            {mode === "sign-in" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {mode === "sign-in"
              ? "Log in to keep your library and continue chatting."
              : "Guest mode is limited to one PDF and three chats."}
          </p>
        </div>

        <form className="mt-5 flex flex-col gap-3" onSubmit={handleSubmit}>
          {mode === "sign-up" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Full name
              </span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                className="h-10"
                required
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Email
            </span>
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              className="h-10"
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Password
            </span>
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              type="password"
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
              className="h-10"
              required
            />
          </label>

          {error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="mt-1 h-10" disabled={isPending}>
            {isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <LockKeyhole className="size-4" />
            )}
            {mode === "sign-in" ? "Log in" : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {mode === "sign-in" ? "No account yet?" : "Already have an account?"}
          <button
            type="button"
            className={cn(
              "ml-1.5 font-medium text-foreground underline-offset-4 hover:underline"
            )}
            onClick={() =>
              onModeChange(mode === "sign-in" ? "sign-up" : "sign-in")
            }
          >
            {mode === "sign-in" ? "Create one" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
