"use client";

import { useId } from "react";
import { cx } from "@/components/ui";
import { HEALTH_METRICS } from "@/lib/health/metrics";
import type { MetricKey } from "./health-utils";

const SHORT_HINT: Record<MetricKey, string> = {
  steps: "Daily step count",
  sleep: "Time asleep, plus stages when recorded",
  sleep_score: "Only if a device/app (Oura, Fitbit, Garmin…) provides one",
  resting_hr: "From your watch",
  hrv: "From your watch",
  active_energy: "Device estimate",
};

/** Checkboxes for the kinds of data a connection may write. At least one must stay selected. */
export function ScopePicker({ value, onChange, disabled, compact, legend = "Data this connection may send" }: { value: MetricKey[]; onChange: (v: MetricKey[]) => void; disabled?: boolean; compact?: boolean; legend?: string }) {
  const base = useId();
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-fg-2">{legend}</legend>
      <div className={cx("grid gap-1.5", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
        {HEALTH_METRICS.map((m) => {
          const key = m.key as MetricKey;
          const checked = value.includes(key);
          const onlyOne = checked && value.length === 1;
          const id = `${base}-${key}`;
          return (
            <label
              key={key}
              htmlFor={id}
              className={cx(
                "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                checked ? "border-accent/50 bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-2",
                (disabled || onlyOne) && "cursor-default opacity-80",
              )}
              title={onlyOne ? "A connection needs at least one kind of data" : undefined}
            >
              <input
                id={id}
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                checked={checked}
                disabled={onlyOne}
                onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((x) => x !== key))}
              />
              <span className="min-w-0">
                <span className="block font-medium text-fg">{m.label}</span>
                {!compact && <span className="block text-xs text-muted">{SHORT_HINT[key]}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
