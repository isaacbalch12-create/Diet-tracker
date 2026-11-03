"use client";

import { ChevronRight, Trophy } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import type { WorkoutSummaryJ } from "@/lib/client/types";
import { formatLocalDate } from "@/lib/time";
import type { Unit } from "@/lib/training/types";
import { formatVolume } from "@/lib/training/units";
import { plural, workoutHref } from "./format";

export function WorkoutRow({ w, unit }: { w: WorkoutSummaryJ; unit: Unit }) {
  return (
    <li>
      <Link href={workoutHref(w.id)} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
        <div className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-surface-2 py-1 leading-tight" aria-hidden>
          <span className="text-[10px] font-semibold text-muted uppercase">{formatLocalDate(w.localDate, { month: "short" })}</span>
          <span className="text-base font-semibold text-fg tabular">{formatLocalDate(w.localDate, { day: "numeric" })}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="truncate font-medium text-fg">{w.name}</span>
            <span className="sr-only">{formatLocalDate(w.localDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
            {w.status === "in_progress" && <Badge tone="accent">In progress</Badge>}
            {w.source === "liftlog" && (
              <Badge tone="outline" title="Imported from LiftLog">
                LiftLog
              </Badge>
            )}
          </p>
          <p className="truncate text-xs text-muted">{w.exerciseNames.length ? w.exerciseNames.join(", ") : "No exercises logged"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-2 tabular">
            <span>{plural(w.setCount, "set")}</span>
            <span>{plural(w.totalReps, "rep")}</span>
            <span>{formatVolume(w.volumeKg, unit)}</span>
            {w.recordCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-warning-text">
                <Trophy className="size-3" aria-hidden /> {plural(w.recordCount, "record")}
              </span>
            )}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}
