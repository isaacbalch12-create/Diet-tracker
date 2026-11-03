"use client";

import { useEffect, useMemo, useRef } from "react";
import { cx } from "@/components/ui";
import { fmtDistance } from "@/lib/client/units";
import type { DistanceUnit } from "@/lib/running/stats";
import { addDays, formatLocalDate, startOfWeek } from "@/lib/time";
import { STATUS_META, type RunDayJ, type RunStatus } from "./run-meta";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describe(d: RunDayJ, unit: DistanceUnit): string {
  const parts = [formatLocalDate(d.date, { weekday: "short", month: "short", day: "numeric" }), STATUS_META[d.status].label];
  if (d.runs > 0) {
    parts.push(d.hasDistance ? fmtDistance(d.distanceM, unit) : "no distance recorded");
    if (d.runs > 1) parts.push(`${d.runs} runs`);
    if (d.maxEffort != null) parts.push(`effort ${d.maxEffort}/10`);
  }
  return parts.join(" · ");
}

/**
 * Calendar heatmap: one column per week, one row per weekday (in the user's
 * week order). Days before tracking started are left blank.
 */
export function RunCalendar({ days, weekStartsOn, unit, showShort }: { days: RunDayJ[]; weekStartsOn: number; unit: DistanceUnit; showShort: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { weeks, months } = useMemo(() => {
    if (!days.length) return { weeks: [] as (RunDayJ | null)[][], months: [] as { index: number; label: string }[] };
    const byDate = new Map(days.map((d) => [d.date, d]));
    const first = startOfWeek(days[0].date, weekStartsOn);
    const last = days[days.length - 1].date;
    const out: (RunDayJ | null)[][] = [];
    const monthMarks: { index: number; label: string }[] = [];
    let prevMonth = "";
    for (let ws = first, i = 0; ws <= last; ws = addDays(ws, 7), i++) {
      const col: (RunDayJ | null)[] = [];
      for (let k = 0; k < 7; k++) col.push(byDate.get(addDays(ws, k)) ?? null);
      out.push(col);
      const firstReal = col.find((c) => c !== null);
      const m = firstReal ? firstReal.date.slice(0, 7) : "";
      if (m && m !== prevMonth) {
        // Keep labels from colliding: a newer month wins over one that started 1–2 columns earlier.
        const prev = monthMarks[monthMarks.length - 1];
        if (prev && i - prev.index < 3) monthMarks.pop();
        monthMarks.push({ index: i, label: formatLocalDate(`${m}-01`, { month: "short" }) });
        prevMonth = m;
      }
    }
    return { weeks: out, months: monthMarks };
  }, [days, weekStartsOn]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks.length]);

  const cell = days.length <= 35 ? 30 : days.length <= 100 ? 15 : 12;
  const gap = cell >= 30 ? 4 : 3;
  const rowLabels = Array.from({ length: 7 }, (_, k) => WEEKDAY[(weekStartsOn + k) % 7]);
  const statuses: RunStatus[] = ["done", ...(showShort ? (["short"] as RunStatus[]) : []), "rest", "recovery", "missed", "pending"];
  const counts = days.reduce<Record<RunStatus, number>>((acc, d) => ({ ...acc, [d.status]: acc[d.status] + 1 }), { done: 0, short: 0, rest: 0, recovery: 0, missed: 0, pending: 0 });

  if (!weeks.length) return <p className="text-sm text-muted">No days to show.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <div className="inline-flex gap-2">
          <div className="flex flex-col pt-5 text-[10px] text-muted" style={{ gap }} aria-hidden>
            {rowLabels.map((l, k) => (
              <span key={l} className="flex items-center" style={{ height: cell, visibility: cell >= 30 || k % 2 === 0 ? "visible" : "hidden" }}>
                {cell >= 30 ? l : l.slice(0, 1)}
              </span>
            ))}
          </div>
          <div>
            <div className="relative h-5 text-[10px] text-muted" aria-hidden>
              {months.map((m) => (
                <span key={`${m.index}-${m.label}`} className="absolute top-0 whitespace-nowrap" style={{ left: m.index * (cell + gap) }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div role="group" aria-label="Running calendar, one column per week" className="flex" style={{ gap }}>
              {weeks.map((col, i) => (
                <div key={i} className="flex flex-col" style={{ gap }}>
                  {col.map((d, k) =>
                    d ? (
                      <div
                        key={d.date}
                        role="img"
                        aria-label={describe(d, unit)}
                        title={describe(d, unit)}
                        className={cx("flex items-center justify-center rounded-[4px] text-[10px] font-medium tabular", STATUS_META[d.status].cell, d.status === "done" || d.status === "missed" ? "text-white" : "text-fg-2")}
                        style={{ width: cell, height: cell, background: STATUS_META[d.status].fill }}
                      >
                        {cell >= 30 ? Number(d.date.slice(8)) : null}
                      </div>
                    ) : (
                      <div key={`e-${i}-${k}`} aria-hidden style={{ width: cell, height: cell }} />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-2" aria-label="Legend">
        {statuses.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className={cx("size-3 rounded-[3px]", STATUS_META[s].cell)} style={{ background: STATUS_META[s].fill }} aria-hidden />
            {STATUS_META[s].label}
            <span className="text-muted tabular">{counts[s]}</span>
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 text-muted">Blank = outside the range or before you started tracking</li>
      </ul>
    </div>
  );
}
