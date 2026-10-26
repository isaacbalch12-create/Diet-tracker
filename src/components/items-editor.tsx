"use client";

import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Plus, Replace, Trash2 } from "lucide-react";
import { useState } from "react";
import { itemFromFood, rematchItem, unitOptions, withNutrientTotal } from "@/lib/client/items";
import type { DraftItem } from "@/lib/drafts";
import { fdcUrl, fmtQty } from "@/lib/format";
import { itemGrams, itemNutrients, itemsTotals } from "@/lib/nutrition/calc";
import { NUTRIENTS, type NutrientKey } from "@/lib/nutrition/nutrients";
import { FoodPicker } from "./food-search";
import { ConfidenceBadge, MacroLine, NutrientGrid, SourceBadge } from "./nutrition";
import { Badge, Button, cx, IconButton, Input, Select } from "./ui";
import { totalsViewClient } from "./totals";

function NumberInput({ value, onCommit, label, className }: { value: number | null | undefined; onCommit: (v: number | null) => void; label: string; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null ? "" : String(Math.round(value * 100) / 100));
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    setDraft(null);
    if (t === "") return onCommit(null);
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) onCommit(n);
  };
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={cx("h-9 tabular", className)}
    />
  );
}

function ItemRow({ item, onChange, onRemove, readOnly }: { item: DraftItem; onChange: (i: DraftItem) => void; onRemove: () => void; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [rematch, setRematch] = useState(false);
  const grams = itemGrams(item);
  const n = itemNutrients(item);
  const units = unitOptions(item);
  const link = item.sourceRef?.provider === "usda" ? fdcUrl(item.sourceRef.fdcId) : null;
  const ai = item.aiOriginal as { quantity?: number; unit?: string; grams_per_unit?: number } | null;

  return (
    <li className="py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {readOnly ? (
            <p className="font-medium text-fg">{item.name}</p>
          ) : (
            <Input aria-label="Food name" value={item.name} onChange={(e) => onChange({ ...item, name: e.target.value })} className="h-9 font-medium" />
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <SourceBadge source={item.nutrientSource} />
            <ConfidenceBadge confidence={item.confidence} />
            {item.isAssumed && <Badge tone="warning" title="Inferred by the AI, not stated or clearly visible">Assumed</Badge>}
            {item.cookingMethod && <Badge tone="outline">{item.cookingMethod}</Badge>}
            {item.quantitySource === "ai_estimate" && <Badge tone="outline" title="The amount was estimated by AI">Amount estimated</Badge>}
          </div>
        </div>
        {!readOnly && (
          <IconButton label={`Remove ${item.name}`} onClick={onRemove}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {readOnly ? (
          <span className="text-sm text-fg-2">
            {item.unit === "g" ? (
              `${fmtQty(item.quantity)} g`
            ) : (
              <>
                {fmtQty(item.quantity)} × {item.unit} <span className="text-muted">({fmtQty(grams)} g)</span>
              </>
            )}
          </span>
        ) : (
          <>
            <NumberInput label="Quantity" value={item.quantity} className="w-20" onCommit={(v) => v && v > 0 && onChange({ ...item, quantity: v, quantitySource: "manual" })} />
            <span className="text-muted">×</span>
            <Select
              aria-label="Unit"
              value={item.unit}
              className="h-9 w-auto max-w-[14rem]"
              onChange={(e) => {
                const u = units.find((p) => p.label === e.target.value);
                if (!u) return;
                // Keep the same total grams when switching units.
                const q = grams / u.grams;
                onChange({ ...item, unit: u.label, gramsPerUnit: u.grams, quantity: Math.round(q * 100) / 100 || 1, quantitySource: "manual" });
              }}
            >
              {units.map((u) => (
                <option key={u.label} value={u.label}>
                  {u.label}
                  {u.label !== "g" ? ` (${fmtQty(u.grams)} g)` : ""}
                </option>
              ))}
            </Select>
            <span className="text-sm text-muted tabular">= {fmtQty(grams)} g</span>
          </>
        )}
        <span className="ml-auto">
          <MacroLine values={n} />
        </span>
      </div>

      {item.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {item.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-text">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}
      {item.notes && <p className="mt-1.5 text-xs text-muted">{item.notes}</p>}

      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {open ? "Hide details" : readOnly ? "All nutrients & source" : "Edit nutrients & source"}
      </button>

      {open && (
        <div className="mt-2 rounded-lg bg-surface-2 p-3">
          <div className="mb-3 flex flex-col gap-1 text-xs text-fg-2">
            {item.sourceRef ? (
              <span>
                Matched to: <span className="font-medium text-fg">{item.sourceRef.description}</span>
                {link && (
                  <a href={link} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-accent">
                    USDA #{item.sourceRef.fdcId} <ExternalLink className="size-3" />
                  </a>
                )}
              </span>
            ) : (
              <span>No database match — values are {item.nutrientSource === "ai_estimate" ? "AI estimates" : "entered manually"}.</span>
            )}
            {ai?.quantity !== undefined && (
              <span>
                Original AI estimate: {fmtQty(ai.quantity)} × {ai.unit} ({fmtQty((ai.quantity ?? 0) * (ai.grams_per_unit ?? 0))} g)
              </span>
            )}
            {item.manualNutrients.length > 0 && <span>Corrected by you: {item.manualNutrients.map((k) => NUTRIENTS.find((d) => d.key === k)?.label).join(", ")}</span>}
          </div>
          {readOnly ? (
            <NutrientGrid values={n} />
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">Totals for this amount. Editing a value marks it as manual; changing the amount later scales it.</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                {NUTRIENTS.map((d) => (
                  <label key={d.key} className="flex flex-col gap-1 text-xs text-fg-2">
                    <span>
                      {d.label} ({d.unit})
                    </span>
                    <NumberInput label={`${d.label} total`} value={n[d.key] ?? null} onCommit={(v) => onChange(withNutrientTotal(item, d.key as NutrientKey, v))} />
                  </label>
                ))}
              </div>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setRematch(true)}>
                <Replace className="size-3.5" /> Change database match
              </Button>
            </>
          )}
        </div>
      )}
      <FoodPicker
        open={rematch}
        onClose={() => setRematch(false)}
        title={`Match “${item.name}” to a database food`}
        allowManual={false}
        onPickFood={(f) => {
          onChange(rematchItem(item, f));
          setRematch(false);
        }}
      />
    </li>
  );
}

export function ItemsEditor({ items, onChange, readOnly }: { items: DraftItem[]; onChange?: (items: DraftItem[]) => void; readOnly?: boolean }) {
  const [adding, setAdding] = useState(false);
  const totals = totalsViewClient(itemsTotals(items));
  const update = (key: string, next: DraftItem) => onChange?.(items.map((i) => (i.key === key ? next : i)));
  return (
    <div>
      {items.length === 0 ? (
        <p className="py-4 text-sm text-muted">No foods yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((it) => (
            <ItemRow key={it.key} item={it} readOnly={readOnly} onChange={(n) => update(it.key, n)} onRemove={() => onChange?.(items.filter((x) => x.key !== it.key))} />
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        {!readOnly ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add food
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Total</span>
          <MacroLine values={totals.values} incomplete={totals.incomplete} className="text-sm" />
        </div>
      </div>
      {totals.incomplete.length > 0 && items.length > 0 && (
        <p className="mt-1 text-right text-xs text-muted">
          “+” means some foods lack data for that nutrient ({totals.incomplete.map((k) => NUTRIENTS.find((d) => d.key === k)?.shortLabel).slice(0, 6).join(", ")}
          {totals.incomplete.length > 6 ? ", …" : ""}).
        </p>
      )}
      <FoodPicker
        open={adding}
        onClose={() => setAdding(false)}
        onPickFood={(f) => {
          onChange?.([...items, itemFromFood(f)]);
          setAdding(false);
        }}
        onAddManual={(item) => {
          onChange?.([...items, item]);
          setAdding(false);
        }}
      />
    </div>
  );
}
