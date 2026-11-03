"use client";

import { PenLine } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, ErrorBanner, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { VitalsJ } from "@/lib/client/types";
import { formatSleepMinutes, HEALTH_METRIC_BY_KEY } from "@/lib/health/metrics";
import { formatLocalDate } from "@/lib/time";
import { dayValue, fmtMetric, MANUAL_METRICS, METRIC_LABEL, type MetricKey } from "./health-utils";

const UNIT_SUFFIX: Partial<Record<MetricKey, string>> = { steps: "steps", resting_hr: "bpm", hrv: "ms", active_energy: "kcal" };

function toNum(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

type StageKey = "deep" | "core" | "rem" | "awake";
const STAGES: { key: StageKey; label: string }[] = [
  { key: "deep", label: "Deep" },
  { key: "core", label: "Core / light" },
  { key: "rem", label: "REM" },
  { key: "awake", label: "Awake" },
];

export function ManualEntryForm({ today, vitals, defaultMetric = "steps", onDone, onCancel }: { today: string; vitals?: VitalsJ; defaultMetric?: MetricKey; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [date, setDate] = useState(today);
  const [metric, setMetric] = useState<MetricKey>(MANUAL_METRICS.includes(defaultMetric) ? defaultMetric : "steps");
  const [value, setValue] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [showStages, setShowStages] = useState(false);
  const [stages, setStages] = useState<Record<StageKey, string>>({ deep: "", core: "", rem: "", awake: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const def = HEALTH_METRIC_BY_KEY[metric];

  // Validation (all client-side checks mirror the server's plausible ranges).
  let total: number | null = null;
  let valueError: string | null = null;
  if (metric === "sleep") {
    const h = toNum(hours);
    const m = toNum(minutes);
    if (Number.isNaN(h) || Number.isNaN(m) || (h != null && (h < 0 || h > 20)) || (m != null && (m < 0 || m > 59))) valueError = "Enter hours (0–20) and minutes (0–59).";
    else if (h != null || m != null) total = (h ?? 0) * 60 + (m ?? 0);
  } else {
    const n = toNum(value);
    if (Number.isNaN(n)) valueError = "Enter a number.";
    else total = n;
  }
  if (total != null && !valueError && (total < def.min || total > def.max)) valueError = `${def.label} must be between ${def.min.toLocaleString()} and ${def.max.toLocaleString()} ${def.unit === "min" ? "minutes" : def.unit}.`;
  if (metric === "sleep" && total === 0) valueError = "Enter the time you were asleep.";
  const stageNums = Object.fromEntries(STAGES.map((s) => [s.key, toNum(stages[s.key])])) as Record<StageKey, number | null>;
  const stageError = showStages && metric === "sleep" ? (Object.values(stageNums).some((v) => v != null && (Number.isNaN(v) || v < 0 || v > 1200)) ? "Stage minutes must be between 0 and 1,200." : total != null && (stageNums.deep ?? 0) + (stageNums.core ?? 0) + (stageNums.rem ?? 0) > total + 1 ? "Deep + core + REM can't be more than the total time asleep." : null) : null;
  const future = date > today;
  const canSave = total != null && !valueError && !stageError && !future;

  const existing = dayValue(vitals?.metrics[metric] ?? null, date);
  const existingSynced = existing && existing.source !== "manual" ? existing : null;

  const save = async () => {
    if (!canSave || total == null) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { localDate: date, metric, value: total };
      if (metric === "sleep" && showStages && Object.values(stageNums).some((v) => v != null)) body.stages = { deep: stageNums.deep, core: stageNums.core, rem: stageNums.rem, awake: stageNums.awake };
      await api.post("/api/vitals", body);
      await invalidate();
      toast.success(`${def.label} saved for ${formatLocalDate(date)} (entered manually)`);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
        <Badge tone="outline">
          <PenLine className="size-3" aria-hidden /> Entered manually
        </Badge>
        Values you type are labeled as manual entries, separate from anything your phone syncs.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Day" error={future ? "Health data can't be entered for future days." : null}>
          {(id) => <Input id={id} type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />}
        </Field>
        <Field label="What">
          {(id) => (
            <Select
              id={id}
              value={metric}
              onChange={(e) => {
                setMetric(e.target.value as MetricKey);
                setValue("");
                setError(null);
              }}
            >
              {MANUAL_METRICS.map((k) => (
                <option key={k} value={k}>
                  {METRIC_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {metric === "sleep" ? (
        <div className="flex flex-col gap-3">
          <Field label="Time asleep (night ending on this day)" error={valueError} hint={total ? `= ${formatSleepMinutes(total)}` : "Not time in bed — the time you were actually asleep."}>
            {(id) => (
              <div className="flex items-center gap-2">
                <Input id={id} inputMode="numeric" aria-label="Hours asleep" placeholder="7" value={hours} onChange={(e) => setHours(e.target.value)} className="w-20" />
                <span className="text-sm text-muted">h</span>
                <Input inputMode="numeric" aria-label="Minutes asleep" placeholder="30" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-20" />
                <span className="text-sm text-muted">min</span>
              </div>
            )}
          </Field>
          <button type="button" className="self-start text-sm font-medium text-accent" aria-expanded={showStages} onClick={() => setShowStages(!showStages)}>
            {showStages ? "Hide sleep stages" : "Add sleep stages (optional)"}
          </button>
          {showStages && (
            <div className="grid grid-cols-2 gap-3">
              {STAGES.map((s) => (
                <Field key={s.key} label={`${s.label} (min)`}>
                  {(id) => <Input id={id} inputMode="numeric" value={stages[s.key]} onChange={(e) => setStages({ ...stages, [s.key]: e.target.value })} />}
                </Field>
              ))}
              {stageError && (
                <p className="col-span-2 text-xs text-critical" role="alert">
                  {stageError}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <Field label={`${def.label} (${UNIT_SUFFIX[metric] ?? def.unit})`} error={valueError} hint={def.description}>
          {(id) => <Input id={id} inputMode={metric === "steps" ? "numeric" : "decimal"} value={value} onChange={(e) => setValue(e.target.value)} className="sm:max-w-48" />}
        </Field>
      )}

      {existingSynced && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-2">
          {existingSynced.sourceLabel} already reported {fmtMetric(metric, existingSynced.value)} for this day. The most recently saved value is shown; the other is kept and listed as an alternative, never added together.
        </p>
      )}
      <p className="text-xs text-muted">Sleep scores can&apos;t be entered by hand — they&apos;re only shown when a connected device or app provides its own.</p>

      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="lg" loading={saving} disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
  );
}
