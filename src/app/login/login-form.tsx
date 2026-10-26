"use client";

import { Lock, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { Button, ErrorBanner, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { password });
      window.location.href = next;
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  };
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <UtensilsCrossed className="size-4" />
          </span>
          <h1 className="text-lg font-semibold">Diet Tracker</h1>
        </div>
        <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />}</Field>
        {error ? <ErrorBanner error={error} /> : null}
        <Button type="submit" loading={loading} size="lg">
          <Lock className="size-4" /> Sign in
        </Button>
      </form>
    </main>
  );
}
