"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Button, ErrorBanner } from "./ui";
import { useToast } from "./toast";

const STEPS = [
  { dataset: "fndds", label: "Loading USDA survey foods (1 of 2)…" },
  { dataset: "sr_legacy", label: "Loading USDA reference foods (2 of 2)…" },
] as const;

/** Loads the USDA reference foods into the database from inside the app (about a minute). */
export function FoodDbLoader({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    setError(null);
    try {
      let total = 0;
      for (const s of STEPS) {
        setStep(s.label);
        const res = await api.post<{ usdaFoods: number }>("/api/admin/import-foods", { dataset: s.dataset });
        total = res.usdaFoods;
      }
      await qc.invalidateQueries();
      toast.success(`Food database ready — ${total.toLocaleString()} USDA foods`);
    } catch (err) {
      setError(err);
    } finally {
      setStep(null);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button size={compact ? "sm" : "md"} onClick={run} loading={step !== null}>
          <Database className="size-4" /> Load USDA food database
        </Button>
        <span className="text-xs text-muted">{step ?? "About 13,000 foods · takes about a minute · safe to repeat"}</span>
      </div>
      {error ? <ErrorBanner error={error} onRetry={run} /> : null}
    </div>
  );
}
