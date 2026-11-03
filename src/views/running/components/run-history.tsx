"use client";

import { BedDouble, Footprints, HeartPulse, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, IconButton } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import { fmtDistance, fmtNum } from "@/lib/client/units";
import type { DistanceUnit } from "@/lib/running/stats";
import { formatLocalDate } from "@/lib/time";
import { effortText, RUN_COLOR, type RunEntryJ } from "./run-meta";

function kindLabel(e: RunEntryJ): string {
  return e.kind === "run" ? "run" : e.kind === "rest" ? "rest day" : "recovery day";
}

export function RunEntryRow({ entry, unit, onEdit, onDelete, showDate = true }: { entry: RunEntryJ; unit: DistanceUnit; onEdit: (e: RunEntryJ) => void; onDelete: (e: RunEntryJ) => void; showDate?: boolean }) {
  const e = entry;
  const dateText = formatLocalDate(e.localDate);
  const Icon = e.kind === "run" ? Footprints : e.kind === "rest" ? BedDouble : HeartPulse;
  const entered = e.kind === "run" && e.inputDistance != null && e.inputUnit && e.inputUnit !== unit ? `entered as ${fmtNum(e.inputDistance, 2)} ${e.inputUnit}` : null;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2" style={e.kind === "run" ? { color: RUN_COLOR } : undefined} aria-hidden>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {showDate && <span className="text-sm font-medium text-fg">{dateText}</span>}
          {e.kind === "run" ? (
            <span className="text-sm text-fg tabular">{e.distanceM != null ? fmtDistance(e.distanceM, unit, 2) : <span className="text-muted">No distance</span>}</span>
          ) : (
            <Badge tone={e.kind === "rest" ? "neutral" : "accent"}>{e.kind === "rest" ? "Rest day" : "Recovery day"}</Badge>
          )}
          {e.runType && <Badge tone="outline">{e.runType}</Badge>}
        </div>
        {(e.effort != null || entered) && <p className="text-xs text-fg-2">{[effortText(e.effort), entered].filter(Boolean).join(" · ")}</p>}
        {e.notes && <p className="mt-0.5 text-xs whitespace-pre-line text-muted">{e.notes}</p>}
      </div>
      <div className="flex shrink-0">
        <IconButton label={`Edit ${kindLabel(e)} on ${dateText}`} onClick={() => onEdit(e)} className="size-10">
          <Pencil className="size-4" />
        </IconButton>
        <IconButton label={`Delete ${kindLabel(e)} on ${dateText}`} onClick={() => onDelete(e)} className="size-10">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

export function useDeleteRunEntry() {
  const toast = useToast();
  const invalidate = useInvalidateData();
  return async (e: RunEntryJ) => {
    const what = e.kind === "run" ? `the run on ${formatLocalDate(e.localDate)}` : `the ${kindLabel(e)} marker on ${formatLocalDate(e.localDate)}`;
    if (!window.confirm(`Delete ${what}?`)) return;
    try {
      await api.del(`/api/runs/${e.id}`);
      await invalidate();
      toast.success(e.kind === "run" ? "Run deleted" : "Day off cleared");
    } catch (err) {
      toast.error(err);
    }
  };
}

export function RunHistory({ entries, unit, rangeLabel, onEdit }: { entries: RunEntryJ[]; unit: DistanceUnit; rangeLabel: string; onEdit: (e: RunEntryJ) => void }) {
  const [showAll, setShowAll] = useState(false);
  const remove = useDeleteRunEntry();
  const visible = showAll ? entries : entries.slice(0, 15);
  const runs = entries.filter((e) => e.kind === "run").length;
  return (
    <Card>
      <CardTitle sub={`${runs} run${runs === 1 ? "" : "s"} and ${entries.length - runs} day${entries.length - runs === 1 ? "" : "s"} off in ${rangeLabel}, newest first.`}>History</CardTitle>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">Nothing logged in this range.</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line">
            {visible.map((e) => (
              <RunEntryRow key={e.id} entry={e} unit={unit} onEdit={onEdit} onDelete={remove} />
            ))}
          </ul>
          {entries.length > visible.length && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(true)}>
              Show all {entries.length} entries
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
