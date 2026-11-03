"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardTitle, Field, Input } from "@/components/ui";
import type { GoalJ2 } from "@/lib/client/types";
import type { UnitPrefs } from "@/lib/client/units";
import { formatLocalDate } from "@/lib/time";
import { fmtValue, rangeLabel } from "./labels";
import type { GoalActions } from "./use-goal-actions";

/** Custom goals take one check-in per day; "1 = done" goals get a toggle. */
export function CheckinCard({ goal, today, prefs, actions }: { goal: GoalJ2; today: string; prefs: UnitPrefs; actions: GoalActions }) {
  const daily = goal.period === "daily";
  const threshold = typeof goal.params.dailyThreshold === "number" ? goal.params.dailyThreshold : 1;
  const toggle = (daily && goal.targetValue === 1 && goal.comparator === "at_least") || (goal.aggregation === "count" && threshold === 1);
  const valueOn = (d: string): number | null => {
    if (!daily) return null;
    const v = goal.recent.find((p) => p.start === d)?.value;
    return v == null || v === 0 ? null : v;
  };
  const [date, setDate] = useState(today);
  const [value, setValue] = useState(() => {
    const v = valueOn(today);
    return v == null ? "" : String(v);
  });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = actions.busy === `${goal.id}:checkin`;
  const existing = valueOn(date);
  const unitText = goal.unitLabel?.trim() || "";
  const minDate = goal.startDate < today ? goal.startDate : today;

  const pickDate = (d: string) => {
    setDate(d);
    const v = valueOn(d);
    setValue(v == null ? "" : String(v));
    setError(null);
  };

  const save = async (v: number | null) => {
    if (!date || date > today) {
      setError("Choose today or an earlier day");
      return;
    }
    const ok = await actions.checkin(goal, date, v, note.trim() || null);
    if (ok) {
      setNote("");
      setError(null);
    }
  };

  const saveNumber = () => {
    const t = value.trim().replace(",", ".");
    const n = Number(t);
    if (!t || !Number.isFinite(n) || n < 0) {
      setError("Enter a number (0 or more)");
      return;
    }
    void save(n);
  };

  const recent = daily
    ? goal.recent
        .filter((p) => p.value != null && p.value > 0)
        .slice(-14)
        .reverse()
    : goal.recent
        .filter((p) => p.value != null && p.status !== "upcoming")
        .slice(-8)
        .reverse();

  return (
    <Card>
      <CardTitle sub={toggle ? "Mark a day as done. You can fill in earlier days too." : "Record a value for a day. Saving again replaces that day's value."}>Check in</CardTitle>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Day">{(id) => <Input id={id} type="date" value={date} min={minDate} max={today} onChange={(e) => pickDate(e.target.value)} />}</Field>
          {!toggle && (
            <Field label={unitText ? `Value (${unitText})` : "Value"}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError(null);
                  }}
                  placeholder="0"
                />
              )}
            </Field>
          )}
        </div>
        <Field label="Note (optional)">{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering" />}</Field>
        {daily && (
          <p className="text-sm text-fg-2" aria-live="polite">
            {formatLocalDate(date)}:{" "}
            {existing == null ? <span className="text-muted">no check-in yet</span> : toggle ? <span className="font-medium text-good-text">done</span> : <span className="font-medium text-fg">{fmtValue(existing, "custom", prefs, goal.unitLabel)}</span>}
          </p>
        )}
        {error && (
          <p className="text-xs text-critical" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {toggle ? (
            <Button size="lg" onClick={() => void save(1)} loading={busy} disabled={busy || (daily && existing != null && existing >= 1 && !note.trim())}>
              <Check className="size-4" aria-hidden /> {daily && existing != null && existing >= 1 ? "Done" : "Mark done"}
            </Button>
          ) : (
            <Button size="lg" onClick={saveNumber} loading={busy}>
              <Check className="size-4" aria-hidden /> Save
            </Button>
          )}
          <Button size="lg" variant="secondary" onClick={() => void save(null)} disabled={busy || (daily && existing == null)}>
            <X className="size-4" aria-hidden /> Clear day
          </Button>
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-3">
        <h3 className="text-sm font-medium text-fg">{daily ? "Recent check-ins" : "Recent periods"}</h3>
        {recent.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="mt-1 flex flex-col divide-y divide-line text-sm">
            {recent.map((p) => (
              <li key={p.start} className="flex items-center justify-between gap-3 py-2">
                {daily ? (
                  <button type="button" className="text-left text-fg-2 hover:text-fg hover:underline" onClick={() => pickDate(p.start)} aria-label={`Edit check-in for ${formatLocalDate(p.start)}`}>
                    {formatLocalDate(p.start)}
                  </button>
                ) : (
                  <span className="text-fg-2">{rangeLabel(p)}</span>
                )}
                <span className="font-medium text-fg tabular">{toggle && daily ? "Done" : fmtValue(p.value, goal.aggregation === "count" ? "days" : "custom", prefs, goal.unitLabel)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
