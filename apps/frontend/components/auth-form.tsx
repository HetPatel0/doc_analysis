"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, LockKeyhole, LogIn, UserPlus, X } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { reportError, toErrorMessage } from "@/lib/errors";
import { Input } from "@/components/ui/input";

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
        className="absolute inset-0 bg-background/55 backdrop-blur-xl"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        className="glass-strong relative z-10 w-full max-w-[360px] p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.65)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex size-7 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>

        <div className="flex flex-col gap-1.5 pr-8">
          <div className="mb-3 flex size-9 items-center justify-center bg-primary/10 text-primary">
            {mode === "sign-in" ? (
              <LogIn className="size-4" />
            ) : (
              <UserPlus className="size-4" />
            )}
          </div>
          <h2
            id="auth-title"
            className="text-[15px] font-semibold tracking-tight text-foreground"
          >
            {mode === "sign-in" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="text-[11.5px] leading-5 text-muted-foreground">
            {mode === "sign-in"
              ? "Log in to keep your library and continue chatting."
              : "Guest mode is limited to one PDF and three chats."}
          </p>
        </div>

        <form className="mt-5 flex flex-col gap-3" onSubmit={handleSubmit}>
          {mode === "sign-up" ? (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                Full name
              </span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                required
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
              Email
            </span>
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
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
              required
            />
          </label>

          {error ? (
            <p className="bg-destructive/10 px-3 py-2 text-[11.5px] leading-5 text-destructive">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isPending}
            className="mt-1 inline-flex h-9 items-center justify-center gap-2 bg-primary text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <LockKeyhole className="size-3.5" />
            )}
            {mode === "sign-in" ? "Log in" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          {mode === "sign-in" ? "No account yet?" : "Already have an account?"}
          <button
            type="button"
            className="ml-1.5 font-medium text-foreground underline-offset-4 hover:underline"
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
