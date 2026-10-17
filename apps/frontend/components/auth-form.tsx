"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle, LockKeyhole, LogIn, UserPlus } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { reportError, toErrorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
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
    <section className="border-b border-border bg-background/70 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              {mode === "sign-in" ? "Log in to continue" : "Create an account"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Guest mode is capped at one PDF and three chats.
            </p>
          </div>
          <Badge variant="outline" className="rounded-full px-3 py-1">
            <LockKeyhole className="mr-1 size-3.5" />
            Auth required for more usage
          </Badge>
        </div>

        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
          {mode === "sign-up" ? (
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Full name"
              autoComplete="name"
              required
            />
          ) : null}
          <Input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            autoComplete="email"
            required
            className={cn(mode === "sign-in" && "sm:col-span-2")}
          />
          <Input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            className="sm:col-span-2"
          />

          <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {mode === "sign-in" ? "No account yet?" : "Already have an account?"}
              <button
                type="button"
                className="ml-2 text-foreground underline underline-offset-4"
                onClick={() =>
                  onModeChange(mode === "sign-in" ? "sign-up" : "sign-in")
                }
              >
                {mode === "sign-in" ? "Create one" : "Log in"}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : mode === "sign-in" ? (
                  <LogIn className="size-4" />
                ) : (
                  <UserPlus className="size-4" />
                )}
                {mode === "sign-in" ? "Log in" : "Create account"}
              </Button>
            </div>
          </div>
        </form>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </section>
  );
}
