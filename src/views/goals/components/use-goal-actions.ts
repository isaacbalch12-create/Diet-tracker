"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { GoalJ2, SettingsResponse } from "@/lib/client/types";
import type { GoalStatus } from "@/lib/db/schema";

export const goalUrl = (id: string) => `/api/user-goals/${encodeURIComponent(id)}`;

function statusMessage(from: GoalStatus, to: GoalStatus): string {
  if (to === "paused") return "Goal paused — days while it's paused won't count against it";
  if (to === "active") return from === "paused" ? "Goal resumed" : "Goal restored";
  if (to === "completed") return "Goal marked completed";
  return "Goal archived";
}

/** Mutations shared by the goals list and the goal detail page. */
export function useGoalActions(settings: SettingsResponse | undefined) {
  const invalidate = useInvalidateData();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, message?: string, allQueries = false): Promise<boolean> => {
    setBusy(key);
    try {
      await fn();
      await invalidate();
      if (allQueries) await qc.invalidateQueries();
      if (message) toast.success(message);
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    setStatus: (g: GoalJ2, status: GoalStatus) => run(g.id, () => api.patch(goalUrl(g.id), { status }), statusMessage(g.status, status)),
    toggleDashboard: (g: GoalJ2) => {
      if (g.linked) {
        if (!settings) return Promise.resolve(false);
        const dash = settings.settings.dashboard;
        const hidden = dash.hiddenGoalIds ?? [];
        const next = g.showOnDashboard ? [...new Set([...hidden, g.id])] : hidden.filter((x) => x !== g.id);
        return run(g.id, () => api.patch("/api/settings", { dashboard: { ...dash, hiddenGoalIds: next } }), g.showOnDashboard ? "Hidden from the dashboard" : "Shown on the dashboard", true);
      }
      return run(g.id, () => api.patch(goalUrl(g.id), { showOnDashboard: !g.showOnDashboard }), g.showOnDashboard ? "Hidden from the dashboard" : "Shown on the dashboard");
    },
    remove: (g: GoalJ2) => run(g.id, () => api.del(goalUrl(g.id)), "Goal deleted"),
    /** Swap a goal with its neighbour among `siblings` (the visible group), keeping every other goal's order. */
    move: (g: GoalJ2, dir: -1 | 1, all: GoalJ2[], siblings: GoalJ2[]) => {
      const i = siblings.findIndex((x) => x.id === g.id);
      const other = siblings[i + dir];
      if (i < 0 || !other || other.linked) return Promise.resolve(false);
      const ids = all
        .filter((x) => !x.linked)
        .map((x, idx) => ({ id: x.id, position: x.position, idx }))
        .sort((a, b) => a.position - b.position || a.idx - b.idx)
        .map((x) => x.id);
      const a = ids.indexOf(g.id);
      const b = ids.indexOf(other.id);
      if (a < 0 || b < 0) return Promise.resolve(false);
      [ids[a], ids[b]] = [ids[b], ids[a]];
      return run(g.id, () => api.post("/api/user-goals/reorder", { ids }));
    },
    checkin: (g: GoalJ2, localDate: string, value: number | null, note: string | null) =>
      run(`${g.id}:checkin`, () => api.post(`${goalUrl(g.id)}/checkin`, { localDate, value, note }), value == null ? "Check-in cleared" : "Checked in"),
  };
}

export type GoalActions = ReturnType<typeof useGoalActions>;
