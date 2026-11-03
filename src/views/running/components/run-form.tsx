"use client";

import { BedDouble, Footprints, HeartPulse } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, cx, ErrorBanner, Field, Input, Segmented, Textarea } from "@/components/ui";
import { api, newRequestId } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { SettingsJ } from "@/lib/client/types";
import { fmtNum } from "@/lib/client/units";
import { fromMeters, type DistanceUnit } from "@/lib/running/stats";
import { formatLocalDate } from "@/lib/time";
import { EFFORT_LABELS, type RunDayJ, type RunEntryJ } from "./run-meta";

type Mode = "run" | "rest" | "recovery";

function parseDistance(raw: string): { value: number | null; error: string | null } {
  const t = raw.trim().replace(",", ".");
  if (!t) return { value: null, error: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { value: null, error: "Enter a distance above 0, or leave it blank." };
  if (n > 500) return { value: null, error: "That's more than 500 — check the unit." };
  return { value: n, error: null };
}

export function EffortPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Perceived effort, 1 very easy to 10 max" className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} — ${EFFORT_LABELS[n]}`}
            title={EFFORT_LABELS[n]}
            onClick={() => onChange(value === n ? null : n)}
            className={cx(
              "h-11 rounded-lg border text-sm font-semibold tabular transition-colors",
              value === n ? "border-accent bg-accent text-accent-fg" : "border-line-strong bg-surface text-fg-2 hover:bg-surface-2",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted" aria-hidden>
        <span>Easy</span>
        <span>Moderate</span>
        <span>Hard</span>
        <span>Max</span>
      </div>
      <p className="text-xs text-fg-2" aria-live="polite">
        {value ? `${value}/10 · ${EFFORT_LABELS[value]}` : "Optional — how hard it felt overall."}
      </p>
    </div>
  );
}

export function RunTypeChips({ types, value, onChange }: { types: string[]; value: string | null; onChange: (v: string | null) => void }) {
  const list = value && !types.includes(value) ? [...types, value] : types;
  return (
    <div role="group" aria-label="Type of run" className="flex flex-wrap gap-1.5">
      {list.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={value === t}
          onClick={() => onChange(value === t ? null : t)}
          className={cx(
            "min-h-10 rounded-full border px-3.5 text-sm font-medium transition-colors",
            value === t ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface text-fg-2 hover:bg-surface-2",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export interface RunFormProps {
  settings: SettingsJ;
  today: string;
  /** Day statuses in view, to warn about rest markers / existing runs. */
  days?: RunDayJ[];
  /** Editing an existing run (PATCH) instead of logging a new one. */
  entry?: RunEntryJ | null;
  defaultDate?: string;
  defaultMode?: Mode;
  /** Most recent run distance, offered as a one-tap fill. */
  lastDistanceM?: number | null;
  /** Changes whenever the form should scroll into view and focus. */
  focusKey?: number;
  onDone?: () => void;
  onCancel?: () => void;
}

export function RunForm({ settings, today, days, entry, defaultDate, defaultMode = "run", lastDistanceM, focusKey = 0, onDone, onCancel }: RunFormProps) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const editing = !!entry;
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [date, setDate] = useState(entry?.localDate ?? defaultDate ?? today);
  const [unit, setUnit] = useState<DistanceUnit>(entry?.inputUnit ?? settings.distanceUnit);
  const [distance, setDistance] = useState(entry?.inputDistance != null ? String(entry.inputDistance) : "");
  const [runType, setRunType] = useState<string | null>(entry?.runType ?? null);
  const [effort, setEffort] = useState<number | null>(entry?.effort ?? null);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [requestId, setRequestId] = useState(() => newRequestId());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const distRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusKey <= 0) return;
    rootRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    distRef.current?.focus({ preventScroll: true });
  }, [focusKey]);

  const dist = parseDistance(distance);
  const day = days?.find((d) => d.date === date);
  const hasRun = day ? day.status === "done" || day.status === "short" : false;
  const isOff = day ? day.status === "rest" || day.status === "recovery" : false;
  const blockedDayOff = !editing && mode !== "run" && hasRun;
  const future = date > today;

  const reset = () => {
    setDistance("");
    setRunType(null);
    setEffort(null);
    setNotes("");
    setMode("run");
    setRequestId(newRequestId());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dist.error || blockedDayOff || future) return;
    setSaving(true);
    setError(null);
    try {
      const distPayload = dist.value != null ? { value: dist.value, unit } : null;
      if (editing && entry) {
        await api.patch(`/api/runs/${entry.id}`, { localDate: date, distance: distPayload, runType, effort, notes: notes.trim() || null });
        toast.success("Run updated");
      } else if (mode === "run") {
        await api.post("/api/runs", { clientRequestId: requestId, localDate: date, distance: distPayload, runType, effort, notes: notes.trim() || null });
        toast.success(date === today ? "Run logged — nice work" : `Run logged for ${formatLocalDate(date)}`);
      } else {
        await api.post("/api/runs/day-off", { localDate: date, kind: mode, notes: notes.trim() || null });
        toast.success(`${formatLocalDate(date)} marked as a ${mode} day`);
      }
      await invalidate();
      if (!editing) reset();
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const lastFill = lastDistanceM ? Number(fromMeters(lastDistanceM, unit).toFixed(2)) : null;

  return (
    <form ref={rootRef} onSubmit={submit} className="flex flex-col gap-4" aria-label={editing ? "Edit run" : "Log a run"}>
      {!editing && (
        <Segmented<Mode>
          label="What happened"
          value={mode}
          onChange={setMode}
          options={[
            { value: "run", label: <span className="inline-flex items-center gap-1.5"><Footprints className="size-3.5" aria-hidden /> Ran</span> },
            { value: "rest", label: <span className="inline-flex items-center gap-1.5"><BedDouble className="size-3.5" aria-hidden /> Rest day</span> },
            { value: "recovery", label: <span className="inline-flex items-center gap-1.5"><HeartPulse className="size-3.5" aria-hidden /> Recovery day</span> },
          ]}
        />
      )}

      <Field label="Day" error={future ? "Runs can't be logged for future days." : null}>
        {(id) => <Input id={id} type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="sm:max-w-48" />}
      </Field>

      {mode === "run" || editing ? (
        <>
          {!editing && isOff && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-2">This day is marked as a {day?.status} day. Logging a run replaces that marker.</p>}
          <Field label="Distance (optional)" error={dist.error} hint="Leave blank to just mark the run as done.">
            {(id) => (
              <div className="flex flex-wrap items-center gap-2">
                <Input id={id} ref={distRef} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.1" value={distance} onChange={(e) => setDistance(e.target.value)} className="w-28" />
                <Segmented<DistanceUnit>
                  label="Distance unit"
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: "mi", label: "mi" },
                    { value: "km", label: "km" },
                  ]}
                />
                {lastFill != null && !distance && (
                  <button type="button" onClick={() => setDistance(String(lastFill))} className="min-h-10 rounded-full border border-dashed border-line-strong px-3 text-xs text-fg-2 hover:bg-surface-2">
                    Same as last: {fmtNum(lastFill, 2)} {unit}
                  </button>
                )}
              </div>
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-fg-2">Type of run</p>
            <RunTypeChips types={settings.runTypes} value={runType} onChange={setRunType} />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-fg-2">Perceived effort</p>
            <EffortPicker value={effort} onChange={setEffort} />
          </div>
        </>
      ) : (
        <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-fg-2">
          {mode === "rest" ? (
            <p>A planned day off. It never breaks your streak and isn&apos;t counted against your consistency.</p>
          ) : (
            <p>
              Time off to recover from soreness, pain, illness or fatigue — it never breaks your streak. Rest is part of training: pain is a signal to stop, not push through. (Did an easy jog instead? Log it as a run with the type &ldquo;Recovery jog&rdquo;.)
            </p>
          )}
          {blockedDayOff && <p className="mt-2 font-medium text-critical">A run is already logged for this day. Delete it in History first to mark the day off.</p>}
        </div>
      )}

      <Field label="Notes (optional)">{(id) => <Textarea id={id} rows={2} value={notes} maxLength={mode === "run" || editing ? 2000 : 1000} onChange={(e) => setNotes(e.target.value)} placeholder={mode === "run" ? "Route, how you felt, anything that hurt…" : "Why you're taking the day"} />}</Field>

      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" size="lg" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="lg" loading={saving} disabled={!!dist.error || blockedDayOff || future}>
          {editing ? "Save changes" : mode === "run" ? "Log run" : mode === "rest" ? "Mark rest day" : "Mark recovery day"}
        </Button>
      </div>
    </form>
  );
}

/** Edit a rest/recovery marker: switch its kind or notes. */
export function DayOffForm({ entry, onDone, onCancel }: { entry: RunEntryJ; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [kind, setKind] = useState<"rest" | "recovery">(entry.kind === "recovery" ? "recovery" : "rest");
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/runs/day-off", { localDate: entry.localDate, kind, notes: notes.trim() || null });
      await invalidate();
      toast.success("Day updated");
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">{formatLocalDate(entry.localDate, { weekday: "long", month: "long", day: "numeric" })}</p>
      <Segmented
        label="Kind of day off"
        value={kind}
        onChange={setKind}
        options={[
          { value: "rest", label: "Rest day" },
          { value: "recovery", label: "Recovery day" },
        ]}
      />
      <Field label="Notes (optional)">{(id) => <Textarea id={id} rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}</Field>
      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" loading={saving} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
