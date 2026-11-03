"use client";

import { DOMAIN_COLORS } from "@/components/kit";
import { Meter } from "@/components/ui";
import type { TrainingAnalyticsJ } from "@/lib/client/types";
import type { Unit } from "@/lib/training/types";
import { formatVolume } from "@/lib/training/units";
import { fmtSets, titleCase } from "./format";

type Muscle = TrainingAnalyticsJ["muscles"][number];

/**
 * Hard sets per muscle group (1 per set for the primary muscle, ½ for each
 * secondary) with the share of total volume, which counts primary muscles only.
 */
export function MuscleBreakdown({ muscles, unit, limit, showVolume = true }: { muscles: Muscle[]; unit: Unit; limit?: number; showVolume?: boolean }) {
  const rows = limit ? muscles.slice(0, limit) : muscles;
  const maxSets = Math.max(1, ...muscles.map((m) => m.sets));
  const totalVolume = muscles.reduce((a, m) => a + m.volumeKg, 0);
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((m) => {
        const share = totalVolume > 0 ? m.volumeKg / totalVolume : 0;
        return (
          <li key={m.muscle} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium text-fg">{titleCase(m.muscle)}</span>
              <span className="shrink-0 text-xs text-fg-2 tabular">
                {fmtSets(m.sets)} sets · {m.setsPerWeek.toFixed(1)}/wk
                {showVolume && totalVolume > 0 && <span className="text-muted"> · {m.volumeKg > 0 ? `${Math.round(share * 100)}% of volume` : "secondary only"}</span>}
              </span>
            </div>
            <Meter value={m.sets} max={maxSets} color={DOMAIN_COLORS.training} label={`${titleCase(m.muscle)}: ${fmtSets(m.sets)} sets${showVolume ? `, ${formatVolume(m.volumeKg, unit)} volume` : ""}`} />
          </li>
        );
      })}
    </ul>
  );
}
