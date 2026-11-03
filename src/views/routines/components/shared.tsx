"use client";

/**
 * Shared helpers for the routine and journal screens: JSON PUT (the shared
 * client has no PUT helper), slot/kind labels, formatting, the optimistic
 * routine-log mutation and a small serialized autosaver.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Hash, ListChecks, Moon, NotebookPen, PersonStanding, Sun, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError, newRequestId } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { RoutineDayJ } from "@/lib/client/types";
import type { JournalPrompt, MobilityItem, RoutineActivityKind, RoutineLogDetails, RoutineSlot } from "@/lib/db/schema";
import { localParts } from "@/lib/time";

export type Slot = RoutineSlot;
export type ActivityJ = RoutineDayJ["activities"][number];
export type LogJ = NonNullable<ActivityJ["log"]>;
export type { JournalPrompt, MobilityItem, RoutineActivityKind, RoutineLogDetails };

export const newId = newRequestId;

// ---------------------------------------------------------------------------
// HTTP

/** PUT with the same error handling as the shared `api` client. */
export async function putJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");
  }
  if (res.status === 401 && typeof window !== "undefined") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? "error", err?.details);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Labels

export const SLOT_META: Record<Slot, { label: string; short: string; icon: LucideIcon; iconClass: string; journalTitle: string }> = {
  morning: { label: "Morning routine", short: "Morning", icon: Sun, iconClass: "text-warning", journalTitle: "Morning journal" },
  night: { label: "Nightly routine", short: "Night", icon: Moon, iconClass: "text-accent", journalTitle: "Nightly reflection" },
};

export const otherSlot = (s: Slot): Slot => (s === "morning" ? "night" : "morning");

export const KIND_META: Record<RoutineActivityKind, { label: string; icon: LucideIcon; hint: string }> = {
  mobility: { label: "Stretching & mobility", icon: PersonStanding, hint: "Work through a saved list of stretches, ticking each one off." },
  reading: { label: "Reading", icon: BookOpen, hint: "Log how much you read (pages or any unit) and what it was." },
  journal: { label: "Journaling", icon: NotebookPen, hint: "Answer your prompts and write freely. Saving an entry ticks it off." },
  checklist: { label: "Simple check-off", icon: ListChecks, hint: "A single tick, e.g. “Make the bed” or “Take vitamins”." },
  count: { label: "Count toward a target", icon: Hash, hint: "A number vs. a target, e.g. 20 push-ups or 2 glasses of water." },
};

export const KINDS: RoutineActivityKind[] = ["mobility", "reading", "journal", "checklist", "count"];

export function SlotIcon({ slot, className }: { slot: Slot; className?: string }) {
  const Icon = SLOT_META[slot].icon;
  return <Icon className={cx("size-5", SLOT_META[slot].iconClass, className)} aria-hidden />;
}

export function SlotBadge({ slot }: { slot: Slot }) {
  const Icon = SLOT_META[slot].icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-fg-2">
      <Icon className={cx("size-3", SLOT_META[slot].iconClass)} aria-hidden />
      {SLOT_META[slot].short}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Formatting

export const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`);

export function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function fmtAmount(v: number | null | undefined, unit: string | null | undefined): string {
  return unit ? `${fmtNum(v)} ${unit}` : fmtNum(v);
}

/** "3 × 10 · per side · 5 slow breaths" */
export function mobilityTarget(i: Pick<MobilityItem, "sets" | "reps" | "perSide" | "targetNote">): string {
  const parts: string[] = [];
  if (i.sets && i.reps) parts.push(`${i.sets} × ${i.reps}`);
  else if (i.sets) parts.push(`${i.sets} set${i.sets === 1 ? "" : "s"}`);
  else if (i.reps) parts.push(`${i.reps} reps`);
  if (i.perSide) parts.push("per side");
  if (i.targetNote.trim()) parts.push(i.targetNote.trim());
  return parts.join(" · ");
}

/** Journal slot by time of day: before 3 PM is morning. */
export function slotForNow(timezone: string | undefined): Slot {
  let hour: number;
  try {
    hour = timezone ? localParts(new Date(), timezone).hour : new Date().getHours();
  } catch {
    hour = new Date().getHours();
  }
  return hour < 15 ? "morning" : "night";
}

/** Big, clearly-labelled tick button (≥44px touch target). */
export function TickButton({ checked, onToggle, label, disabled, title }: { checked: boolean; onToggle: () => void; label: string; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onToggle}
      className={cx(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed",
        checked ? "border-good bg-good text-white" : "border-line-strong bg-surface text-transparent hover:border-good hover:text-good/40",
        disabled && !checked && "opacity-50",
      )}
    >
      <Check className="size-5" strokeWidth={3} aria-hidden />
    </button>
  );
}

/** Small tick for list items (mobility stretches). */
export function SmallTick({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="-m-1 inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2"
    >
      <span className={cx("inline-flex size-6 items-center justify-center rounded-md border-2 transition-colors", checked ? "border-good bg-good text-white" : "border-line-strong text-transparent")}>
        <Check className="size-4" strokeWidth={3} aria-hidden />
      </span>
    </button>
  );
}

export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }): ReactNode {
  if (status === "idle") return null;
  if (status === "error")
    return (
      <span role="alert" className="text-xs text-critical">
        Couldn&apos;t save.{" "}
        {onRetry && (
          <button type="button" className="font-medium underline" onClick={onRetry}>
            Retry
          </button>
        )}
      </span>
    );
  return (
    <span role="status" aria-live="polite" className={cx("inline-flex items-center gap-1 text-xs", status === "saved" ? "text-good-text" : "text-muted")}>
      {status === "saved" && <Check className="size-3.5" aria-hidden />}
      {status === "pending" ? "Unsaved changes" : status === "saving" ? "Saving…" : "Saved"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Autosave (debounced, one request in flight at a time, latest value wins)

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface Autosaver<T> {
  push: (v: T) => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

export function createAutosaver<T>(save: (v: T) => Promise<void>, onStatus: (s: SaveStatus, err?: unknown) => void, delay = 900): Autosaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: { v: T } | null = null;
  let running = false;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const drain = async (): Promise<void> => {
    if (running || !queued) return;
    running = true;
    const { v } = queued;
    queued = null;
    onStatus("saving");
    try {
      await save(v);
      running = false;
      if (queued) return drain();
      onStatus("saved");
    } catch (err) {
      running = false;
      if (!queued) queued = { v };
      onStatus("error", err);
    }
  };
  return {
    push(v) {
      queued = { v };
      onStatus("pending");
      clear();
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, delay);
    },
    flush() {
      clear();
      return drain();
    },
    cancel() {
      clear();
      queued = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Routine logging (optimistic)

export interface LogInput {
  localDate: string;
  activityId: string;
  completed: boolean;
  value: number | null;
  details: RoutineLogDetails;
}

/** Full payload for an activity, merged with what's already logged (the server replaces the whole log). */
export function logPayload(a: ActivityJ, date: string, patch: Partial<Omit<LogInput, "localDate" | "activityId">>): LogInput {
  return {
    localDate: date,
    activityId: a.id,
    completed: patch.completed ?? a.log?.completed ?? false,
    value: patch.value !== undefined ? patch.value : (a.log?.value ?? null),
    details: { ...(a.log?.details ?? {}), ...(patch.details ?? {}) },
  };
}

/** Whether a stored completion came from a manual tick rather than reaching the target. */
export function manuallyCompleted(a: ActivityJ): boolean {
  if (!a.log?.completed) return false;
  if (a.kind === "mobility") {
    const ids = a.mobility?.items.map((i) => i.id) ?? [];
    const done = new Set(a.log.details.done ?? []);
    return !(ids.length > 0 && ids.every((id) => done.has(id)));
  }
  if (a.targetValue != null) return !(a.log.value != null && a.log.value >= a.targetValue);
  return true;
}

function applyLog(day: RoutineDayJ, input: LogInput): RoutineDayJ {
  const activities = day.activities.map((a) => {
    if (a.id !== input.activityId) return a;
    const completed = input.completed || (input.value != null && a.targetValue != null && input.value >= a.targetValue);
    const now = new Date().toISOString();
    const log: LogJ = {
      ...(a.log ?? { id: `optimistic-${a.id}`, localDate: input.localDate, activityId: a.id, slot: a.slot, createdAt: now }),
      completed,
      value: input.value,
      details: input.details,
      completedAt: completed ? (a.log?.completedAt ?? now) : null,
      updatedAt: now,
    } as LogJ;
    return { ...a, log };
  });
  const req = activities.filter((a) => a.required);
  const done = req.filter((a) => a.log?.completed).length;
  const optionalDone = activities.filter((a) => !a.required && a.log?.completed).length;
  return { ...day, activities, progress: { required: req.length, done, optionalDone, pct: req.length ? done / req.length : null, complete: req.length > 0 && done === req.length } };
}

const LOG_KEY = ["routine-log"];

/** POST /api/routines/log with an instant optimistic update of the routine day in `queryKey`. */
export function useLogActivity(queryKey: readonly unknown[]) {
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  const toast = useToast();
  return useMutation({
    mutationKey: LOG_KEY,
    mutationFn: (input: LogInput) => api.post<{ log: LogJ }>("/api/routines/log", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<RoutineDayJ>(queryKey);
      if (prev && prev.date === input.localDate) qc.setQueryData<RoutineDayJ>(queryKey, applyLog(prev, input));
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      toast.error(err);
    },
    onSettled: () => {
      // Refetch once the last rapid tick has landed, so a refetch never undoes a pending optimistic tick.
      if (qc.isMutating({ mutationKey: LOG_KEY }) <= 1) void invalidate();
    },
  });
}
