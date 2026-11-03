"use client";

import { Medal, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { KindBadge, PageHeader, RangeTabs, rangeTitle } from "@/components/kit";
import { Badge, Button, Card, CardTitle, cx, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { useRecords, useSettings } from "@/lib/client/hooks";
import type { RecordsJ } from "@/lib/client/types";
import type { RangePreset } from "@/lib/time";
import type { RecordType } from "@/lib/training/records";
import type { Unit } from "@/lib/training/types";
import { formatLift, formatVolume, WEIGHT_TOLERANCE_KG } from "@/lib/training/units";
import { dayLabelWithYear, exerciseHref, plural, RECORD_SHORT, RECORD_TYPES, recordDetail, recordValue, workoutHref } from "./components/format";

type EventJ = RecordsJ["events"][number];
type BestJ = RecordsJ["bests"][number];
type BestsJ = NonNullable<BestJ["allTime"]>;

const PAGE = 80;

export function RecordsView() {
  const settingsQ = useSettings();
  const unit: Unit = settingsQ.data?.settings.weightUnit ?? "lb";
  const [range, setRange] = useState<RangePreset>("all");
  const q = useRecords(`range=${range}`);
  const d = q.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Records" sub="Personal records are recalculated from your sets, so editing history always keeps them correct." actions={<RangeTabs value={range} onChange={setRange} />} />
      {q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} /> : null}
      {!d ? (
        q.error ? null : (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading records">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        )
      ) : d.bests.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-6" />}
          title="No records yet"
          action={
            <Link href="/training?start=1" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              Start a workout
            </Link>
          }
        >
          Your first session of each exercise sets the baseline. Beat it — heavier, more reps, more volume — and it shows up here.
        </EmptyState>
      ) : (
        <div className={cx("grid grid-cols-1 gap-4 xl:grid-cols-2", q.isFetching && "opacity-80")}>
          <Timeline events={d.events} unit={unit} range={range} />
          <Bests bests={d.bests} unit={unit} range={range} />
        </div>
      )}
    </div>
  );
}

function Timeline({ events, unit, range }: { events: EventJ[]; unit: Unit; range: RangePreset }) {
  const [types, setTypes] = useState<RecordType[]>([]);
  const [shown, setShown] = useState(PAGE);
  const counts = useMemo(() => {
    const m = new Map<RecordType, number>();
    for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [events]);
  const filtered = useMemo(() => (types.length ? events.filter((e) => types.includes(e.type)) : events), [events, types]);
  const groups = useMemo(() => {
    const map = new Map<string, EventJ[]>();
    for (const e of filtered.slice(0, shown)) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return [...map.entries()];
  }, [filtered, shown]);
  const toggle = (t: RecordType) => {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
    setShown(PAGE);
  };

  return (
    <Card className="min-w-0">
      <CardTitle sub={`${plural(events.length, "record")} · ${rangeTitle(range).toLowerCase()}`}>Timeline</CardTitle>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by record type">
        <Chip on={types.length === 0} onClick={() => setTypes([])}>
          All
        </Chip>
        {RECORD_TYPES.filter((t) => counts.has(t)).map((t) => (
          <Chip key={t} on={types.includes(t)} onClick={() => toggle(t)}>
            {RECORD_SHORT[t]} <span className="text-muted tabular">{counts.get(t)}</span>
          </Chip>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted">{events.length === 0 ? "No records in this period." : "No records of this type in this period."}</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {groups.map(([date, list]) => (
            <li key={date}>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{dayLabelWithYear(date)}</h3>
              <ul className="flex flex-col gap-1.5 border-l-2 border-line pl-3">
                {list.map((e) => (
                  <li key={e.key}>
                    <Link href={workoutHref(e.workoutId)} className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                      {e.type === "milestone" ? <Medal className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> : <Trophy className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-fg">{e.exerciseName ?? (e.type === "milestone" ? "Lifetime" : "Whole workout")}</span>
                          <Badge tone={e.type === "milestone" ? "accent" : e.type === "beatLast" ? "neutral" : "warning"}>{RECORD_SHORT[e.type]}</Badge>
                          {(e.type === "e1rm" || e.type === "beatLast") && <KindBadge kind="estimate" />}
                        </span>
                        <span className="block text-sm text-fg-2 tabular">{recordValue(e, unit)}</span>
                        <span className="block text-xs text-muted tabular">{[recordDetail(e, unit), e.workoutName].filter(Boolean).join(" · ")}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {filtered.length > shown && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setShown(shown + PAGE)}>
          Show more ({filtered.length - shown} older)
        </Button>
      )}
    </Card>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx("inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium", on ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-fg-2 hover:bg-surface-2")}
    >
      {children}
    </button>
  );
}

const sameWeight = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= WEIGHT_TOLERANCE_KG;
const sameVolume = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(WEIGHT_TOLERANCE_KG, b * 0.001);

function Cell({ label, all, inRange, isAllTime, showRange }: { label: ReactNode; all: ReactNode; inRange: ReactNode | null; isAllTime: boolean; showRange: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className="truncate text-sm font-semibold text-fg tabular">{all}</p>
      {showRange && (
        <p className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-fg-2 tabular">
          {inRange == null ? (
            <span className="text-muted">—</span>
          ) : (
            <>
              <span className="truncate">{inRange}</span>
              {isAllTime && (
                <Badge tone="warning" title="This period's best equals your all-time best" className="px-1 py-0">
                  <Trophy className="size-3" aria-hidden /> All-time
                </Badge>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Bests({ bests, unit, range }: { bests: BestJ[]; unit: Unit; range: RangePreset }) {
  const showRange = range !== "all";
  const [onlyTrained, setOnlyTrained] = useState(true);
  const [shown, setShown] = useState(25);
  const list = useMemo(() => (showRange && onlyTrained ? bests.filter((b) => b.inRange) : bests), [bests, showRange, onlyTrained]);
  const date = (s: string | null) => (s ? dayLabelWithYear(s) : "");
  const e1 = (b: BestsJ) => (b.bestE1rmKg == null ? "—" : formatLift(b.bestE1rmKg, unit));
  return (
    <Card className="min-w-0">
      <CardTitle
        sub={showRange ? `All-time best on top; this period (${rangeTitle(range).toLowerCase()}) below.` : "All-time bests per exercise, most-trained first."}
        action={
          showRange ? (
            <Chip on={onlyTrained} onClick={() => setOnlyTrained(!onlyTrained)}>
              Trained in period
            </Chip>
          ) : undefined
        }
      >
        Personal bests
      </CardTitle>
      {list.length === 0 ? (
        <p className="text-sm text-muted">No exercises trained in this period.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.slice(0, shown).map((b) => {
            const a = b.allTime;
            const r = b.inRange;
            if (!a) return null;
            return (
              <li key={b.exerciseId} className="py-3 first:pt-0 last:pb-0">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <Link href={exerciseHref(b.exerciseId)} className="min-w-0 truncate font-medium text-fg hover:text-accent">
                    {b.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">{plural(b.sessions, "session")}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <Cell
                    label="Heaviest"
                    all={<span title={date(a.heaviestDate)}>{a.heaviestKg == null ? "—" : `${formatLift(a.heaviestKg, unit)}${a.heaviestReps ? ` × ${a.heaviestReps}` : ""}`}</span>}
                    inRange={r && r.heaviestKg != null ? `${formatLift(r.heaviestKg, unit)}${r.heaviestReps ? ` × ${r.heaviestReps}` : ""}` : null}
                    isAllTime={!!r && sameWeight(r.heaviestKg, a.heaviestKg)}
                    showRange={showRange}
                  />
                  <Cell
                    label={
                      <span className="inline-flex items-center gap-1">
                        Est. 1RM <span className="sr-only">(estimate)</span>
                      </span>
                    }
                    all={<span title={a.bestE1rmSet ? `From ${formatLift(a.bestE1rmSet.weightKg, unit)} × ${a.bestE1rmSet.reps} · ${date(a.bestE1rmDate)}` : undefined}>{e1(a)}</span>}
                    inRange={r && r.bestE1rmKg != null ? e1(r) : null}
                    isAllTime={!!r && sameWeight(r.bestE1rmKg, a.bestE1rmKg)}
                    showRange={showRange}
                  />
                  <Cell
                    label="Session volume"
                    all={a.bestSessionVolumeKg == null ? "—" : formatVolume(a.bestSessionVolumeKg, unit)}
                    inRange={r && r.bestSessionVolumeKg != null ? formatVolume(r.bestSessionVolumeKg, unit) : null}
                    isAllTime={!!r && sameVolume(r.bestSessionVolumeKg, a.bestSessionVolumeKg)}
                    showRange={showRange}
                  />
                  <Cell
                    label="Most reps"
                    all={a.mostReps ? `${a.mostReps.reps} @ ${formatLift(a.mostReps.weightKg, unit)}` : "—"}
                    inRange={r?.mostReps ? `${r.mostReps.reps} @ ${formatLift(r.mostReps.weightKg, unit)}` : null}
                    isAllTime={!!r?.mostReps && !!a.mostReps && r.mostReps.reps === a.mostReps.reps}
                    showRange={showRange}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setShown(shown + 50)}>
          Show {Math.min(50, list.length - shown)} more
        </Button>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
        <KindBadge kind="estimate" /> Estimated 1RM is calculated from your best set within your rep cap — not a tested max.
      </p>
    </Card>
  );
}
