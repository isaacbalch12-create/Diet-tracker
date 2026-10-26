"use client";

import { Moon, Pencil, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import { AverageChart, FluctuationChart, WeightChart } from "@/components/charts";
import { useToast } from "@/components/toast";
import { Button, Card, CardTitle, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, Segmented, Skeleton, Stat } from "@/components/ui";
import { WeightEntryForm } from "@/components/weight-entry";
import { api } from "@/lib/client/api";
import { useInvalidateData, useSettings, useWeights } from "@/lib/client/hooks";
import type { SettingsJ, WeightEntryJ, WeightOverviewJ } from "@/lib/client/types";
import { fmtTime } from "@/lib/format";
import { formatLocalDate, localParts, logicalDayTimeToInstant, RANGE_LABELS, RANGE_PRESETS, type RangePreset } from "@/lib/time";
import { formatWeight, formatWeightDelta, fromKg, type WeightUnit } from "@/lib/units";

function Change({ label, change, unit }: { label: string; change: { value: number | null; reason?: string }; unit: WeightUnit }) {
  return <Stat label={label} value={change.value == null ? <span className="text-base text-muted">—</span> : formatWeightDelta(change.value, unit)} sub={change.value == null ? change.reason : undefined} />;
}

function EditEntry({ entry, settings, onClose }: { entry: WeightEntryJ; settings: SettingsJ; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const lp = localParts(new Date(entry.measuredAt), entry.timezone);
  const [value, setValue] = useState(String(Number(fromKg(entry.weightKg, settings.weightUnit).toFixed(2))));
  const [period, setPeriod] = useState(entry.period);
  const [date, setDate] = useState(entry.localDate);
  const [time, setTime] = useState(lp.time);
  const [note, setNote] = useState(entry.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Night weigh-ins after midnight belong to the previous day: keep the calendar date of the time.
      await api.patch(`/api/weights/${entry.id}`, {
        value: Number(value),
        unit: settings.weightUnit,
        period,
        localDate: date,
        measuredAt: logicalDayTimeToInstant(date, time, entry.timezone, period === "night" ? Math.max(5, settings.dayStartHour) : 0).toISOString(),
        note: note.trim() || null,
      });
      await invalidate();
      toast.success("Weight updated");
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Weight (${settings.weightUnit})`}>{(id) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
        <Field label="Weigh-in">
          {() => (
            <Segmented
              label="Weigh-in"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "morning", label: "Morning" },
                { value: "night", label: "Night" },
              ]}
            />
          )}
        </Field>
        <Field label="Day">{(id) => <Input id={id} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}</Field>
        <Field label="Time">{(id) => <Input id={id} type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />}</Field>
      </div>
      <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />}</Field>
      <p className="text-xs text-muted">
        Originally entered as {entry.inputValue} {entry.inputUnit}.
      </p>
      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}

function EntriesTable({ data, settings }: { data: WeightOverviewJ; settings: SettingsJ }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [editing, setEditing] = useState<WeightEntryJ | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const unit = settings.weightUnit;
  const visible = showAll ? data.entries : data.entries.slice(0, 14);
  const remove = async (e: WeightEntryJ) => {
    if (!window.confirm(`Delete the ${e.period} weight on ${e.localDate}?`)) return;
    try {
      await api.del(`/api/weights/${e.id}`);
      await invalidate();
      toast.success("Weight entry deleted");
    } catch (err) {
      toast.error(err);
    }
  };
  const missingMorning = data.missing.filter((m) => m.missingMorning).length;
  const missingNight = data.missing.filter((m) => m.missingNight).length;
  return (
    <Card>
      <CardTitle
        sub={`${data.loggedDays} of ${data.totalDays} days have a weigh-in · ${missingMorning} missing morning · ${missingNight} missing night. Missing readings are skipped in averages, never counted as zero.`}
        action={
          data.missing.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowMissing(!showMissing)}>
              {showMissing ? "Hide gaps" : "Show gaps"}
            </Button>
          ) : undefined
        }
      >
        Entries
      </CardTitle>
      {showMissing && (
        <ul className="mb-4 flex max-h-56 flex-col gap-1 overflow-auto rounded-lg bg-surface-2 p-2 text-sm">
          {[...data.missing].reverse().map((m) => (
            <li key={m.date} className="flex items-center justify-between gap-2 px-1">
              <span className="text-fg-2">
                {formatLocalDate(m.date)} — missing {m.missingMorning && m.missingNight ? "both" : m.missingMorning ? "morning" : "night"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setAdding(m.date)}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data.entries.length === 0 ? (
        <p className="text-sm text-muted">No weigh-ins in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 pr-3 font-medium">Day</th>
                <th className="py-2 pr-3 font-medium">Weigh-in</th>
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 text-right font-medium">Weight</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {visible.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 text-fg">{formatLocalDate(e.localDate)}</td>
                  <td className="py-2 pr-3 text-fg-2">
                    <span className="inline-flex items-center gap-1">
                      {e.period === "morning" ? <Sun className="size-3.5" aria-hidden /> : <Moon className="size-3.5" aria-hidden />}
                      {e.period === "morning" ? "Morning" : "Night"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-fg-2">{fmtTime(e.measuredAt, e.timezone)}</td>
                  <td className="py-2 pr-3 text-right font-medium text-fg">
                    {formatWeight(e.weightKg, unit)}
                    {e.note && <span className="block text-xs font-normal text-muted">{e.note}</span>}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    <IconButton label={`Edit ${e.period} weight on ${e.localDate}`} onClick={() => setEditing(e)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label={`Delete ${e.period} weight on ${e.localDate}`} onClick={() => remove(e)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.entries.length > visible.length && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(true)}>
              Show all {data.entries.length} entries
            </Button>
          )}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit weigh-in">
        {editing && <EditEntry entry={editing} settings={settings} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding ? `Add weigh-in for ${formatLocalDate(adding)}` : "Add weigh-in"}>
        {adding && <WeightEntryForm settings={settings} date={adding} today={data.range.end} onDone={() => setAdding(null)} />}
      </Modal>
    </Card>
  );
}

export function WeightView() {
  const settingsQ = useSettings();
  const [range, setRange] = useState<RangePreset>("30d");
  const q = useWeights(`range=${range}`);
  if (!settingsQ.data) return null;
  const settings = settingsQ.data.settings;
  const unit = settings.weightUnit;
  const conv = (kg: number | null) => (kg == null ? null : fromKg(kg, unit));
  const d = q.data;
  const s = d?.summary;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Weight</h1>
        <Segmented label="Range" size="sm" value={range} onChange={setRange} options={RANGE_PRESETS.map((r) => ({ value: r, label: RANGE_LABELS[r] }))} />
      </div>

      <Card>
        <CardTitle sub="Weigh in after waking (and using the bathroom) and again before bed.">Log a weigh-in</CardTitle>
        <WeightEntryForm settings={settings} date={settingsQ.data.today} today={settingsQ.data.today} compact />
      </Card>

      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {!d || !s ? (
        <Skeleton className="h-96" />
      ) : s.latestDate === null ? (
        <EmptyState title="No weigh-ins yet">Log your first morning weight above. Charts, averages and trends appear as entries accumulate.</EmptyState>
      ) : (
        <div className={`flex flex-col gap-4 ${q.isFetching ? "opacity-80" : ""}`}>
          <Card>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              <Stat label="7-day average" value={s.current7DayAverage != null ? formatWeight(s.current7DayAverage, unit) : "—"} sub={s.current7DayAverage == null ? "Needs 3+ days in the last week" : undefined} />
              <Stat label={`Latest (${s.latestDate ? formatLocalDate(s.latestDate, { month: "short", day: "numeric" }) : "—"})`} value={formatWeight(s.latestDaily, unit)} sub={[s.latestMorning && s.latestMorning.date === s.latestDate ? `AM ${formatWeight(s.latestMorning.value, unit)}` : null, s.latestNight && s.latestNight.date === s.latestDate ? `PM ${formatWeight(s.latestNight.value, unit)}` : null].filter(Boolean).join(" · ")} />
              <Change label="vs previous day" change={s.changeVsPreviousDay} unit={unit} />
              <Change label="vs previous week" change={s.changeVsPreviousWeek} unit={unit} />
              <Change label="vs previous month" change={s.changeVsPreviousMonth} unit={unit} />
              <Change label="Since start" change={s.changeFromStart} unit={unit} />
              <Stat label="To target" value={s.toTarget == null ? "—" : formatWeightDelta(s.toTarget, unit)} sub={s.toTarget == null ? "Set a target in Settings" : undefined} />
              <Stat label="Avg night − morning" value={s.averageFluctuation == null ? "—" : formatWeightDelta(s.averageFluctuation, unit)} />
            </div>
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              Week/month changes compare 7-day averages to damp day-to-day water swings.
              {d.trend && (
                <>
                  {" "}
                  Trend over this range: <span className="font-medium text-fg-2">{formatWeightDelta(d.trend.slopePerWeek, unit)}/week</span> (linear fit on {d.trend.n} days — an estimate, not a prediction).
                </>
              )}
            </p>
          </Card>

          <WeightChart unit={unit} data={d.days.map((x) => ({ date: x.date, morning: conv(x.morning), night: conv(x.night), average: conv(x.average), rolling7: conv(x.rolling7), trend: conv(x.trend) }))} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AverageChart title="Weekly average" sub="Mean of daily averages, weeks start Monday." unit={unit} labelFmt={(k) => formatLocalDate(k, { month: "short", day: "numeric" })} data={d.weekly.map((w) => ({ key: w.start, label: `Week of ${w.start}`, average: conv(w.average), days: w.days }))} />
            <AverageChart title="Monthly average" unit={unit} labelFmt={(k) => formatLocalDate(`${k}-01`, { month: "short", year: "2-digit" })} data={d.monthly.map((m) => ({ key: m.key, label: m.key, average: conv(m.average), days: m.days }))} />
          </div>

          <FluctuationChart unit={unit} data={d.days.map((x) => ({ date: x.date, fluctuation: conv(x.fluctuation) }))} />

          <EntriesTable data={d} settings={settings} />
        </div>
      )}
    </div>
  );
}
