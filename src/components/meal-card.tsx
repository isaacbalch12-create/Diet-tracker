"use client";

import { Camera, ChevronRight, Copy, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, newRequestId } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { MealJ } from "@/lib/client/types";
import { fmtTime } from "@/lib/format";
import { MacroLine } from "./nutrition";
import { Badge, IconButton } from "./ui";
import { useToast } from "./toast";

/** One meal in the day timeline, with quick duplicate/delete. */
export function MealCard({ meal, showActions = true }: { meal: MealJ; showActions?: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [busy, setBusy] = useState(false);

  const duplicate = async () => {
    setBusy(true);
    try {
      await api.post(`/api/meals/${meal.id}/duplicate`, { eatenAt: new Date().toISOString(), clientRequestId: newRequestId() });
      await invalidate();
      toast.success(`Logged “${meal.title}” again for now`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete “${meal.title}”? This removes it from your totals and history.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/meals/${meal.id}`);
      await invalidate();
      toast.success("Meal deleted");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="group relative flex items-stretch gap-3 rounded-xl border border-line bg-surface p-3 hover:border-line-strong">
      <div className="flex w-16 shrink-0 flex-col items-start pt-0.5">
        <span className="text-xs font-medium whitespace-nowrap text-fg-2 tabular">{fmtTime(meal.eatenAt, meal.timezone)}</span>
      </div>
      {meal.images[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={meal.images[0].url} alt="" className="size-14 shrink-0 rounded-lg object-cover" loading="lazy" />
      )}
      <Link href={`/meals/${meal.id}`} className="min-w-0 flex-1 after:absolute after:inset-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium text-fg">{meal.title}</span>
          <Badge tone="outline">{meal.category}</Badge>
          {meal.source === "photo" && <Camera className="size-3.5 text-muted" aria-label="Logged from photo" />}
        </div>
        <MacroLine values={meal.totals.values} incomplete={meal.totals.incomplete} className="mt-1" />
        <p className="mt-1 truncate text-xs text-muted">{meal.items.map((i) => i.name).join(", ")}</p>
      </Link>
      {showActions ? (
        <div className="relative z-10 flex shrink-0 flex-col items-center justify-center gap-0.5 sm:flex-row">
          <IconButton label={`Log “${meal.title}” again now`} onClick={duplicate} disabled={busy}>
            <Copy className="size-4" />
          </IconButton>
          <IconButton label={`Delete “${meal.title}”`} onClick={remove} disabled={busy}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      ) : (
        <ChevronRight className="size-4 self-center text-muted" aria-hidden />
      )}
    </li>
  );
}
