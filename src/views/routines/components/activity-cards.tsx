"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck, ChevronDown, NotebookPen, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { NumberStepper } from "@/components/kit";
import { Badge, Button, Card, cx, Input } from "@/components/ui";
import type { JournalEntryJ, RoutineDayJ } from "@/lib/client/types";
import { JournalEditor } from "./journal-editor";
import {
  createAutosaver,
  fmtAmount,
  KIND_META,
  logPayload,
  manuallyCompleted,
  mobilityTarget,
  SaveIndicator,
  SmallTick,
  TickButton,
  useLogActivity,
  type ActivityJ,
  type SaveStatus,
  type Slot,
} from "./shared";

type LogMutation = ReturnType<typeof useLogActivity>;

interface CardProps {
  activity: ActivityJ;
  date: string;
  slot: Slot;
  queryKey: readonly unknown[];
  log: LogMutation;
  journal: JournalEntryJ | null;
  onEditRoutine: () => void;
}

function Shell({
  activity,
  summary,
  tick,
  children,
  collapsible,
  open,
  onToggleOpen,
}: {
  activity: ActivityJ;
  summary: ReactNode;
  tick: ReactNode;
  children?: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggleOpen?: () => void;
}) {
  const done = !!activity.log?.completed;
  const Icon = KIND_META[activity.kind].icon;
  const bodyId = `activity-body-${activity.id}`;
  // Collapsed bodies stay mounted (hidden) so in-progress writing and autosave survive a collapse.
  const hideBody = !!collapsible && !open;
  return (
    <Card className={cx("p-0 sm:p-0", done && "border-good/40")}>
      <div className="flex items-start gap-3 p-4">
        {tick}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className={cx("font-semibold text-fg", done && "text-fg-2")}>{activity.title}</h3>
            {activity.required ? null : <Badge tone="outline">Optional</Badge>}
            {done && <Badge tone="good">Done</Badge>}
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">{summary}</span>
          </p>
        </div>
        {collapsible && children && (
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? `Collapse ${activity.title}` : `Expand ${activity.title}`}
            className="-mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2"
          >
            <ChevronDown className={cx("size-5 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
        )}
      </div>
      {children ? (
        <div id={bodyId} hidden={hideBody} className="border-t border-line px-4 pt-3 pb-4">
          {activity.instructions && <p className="mb-3 text-sm whitespace-pre-line text-fg-2">{activity.instructions}</p>}
          {children}
        </div>
      ) : (
        activity.instructions && <p className="-mt-2 px-4 pb-4 pl-[4.5rem] text-sm whitespace-pre-line text-fg-2">{activity.instructions}</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function MobilityCard({ activity, date, log, onEditRoutine }: CardProps) {
  const done = !!activity.log?.completed;
  const [open, setOpen] = useState(!done);
  const items = activity.mobility?.items ?? [];
  const ticked = new Set(activity.log?.details.done ?? []);
  const tickedCount = items.filter((i) => ticked.has(i.id)).length;
  const allTicked = items.length > 0 && tickedCount === items.length;

  const toggleItem = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const all = items.every((i) => next.has(i.id));
    log.mutate(logPayload(activity, date, { completed: all || manuallyCompleted(activity), details: { done: items.map((i) => i.id).filter((i) => next.has(i)) } }));
  };
  const toggleActivity = () => {
    if (done) log.mutate(logPayload(activity, date, { completed: false, details: allTicked ? { done: [] } : {} }));
    else log.mutate(logPayload(activity, date, { completed: true }));
  };
  const markAll = () => log.mutate(logPayload(activity, date, { completed: true, details: { done: items.map((i) => i.id) } }));
  const reset = () => log.mutate(logPayload(activity, date, { completed: false, details: { done: [] } }));

  const summary = activity.mobility
    ? `${activity.mobility.name} · ${tickedCount} of ${items.length} done`
    : activity.config.mobilityRoutineId
      ? "Linked mobility routine was deleted"
      : "No mobility routine chosen";

  return (
    <Shell
      activity={activity}
      summary={summary}
      collapsible
      open={open}
      onToggleOpen={() => setOpen(!open)}
      tick={<TickButton checked={done} onToggle={toggleActivity} label={`${activity.title}: mark ${done ? "not done" : "done"}`} />}
    >
      {!activity.mobility ? (
        <div className="flex flex-col items-start gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-fg-2">
          <p>Choose which saved mobility routine this activity uses, or tick it off manually.</p>
          <Button variant="secondary" size="sm" onClick={onEditRoutine}>
            Choose a mobility routine
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">This mobility routine has no stretches yet. Add some in Edit routine → Mobility library.</p>
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-line">
            {items.map((it, idx) => {
              const on = ticked.has(it.id);
              const target = mobilityTarget(it);
              return (
                <li key={it.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <SmallTick checked={on} onToggle={() => toggleItem(it.id)} label={`${it.name}${target ? ` (${target})` : ""}`} />
                  <div className="min-w-0 flex-1 pt-1">
                    <p className={cx("text-sm font-medium text-fg", on && "text-muted line-through decoration-1")}>
                      <span className="mr-1.5 text-xs text-muted tabular">{idx + 1}.</span>
                      {it.name}
                    </p>
                    {target && <p className="text-sm text-fg-2 tabular">{target}</p>}
                    {it.instructions && <p className="mt-0.5 text-xs whitespace-pre-line text-muted">{it.instructions}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            {!allTicked && (
              <Button variant="secondary" size="sm" onClick={markAll}>
                <CheckCheck className="size-4" aria-hidden /> Mark all done
              </Button>
            )}
            {tickedCount > 0 && (
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="size-4" aria-hidden /> Reset
              </Button>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------

interface AmountDraft {
  value: number | null;
  title: string;
  note: string;
}

/** Reading (amount + what was read) and count (amount only) activities. Debounced autosave. */
function AmountCard({ activity, date, queryKey, log }: CardProps) {
  const qc = useQueryClient();
  const isReading = activity.kind === "reading";
  const unit = activity.targetUnit ?? (isReading ? "pages" : "");
  const target = activity.targetValue;
  const [value, setValue] = useState<number | null>(activity.log?.value ?? null);
  const [title, setTitle] = useState(activity.log?.details.title ?? "");
  const [note, setNote] = useState(activity.log?.details.note ?? "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const done = !!activity.log?.completed;
  const reached = target != null && value != null && value >= target;

  const [saver] = useState(() =>
    createAutosaver<AmountDraft>(
      async (d) => {
        // Use the freshest cached state so a manual tick made meanwhile is respected.
        const cur = qc.getQueryData<RoutineDayJ>(queryKey)?.activities.find((a) => a.id === activity.id) ?? activity;
        // With a target the server ticks it off once the amount reaches it; without one, any amount counts.
        const wasManual = target == null ? !!cur.log?.completed && !((cur.log?.value ?? 0) > 0) : manuallyCompleted(cur);
        await log.mutateAsync(
          logPayload(cur, date, {
            value: d.value,
            completed: wasManual || (target == null && (d.value ?? 0) > 0),
            details: isReading ? { title: d.title.trim() || null, note: d.note.trim() || null } : { note: d.note.trim() || null },
          }),
        );
      },
      (s) => setStatus(s),
      800,
    ),
  );
  useEffect(() => () => void saver.flush(), [saver]);

  const push = (next: Partial<AmountDraft>) => {
    const d = { value, title, note, ...next };
    saver.push(d);
  };

  const toggle = () => {
    if (done && reached) return;
    void saver.flush().then(() => {
      const cur = qc.getQueryData<RoutineDayJ>(queryKey)?.activities.find((a) => a.id === activity.id) ?? activity;
      log.mutate(logPayload(cur, date, { completed: !cur.log?.completed }));
    });
  };

  const summary = target != null ? (
    <span className="tabular">
      {fmtAmount(value ?? 0, null)} / {fmtAmount(target, unit)}
      {reached ? " · target reached" : ""}
    </span>
  ) : value != null ? (
    <span className="tabular">{fmtAmount(value, unit)} logged</span>
  ) : (
    "No target — logging any amount ticks it off"
  );

  return (
    <Shell
      activity={activity}
      summary={summary}
      tick={
        <TickButton
          checked={done}
          onToggle={toggle}
          disabled={done && reached}
          label={`${activity.title}: mark ${done ? "not done" : "done"}`}
          title={done && reached ? "Target reached — lower the amount to mark it not done" : undefined}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <NumberStepper
            value={value}
            onChange={(v) => {
              setValue(v);
              push({ value: v });
            }}
            label={isReading ? "Amount read" : `${activity.title} count`}
            suffix={unit || undefined}
            max={100_000}
            decimals={1}
          />
          {target != null && !reached && (
            <Button
              variant="secondary"
              size="sm"
              className="h-10"
              onClick={() => {
                setValue(target);
                push({ value: target });
              }}
            >
              Log {fmtAmount(target, unit)}
            </Button>
          )}
        </div>
        {isReading && (
          <Input aria-label="What did you read?" placeholder="What did you read? (book, article…)" value={title} maxLength={200} onChange={(e) => {
              setTitle(e.target.value);
              push({ title: e.target.value });
            }} onBlur={() => void saver.flush()} />
        )}
        <Input aria-label="Note" placeholder="Note (optional)" value={note} maxLength={1000} onChange={(e) => {
            setNote(e.target.value);
            push({ note: e.target.value });
          }} onBlur={() => void saver.flush()} />
        <div className="min-h-4">
          <SaveIndicator status={status} onRetry={() => void saver.flush()} />
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

function CheckCard({ activity, date, log }: CardProps) {
  const done = !!activity.log?.completed;
  return (
    <Shell
      activity={activity}
      summary={done ? "Done" : "Tap the circle when it's done"}
      tick={<TickButton checked={done} onToggle={() => log.mutate(logPayload(activity, date, { completed: !done }))} label={`${activity.title}: mark ${done ? "not done" : "done"}`} />}
    />
  );
}

// ---------------------------------------------------------------------------

function JournalCard({ activity, date, slot, log, journal }: CardProps) {
  const done = !!activity.log?.completed;
  const [open, setOpen] = useState(!done);
  const prompts = activity.config.prompts ?? [];
  const enabled = prompts.filter((p) => p.enabled).length;
  const hasEntry = !!journal && (journal.body.trim().length > 0 || journal.answers.length > 0);
  return (
    <Shell
      activity={activity}
      summary={hasEntry ? "Entry saved — keep writing anytime" : `${enabled} prompt${enabled === 1 ? "" : "s"} + free writing · saving an entry ticks this off`}
      collapsible
      open={open}
      onToggleOpen={() => setOpen(!open)}
      tick={<TickButton checked={done} onToggle={() => log.mutate(logPayload(activity, date, { completed: !done }))} label={`${activity.title}: mark ${done ? "not done" : "done"}`} />}
    >
      <JournalEditor key={`${date}-${slot}`} date={date} slot={slot} entry={journal} prompts={prompts} />
      <Link href={`/journal?date=${date}&new=${slot}`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        <NotebookPen className="size-4" aria-hidden /> Browse past entries
      </Link>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

export function ActivityCard(props: CardProps) {
  switch (props.activity.kind) {
    case "mobility":
      return <MobilityCard {...props} />;
    case "reading":
    case "count":
      return <AmountCard {...props} />;
    case "journal":
      return <JournalCard {...props} />;
    default:
      return <CheckCard {...props} />;
  }
}
