"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, PenLine, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { manualItem } from "@/lib/client/items";
import type { FoodJ, FoodSearchResultJ } from "@/lib/client/types";
import type { DraftItem } from "@/lib/drafts";
import { fmtKcal } from "@/lib/format";
import { Badge, Button, cx, ErrorBanner, Field, Input, Modal, Segmented, Spinner } from "./ui";
import { useToast } from "./toast";

const TYPE_LABEL: Record<string, string> = { fndds: "USDA survey", sr_legacy: "USDA SR", foundation: "USDA foundation", branded: "Branded", custom: "My food" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function FoodResults({ query, branded, onPick }: { query: string; branded: boolean; onPick: (f: FoodSearchResultJ) => void }) {
  const q = useDebounced(query.trim(), 300);
  const res = useQuery({
    queryKey: ["food-search", q, branded],
    queryFn: () => api.get<{ results: FoodSearchResultJ[]; usedApi: boolean; apiError: string | null }>(`/api/foods/search?q=${encodeURIComponent(q)}${branded ? "&branded=1" : ""}`),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
  });
  if (q.length < 2) return <p className="py-6 text-center text-sm text-muted">Type at least 2 letters, e.g. “greek yogurt” or “chicken breast grilled”.</p>;
  if (res.isLoading) return <Spinner className="py-6" label="Searching" />;
  if (res.error) return <ErrorBanner error={res.error} onRetry={() => res.refetch()} />;
  const data = res.data!;
  return (
    <div className="flex flex-col gap-2">
      {data.apiError && <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-text">{data.apiError}</p>}
      {data.results.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No matches. Try simpler words, search branded products, or add it manually.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {data.results.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => onPick(f)} className="flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-surface-2">
                <span className="text-sm font-medium text-fg">
                  {f.description}
                  {f.brand && <span className="font-normal text-muted"> · {f.brand}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone="outline">{TYPE_LABEL[f.dataType] ?? f.dataType}</Badge>
                  <span className="tabular">
                    {fmtKcal(f.nutrientsPer100g.calories)} kcal · P {Math.round(f.nutrientsPer100g.protein ?? 0)} · C {Math.round(f.nutrientsPer100g.carbs ?? 0)} · F {Math.round(f.nutrientsPer100g.fat ?? 0)} per 100 g
                  </span>
                  {f.portions[0] && (
                    <span>
                      · 1 {f.portions[0].label} = {Math.round(f.portions[0].grams)} g
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Source: USDA FoodData Central{data.usedApi ? " (online search)" : " (local copy)"}.</p>
    </div>
  );
}

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function ManualEntry({ onAdd }: { onAdd: (item: DraftItem) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", grams: "", calories: "", protein: "", carbs: "", fat: "", saveAsFood: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "saveAsFood" ? e.target.checked : e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const grams = num(f.grams);
    const calories = num(f.calories);
    if (!f.name.trim() || !grams || grams <= 0 || calories === undefined) {
      setError("Name, amount in grams and calories are required.");
      return;
    }
    const nutrients = { calories, protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat) };
    setSaving(true);
    try {
      if (f.saveAsFood) {
        await api.post<{ food: FoodJ }>("/api/foods", { description: f.name.trim(), servingGrams: grams, nutrientsPerServing: nutrients });
        toast.success("Saved to My foods");
      }
      onAdd(manualItem({ name: f.name.trim(), grams, nutrients }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-muted">Enter values from a nutrition label or recipe. They&apos;re stored as manually entered.</p>
      <Field label="Food name">{(id) => <Input id={id} value={f.name} onChange={set("name")} required />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount eaten (g)">{(id) => <Input id={id} inputMode="decimal" value={f.grams} onChange={set("grams")} required />}</Field>
        <Field label="Calories (kcal)">{(id) => <Input id={id} inputMode="decimal" value={f.calories} onChange={set("calories")} required />}</Field>
        <Field label="Protein (g)">{(id) => <Input id={id} inputMode="decimal" value={f.protein} onChange={set("protein")} />}</Field>
        <Field label="Carbs (g)">{(id) => <Input id={id} inputMode="decimal" value={f.carbs} onChange={set("carbs")} />}</Field>
        <Field label="Fat (g)">{(id) => <Input id={id} inputMode="decimal" value={f.fat} onChange={set("fat")} />}</Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-fg-2">
        <input type="checkbox" checked={f.saveAsFood} onChange={set("saveAsFood")} className="size-4 accent-[var(--accent)]" />
        Also save to “My foods” for future searches (amount = one serving)
      </label>
      {error && <ErrorBanner error={error} />}
      <Button type="submit" loading={saving}>
        Add food
      </Button>
    </form>
  );
}

/** Modal to add a food (database search or manual) or re-match an item to a database entry. */
export function FoodPicker({ open, onClose, onPickFood, onAddManual, title = "Add food", allowManual = true }: { open: boolean; onClose: () => void; onPickFood: (f: FoodSearchResultJ) => void; onAddManual?: (item: DraftItem) => void; title?: string; allowManual?: boolean }) {
  const [tab, setTab] = useState<"search" | "manual">("search");
  const [q, setQ] = useState("");
  const [branded, setBranded] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {allowManual && onAddManual && (
        <div className="mb-3">
          <Segmented
            label="Add method"
            value={tab}
            onChange={setTab}
            options={[
              { value: "search", label: <span className="inline-flex items-center gap-1.5"><Database className="size-3.5" />Search database</span> },
              { value: "manual", label: <span className="inline-flex items-center gap-1.5"><PenLine className="size-3.5" />Enter manually</span> },
            ]}
          />
        </div>
      )}
      {tab === "search" || !onAddManual ? (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input autoFocus aria-label="Search foods" placeholder="Search foods…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <label className={cx("flex items-center gap-2 text-sm text-fg-2")}>
            <input type="checkbox" checked={branded} onChange={(e) => setBranded(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Search branded products (USDA online)
          </label>
          <FoodResults query={q} branded={branded} onPick={onPickFood} />
        </div>
      ) : (
        <ManualEntry onAdd={(item) => onAddManual(item)} />
      )}
    </Modal>
  );
}
