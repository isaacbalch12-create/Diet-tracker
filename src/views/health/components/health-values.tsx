"use client";

import { PenLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { timeAgo } from "@/components/kit";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, IconButton, Segmented } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { VitalsJ } from "@/lib/client/types";
import { formatLocalDate } from "@/lib/time";
import { fmtMetric, hasValue, METRIC_KEYS, METRIC_LABEL, scoreProvider, type MetricKey, type ValueDay } from "./health-utils";

/** Every stored daily value with its source; manual values can be deleted here. */
export function ValuesLog({ vitals, onAdd }: { vitals: VitalsJ; onAdd: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const keys = METRIC_KEYS.filter((k) => (vitals.metrics[k]?.loggedDays ?? 0) > 0);
  const [picked, setPicked] = useState<MetricKey>("steps");
  const [showAll, setShowAll] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const k = keys.includes(picked) ? picked : keys[0];

  const remove = async (d: ValueDay) => {
    if (!window.confirm(`Delete the manually entered ${METRIC_LABEL[k].toLowerCase()} for ${formatLocalDate(d.date)}?`)) return;
    setDeleting(d.id);
    try {
      await api.del(`/api/vitals/${d.id}`);
      await invalidate();
      toast.success("Manual value deleted");
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(null);
    }
  };

  if (!k) return null;
  const rows = vitals.metrics[k].days.filter(hasValue).reverse();
  const visible = showAll ? rows : rows.slice(0, 10);
  return (
    <Card>
      <CardTitle
        sub="Where each day's value came from. When several sources report the same day, the most recently synced one is used and the others are listed — never added together."
        action={
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <PenLine className="size-4" /> Add
          </Button>
        }
      >
        Data log
      </CardTitle>
      {keys.length > 1 && (
        <div className="mb-3">
          <Segmented<MetricKey>
            label="Metric"
            size="sm"
            value={k}
            onChange={(v) => {
              setPicked(v);
              setShowAll(false);
            }}
            options={keys.map((x) => ({ value: x, label: METRIC_LABEL[x] }))}
          />
        </div>
      )}
      <ul className="flex flex-col divide-y divide-line">
        {visible.map((d) => (
          <li key={d.date} className="flex items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-fg">{formatLocalDate(d.date)}</span>
                <span className="text-fg tabular">{fmtMetric(k, d.value)}</span>
                {d.source === "manual" && <Badge tone="outline">Entered manually</Badge>}
              </p>
              <p className="text-[11px] text-muted">
                {k === "sleep_score" ? `Score by ${scoreProvider(d) ?? "unknown provider"} · ` : ""}
                {d.sourceLabel}
                {d.origin && k !== "sleep_score" ? ` · ${d.origin}` : ""} · {d.source === "manual" ? "saved" : "synced"} {timeAgo(d.syncedAt)}
              </p>
              {d.alternatives.length > 0 && <p className="text-[11px] text-muted">Also reported: {d.alternatives.map((a) => `${fmtMetric(k, a.value)} (${a.sourceLabel})`).join(", ")}</p>}
            </div>
            {d.source === "manual" && (
              <IconButton label={`Delete manual ${METRIC_LABEL[k].toLowerCase()} for ${d.date}`} className="size-10" disabled={deleting === d.id} onClick={() => remove(d)}>
                <Trash2 className="size-4" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {rows.length > visible.length && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(true)}>
          Show all {rows.length} days
        </Button>
      )}
    </Card>
  );
}
