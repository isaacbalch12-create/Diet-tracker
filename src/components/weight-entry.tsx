"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { SettingsJ, WeightEntryJ } from "@/lib/client/types";
import { localParts, logicalDayTimeToInstant, zonedToInstant } from "@/lib/time";
import { Button, cx, ErrorBanner, Input } from "./ui";
import { useToast } from "./toast";

export function defaultPeriod(tz: string): "morning" | "night" {
  const h = localParts(new Date(), tz).hour;
  return h >= 4 && h < 15 ? "morning" : "night";
}

/**
 * Fast weigh-in form. For today it records the current time; for another day it
 * uses a typical time (7:00 / 22:00) unless the user sets one.
 */
export function WeightEntryForm({ settings, date, today, initialPeriod, compact, onDone }: { settings: SettingsJ; date: string; today: string; initialPeriod?: "morning" | "night"; compact?: boolean; onDone?: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [period, setPeriod] = useState<"morning" | "night">(initialPeriod ?? defaultPeriod(settings.timezone));
  const [value, setValue] = useState("");
  const [time, setTime] = useState("");
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<WeightEntryJ | null>(null);
  const unit = settings.weightUnit;

  const save = async (replace = false) => {
    const v = Number(value);
    if (!(v > 0) || v > 1500) {
      setError(new Error(`Enter your weight in ${unit}.`));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const measuredAt = time ? logicalDayTimeToInstant(date, time, settings.timezone, period === "night" ? Math.max(5, settings.dayStartHour) : 0) : date === today ? new Date() : zonedToInstant(date, period === "morning" ? "07:00" : "22:00", settings.timezone);
      await api.post("/api/weights", { value: v, unit, period, localDate: date, measuredAt: measuredAt.toISOString(), replace });
      setValue("");
      setConflict(null);
      await invalidate();
      toast.success(`${period === "morning" ? "Morning" : "Night"} weight saved`);
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "weight_exists") setConflict((err.details as { existing: WeightEntryJ }).existing);
      else setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      className="flex flex-col gap-2"
    >
      <div className={cx("flex gap-2", compact ? "flex-row flex-wrap items-center" : "flex-col")}>
        <div role="radiogroup" aria-label="Weigh-in" className="inline-flex w-fit shrink-0 rounded-lg bg-surface-2 p-0.5">
          {(["morning", "night"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={cx("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", period === p ? "bg-surface text-fg shadow-sm" : "text-fg-2")}
            >
              {p === "morning" ? <Sun className="size-3.5" aria-hidden /> : <Moon className="size-3.5" aria-hidden />}
              {p === "morning" ? "Morning" : "Night"}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="relative min-w-0 flex-1">
            <Input aria-label={`Weight in ${unit}`} inputMode="decimal" placeholder={unit === "lb" ? "e.g. 181.4" : "e.g. 82.3"} value={value} onChange={(e) => setValue(e.target.value)} className="min-w-24 pr-10 tabular" />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">{unit}</span>
          </div>
          <Button type="submit" loading={saving} className="shrink-0">
            Save
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        {showTime ? (
          <label className="flex items-center gap-2">
            Time
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-32" aria-label="Weigh-in time" />
          </label>
        ) : (
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setShowTime(true)}>
            {date === today ? "Recorded now — change time" : `For ${date} — set time`}
          </button>
        )}
      </div>
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">
          A {period} weight ({conflict.inputValue} {conflict.inputUnit}) is already logged for this day.
          <Button size="sm" variant="secondary" onClick={() => save(true)} loading={saving}>
            Replace it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>
            Cancel
          </Button>
        </div>
      )}
      {error ? <ErrorBanner error={error} /> : null}
    </form>
  );
}
