"use client";

import { ArrowLeft, BookOpen, ExternalLink, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader, StreakBadge } from "@/components/kit";
import { Button, Card, cx, EmptyState, ErrorBanner, Input, Segmented, Skeleton, Stat } from "@/components/ui";
import { useJournal, useRoutine, useSettings } from "@/lib/client/hooks";
import type { JournalEntryJ } from "@/lib/client/types";
import { addDays, addMonths, diffDays, formatLocalDate, isLocalDate } from "@/lib/time";
import { hasJournalContent, JournalEditor } from "./components/journal-editor";
import { SLOT_META, SlotBadge, slotForNow, type JournalPrompt, type Slot } from "./components/shared";

type SlotFilter = "all" | Slot;

interface Selection {
  /** null = today */
  date: string | null;
  /** null = pick automatically */
  slot: Slot | null;
  /** When choosing the slot automatically, prefer one that already has an entry that day. */
  preferExisting: boolean;
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Newest first; on the same day the night entry was written after the morning one. */
const byNewest = (a: JournalEntryJ, b: JournalEntryJ) => (a.localDate === b.localDate ? (a.slot === b.slot ? 0 : a.slot === "night" ? -1 : 1) : a.localDate < b.localDate ? 1 : -1);

function preview(e: JournalEntryJ): string {
  const line = e.body.split("\n").find((l) => l.trim()) ?? e.answers.find((a) => a.answer.trim())?.answer.split("\n").find((l) => l.trim()) ?? "";
  return line.trim();
}

function matches(e: JournalEntryJ, q: string): boolean {
  const n = q.toLowerCase();
  return e.body.toLowerCase().includes(n) || e.answers.some((a) => a.answer.toLowerCase().includes(n) || a.prompt.toLowerCase().includes(n));
}

// ---------------------------------------------------------------------------

function Consistency({ today }: { today: string }) {
  const q = useJournal(`start=${addDays(today, -119)}&end=${today}`);
  if (q.error) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-28" />;
  const entries = q.data.filter(hasJournalContent);
  const dates = new Set(entries.map((e) => e.localDate));
  const from30 = addDays(today, -29);
  const last30 = entries.filter((e) => e.localDate >= from30);
  const days30 = new Set(last30.map((e) => e.localDate)).size;
  // Current streak: consecutive days with an entry, ending today (or yesterday while today is still open).
  let streak = 0;
  for (let d = dates.has(today) ? today : addDays(today, -1); dates.has(d); d = addDays(d, -1)) streak += 1;
  let longest = 0;
  let run = 0;
  for (let d = addDays(today, -119); d <= today; d = addDays(d, 1)) {
    run = dates.has(d) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const strip = Array.from({ length: 30 }, (_, i) => addDays(from30, i));
  return (
    <Card>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        <Stat label="Days journaled" value={`${days30} / 30`} sub="Last 30 days" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">Current streak</p>
          <p className="mt-0.5 text-xl font-semibold text-fg tabular">
            {streak} <span className="text-sm font-normal text-fg-2">day{streak === 1 ? "" : "s"}</span>
          </p>
          <div className="mt-0.5">
            <StreakBadge count={longest} unit="days" best={longest} /> <span className="text-xs text-muted">longest (120 days)</span>
          </div>
        </div>
        <Stat label="Morning entries" value={last30.filter((e) => e.slot === "morning").length} sub="Last 30 days" />
        <Stat label="Night entries" value={last30.filter((e) => e.slot === "night").length} sub="Last 30 days" />
      </div>
      <ul className="mt-4 flex flex-wrap gap-1 border-t border-line pt-3" aria-label="Journaling, last 30 days">
        {strip.map((d) => {
          const has = dates.has(d);
          const text = `${formatLocalDate(d)}: ${has ? "journaled" : "no entry"}`;
          return (
            <li key={d} title={text} className={cx("size-4 rounded-[4px]", has ? "bg-accent" : d === today ? "border-2 border-accent/60" : "border border-dashed border-line-strong")}>
              <span className="sr-only">{text}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function EntryPane({ date, slot, today, onChange, onBack }: { date: string; slot: Slot; today: string; onChange: (date: string, slot: Slot) => void; onBack: () => void }) {
  const rq = useRoutine(slot, date);
  const [resetKey, setResetKey] = useState(0);
  const ready = rq.data && rq.data.date === date && rq.data.slot === slot ? rq.data : null;
  const journalActs = ready?.activities.filter((a) => a.kind === "journal") ?? [];
  const prompts: JournalPrompt[] = [];
  for (const a of journalActs) for (const p of a.config.prompts ?? []) if (!prompts.some((x) => x.id === p.id)) prompts.push(p);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onBack} className="-ml-1 inline-flex min-h-10 items-center gap-1 self-start rounded-lg px-1 text-sm font-medium text-accent md:hidden">
          <ArrowLeft className="size-4" aria-hidden /> All entries
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-fg">{date === today ? "Today" : formatLocalDate(date, { weekday: "long", month: "long", day: "numeric", year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" })}</h2>
          <Link href={`/routines/${slot}${date === today ? "" : `?date=${date}`}`} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-accent">
            {SLOT_META[slot].label} <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="Entry date" value={date} max={today} onChange={(e) => e.target.value && isLocalDate(e.target.value) && e.target.value <= today && onChange(e.target.value, slot)} className="w-auto" />
          <Segmented
            label="Routine"
            value={slot}
            onChange={(s) => onChange(date, s)}
            options={(["morning", "night"] as const).map((s) => ({ value: s, label: SLOT_META[s].short }))}
          />
        </div>
      </div>
      {rq.error ? (
        <ErrorBanner error={rq.error} onRetry={() => rq.refetch()} />
      ) : !ready ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <>
          {journalActs.length === 0 && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-2">The {SLOT_META[slot].label.toLowerCase()} had no journaling activity on this day, so there are no prompts — free writing still saves.</p>}
          <JournalEditor
            key={`${date}-${slot}-${resetKey}`}
            date={date}
            slot={slot}
            entry={ready.journal}
            prompts={prompts}
            journalActivityIds={journalActs.filter((a) => a.log?.completed).map((a) => a.id)}
            allowDelete
            onDeleted={() => setResetKey((k) => k + 1)}
          />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function JournalView({ date, new: isNew }: { date: string | null; new: string | null }) {
  const router = useRouter();
  const settingsQ = useSettings();
  const today = settingsQ.data?.today ?? null;
  const tz = settingsQ.data?.settings.timezone;
  const [sel, setSel] = useState<Selection | null>(() => {
    const slot = isNew === "morning" || isNew === "night" ? isNew : null;
    if (date && isLocalDate(date)) return { date, slot, preferExisting: true };
    if (isNew) return { date: null, slot, preferExisting: false };
    return null;
  });
  const [slotFilter, setSlotFilter] = useState<SlotFilter>("all");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const q = useDebouncedValue(search.trim(), 300);

  const base = new URLSearchParams();
  if (slotFilter !== "all") base.set("slot", slotFilter);
  if (/^\d{4}-\d{2}$/.test(month)) {
    base.set("start", `${month}-01`);
    base.set("end", addDays(addMonths(`${month}-01`, 1), -1));
  }
  const baseQs = base.toString();
  // The server searches the free writing only; prompt answers are matched here on the loaded entries.
  const listQ = useJournal(baseQs);
  const searchQ = useJournal(q ? `${baseQs}${baseQs ? "&" : ""}q=${encodeURIComponent(q)}` : baseQs);

  const listed = (() => {
    if (!listQ.data) return null;
    if (!q) return listQ.data.filter(hasJournalContent).sort(byNewest);
    const byId = new Map<string, JournalEntryJ>();
    for (const e of searchQ.data ?? []) byId.set(e.id, e);
    for (const e of listQ.data) if (matches(e, q)) byId.set(e.id, e);
    return [...byId.values()].filter(hasJournalContent).sort(byNewest);
  })();

  const selDate = sel ? (sel.date ?? today) : null;
  const known = listQ.data ?? [];
  const existing = selDate ? known.filter((e) => e.localDate === selDate && hasJournalContent(e)).sort(byNewest) : [];
  const selSlot: Slot | null = sel ? (sel.slot ?? (sel.preferExisting && existing.length ? existing[0].slot : slotForNow(tz))) : null;
  const resolving = !!sel && !sel.slot && sel.preferExisting && !listQ.data;

  const select = (d: string, slot: Slot) => {
    setSel({ date: d, slot, preferExisting: false });
    router.replace(`/journal?date=${d}`, { scroll: false });
  };
  const newEntry = () => {
    if (!today) return;
    select(today, slotForNow(tz));
  };
  const back = () => {
    setSel(null);
    router.replace("/journal", { scroll: false });
  };

  const filtersActive = slotFilter !== "all" || !!q || !!month;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={<BookOpen className="size-5 text-fg-2" aria-hidden />}
        title="Journal"
        sub="Morning and nightly entries: your prompts plus free writing."
        actions={
          <Button onClick={newEntry} disabled={!today}>
            <Plus className="size-4" aria-hidden /> New entry
          </Button>
        }
      />

      {today ? <Consistency today={today} /> : <Skeleton className="h-28" />}

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* Entry list */}
        <section aria-label="Entries" className={cx("flex-col gap-3", sel ? "hidden md:flex" : "flex")}>
          <div className="flex flex-col gap-2">
            <Segmented
              label="Filter by routine"
              value={slotFilter}
              onChange={setSlotFilter}
              options={[
                { value: "all", label: "All" },
                { value: "morning", label: "Morning" },
                { value: "night", label: "Night" },
              ]}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input type="search" aria-label="Search entries" placeholder="Search entries" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="flex items-center gap-2">
              <Input type="month" aria-label="Month" value={month} max={today?.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} className="flex-1" />
              {month && (
                <Button variant="ghost" size="sm" className="h-10" onClick={() => setMonth("")}>
                  <X className="size-4" aria-hidden /> All months
                </Button>
              )}
            </div>
          </div>

          {listQ.error && <ErrorBanner error={listQ.error} onRetry={() => listQ.refetch()} />}
          {!listed ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : listed.length === 0 ? (
            filtersActive ? (
              <EmptyState title="No matching entries">Try a different search, routine or month.</EmptyState>
            ) : (
              <EmptyState
                icon={<BookOpen className="size-8" />}
                title="No journal entries yet"
                action={
                  <Button onClick={newEntry} disabled={!today}>
                    <Plus className="size-4" aria-hidden /> Write today&apos;s entry
                  </Button>
                }
              >
                Entries you write here or in your morning and nightly routines show up in this list.
              </EmptyState>
            )
          ) : (
            <ul className={cx("flex flex-col gap-1.5", (listQ.isPlaceholderData || (!!q && searchQ.isFetching)) && "opacity-70 transition-opacity")}>
              {listed.map((e, i) => {
                const active = selDate === e.localDate && selSlot === e.slot;
                const newMonth = i === 0 || listed[i - 1].localDate.slice(0, 7) !== e.localDate.slice(0, 7);
                const text = preview(e);
                return (
                  <li key={e.id}>
                    {newMonth && <p className="mt-2 mb-1 px-1 text-xs font-semibold tracking-wide text-muted uppercase first:mt-0">{formatLocalDate(e.localDate, { month: "long", year: "numeric" })}</p>}
                    <button
                      type="button"
                      onClick={() => select(e.localDate, e.slot)}
                      aria-current={active ? "true" : undefined}
                      className={cx("w-full rounded-xl border px-3 py-2.5 text-left transition-colors", active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-2")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-fg">
                          {today && e.localDate === today ? "Today" : today && diffDays(e.localDate, today) === 1 ? "Yesterday" : formatLocalDate(e.localDate, { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                        <SlotBadge slot={e.slot} />
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm break-words text-fg-2">{text || <span className="text-muted">(empty)</span>}</span>
                    </button>
                  </li>
                );
              })}
              {listQ.data && listQ.data.length >= 200 && <li className="px-1 pt-1 text-xs text-muted">Showing the latest 200 entries — pick a month to see older ones.</li>}
            </ul>
          )}
        </section>

        {/* Editor */}
        <section aria-label="Entry" className={cx("min-w-0 flex-col", sel ? "flex" : "hidden md:flex")}>
          {sel && selDate && selSlot && today && !resolving ? (
            <EntryPane date={selDate} slot={selSlot} today={today} onChange={select} onBack={back} />
          ) : sel ? (
            <Skeleton className="h-96" />
          ) : (
            <EmptyState
              icon={<BookOpen className="size-8" />}
              title="Pick an entry to read or edit"
              action={
                <Button onClick={newEntry} disabled={!today}>
                  <Plus className="size-4" aria-hidden /> New entry
                </Button>
              }
            >
              Or start a new one — it opens today&apos;s {SLOT_META[slotForNow(tz)].short.toLowerCase()} entry.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}
