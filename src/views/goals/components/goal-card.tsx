"use client";

import { Archive, ArrowDown, ArrowUp, Check, CheckCircle2, Eye, EyeOff, Link2, Pause, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { KindBadge, PeriodStrip, ProgressRing, StatusPill, StreakBadge } from "@/components/kit";
import { Badge, cx } from "@/components/ui";
import type { GoalJ2 } from "@/lib/client/types";
import type { UnitPrefs } from "@/lib/client/units";
import { CATEGORY_META, fmtPeriodValue, fmtTarget, fmtValue, GOAL_STATUS_LABELS, isBinary, linkedSectionLabel, onTrackText, periodLabel, rangeLabel, scheduleLabel, shortDay, successText, valueUnit, type GoalPeriodJ } from "./labels";
import { Menu, MenuItem, MenuSeparator } from "./menu";
import type { GoalActions } from "./use-goal-actions";

/** 0–1+ ratio for rings and meters (±10% targets measure against the centre). */
export function displayRatio(g: GoalJ2): number | null {
  const c = g.current;
  if (!c || c.value == null) return null;
  if (ringIsCheck(g)) return c.meetsNow || (isBinary(g) && c.value >= 1) ? 1 : 0;
  if (g.center != null && c.targetMax != null) {
    const center = (c.target + c.targetMax) / 2;
    return center > 0 ? c.value / center : null;
  }
  // Getting down to a level (e.g. body weight ≤ target): how close you are.
  if (g.aggregation === "level" && g.comparator === "at_most") return c.value <= c.target ? 1 : c.value > 0 ? c.target / c.value : null;
  return g.progress;
}

/** Yes/no goals and trend goals show a check instead of a percentage. */
export function ringIsCheck(g: GoalJ2): boolean {
  return isBinary(g) || g.aggregation === "rate";
}

/** At-most and range goals that are currently over the top. */
export function isOver(g: GoalJ2): boolean {
  const c = g.current;
  if (!c || c.value == null || g.aggregation === "level" || g.aggregation === "rate") return false;
  if (g.comparator === "at_most") return c.value > c.target + 1e-9;
  if (g.comparator === "range") return c.value > Math.max(c.target, c.targetMax ?? c.target) + 1e-9;
  return false;
}

export function ringColor(g: GoalJ2): string {
  return isOver(g) ? "var(--serious)" : CATEGORY_META[g.category].color;
}

export function periodTitle(g: GoalJ2, prefs: UnitPrefs) {
  return (p: { start: string; end: string; status: GoalPeriodJ["status"]; value?: number | null }) => {
    const full = g.recent.find((r) => r.start === p.start);
    const target = full ? ` (target ${fmtTarget(g, full.target, full.targetMax, prefs)})` : "";
    return `${rangeLabel(p)}: ${fmtPeriodValue(g, p.value ?? null, prefs)}${target} — ${statusText(p.status)}`;
  };
}

function statusText(s: GoalPeriodJ["status"]): string {
  return { met: "Met", missed: "Missed", in_progress: "In progress", excused: "Rest day", paused: "Paused", no_data: "No data", upcoming: "Upcoming", not_reached: "Not reached yet" }[s];
}

export function ProjectionLine({ goal, prefs }: { goal: GoalJ2; prefs: UnitPrefs }) {
  const c = goal.current;
  if (!c || c.projected == null || c.status !== "in_progress") return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-2">
      On pace for ~{fmtValue(c.projected, valueUnit(goal), prefs, goal.unitLabel)} {goal.period === "weekly" ? "this week" : goal.period === "monthly" ? "this month" : `by ${shortDay(c.end)}`}
      <KindBadge kind="estimate" />
    </p>
  );
}

/** Actions for one goal, shared by the card and the detail page. */
export function GoalMenu({
  goal,
  actions,
  onEdit,
  onDelete,
  onLinkedEdit,
  onMove,
  canUp,
  canDown,
}: {
  goal: GoalJ2;
  actions: GoalActions;
  onEdit: () => void;
  onDelete: () => void;
  onLinkedEdit?: () => void;
  onMove?: (dir: -1 | 1) => void;
  canUp?: boolean;
  canDown?: boolean;
}) {
  const g = goal;
  const busy = actions.busy === g.id;
  return (
    <Menu label={`Actions for ${g.title}`}>
      {(close) => {
        const pick = (fn: () => void) => () => {
          close();
          fn();
        };
        if (g.linked)
          return (
            <>
              {onLinkedEdit && (
                <MenuItem icon={<Pencil />} onSelect={pick(onLinkedEdit)}>
                  {linkedSectionLabel(g)}
                </MenuItem>
              )}
              <MenuItem icon={g.showOnDashboard ? <EyeOff /> : <Eye />} onSelect={pick(() => void actions.toggleDashboard(g))} disabled={busy}>
                {g.showOnDashboard ? "Hide from dashboard" : "Show on dashboard"}
              </MenuItem>
            </>
          );
        return (
          <>
            <MenuItem icon={<Pencil />} onSelect={pick(onEdit)}>
              Edit
            </MenuItem>
            {g.status === "active" && (
              <MenuItem icon={<Pause />} onSelect={pick(() => void actions.setStatus(g, "paused"))} disabled={busy}>
                Pause
              </MenuItem>
            )}
            {g.status === "paused" && (
              <MenuItem icon={<Play />} onSelect={pick(() => void actions.setStatus(g, "active"))} disabled={busy}>
                Resume
              </MenuItem>
            )}
            {(g.status === "completed" || g.status === "archived") && (
              <MenuItem icon={<RotateCcw />} onSelect={pick(() => void actions.setStatus(g, "active"))} disabled={busy}>
                Restore to active
              </MenuItem>
            )}
            {g.status !== "completed" && (
              <MenuItem icon={<CheckCircle2 />} onSelect={pick(() => void actions.setStatus(g, "completed"))} disabled={busy}>
                Mark completed
              </MenuItem>
            )}
            {g.status !== "archived" && (
              <MenuItem icon={<Archive />} onSelect={pick(() => void actions.setStatus(g, "archived"))} disabled={busy}>
                Archive
              </MenuItem>
            )}
            <MenuItem icon={g.showOnDashboard ? <EyeOff /> : <Eye />} onSelect={pick(() => void actions.toggleDashboard(g))} disabled={busy}>
              {g.showOnDashboard ? "Hide from dashboard" : "Show on dashboard"}
            </MenuItem>
            {onMove && (canUp || canDown) && (
              <>
                <MenuSeparator />
                {canUp && (
                  <MenuItem icon={<ArrowUp />} onSelect={pick(() => onMove(-1))} disabled={busy}>
                    Move up
                  </MenuItem>
                )}
                {canDown && (
                  <MenuItem icon={<ArrowDown />} onSelect={pick(() => onMove(1))} disabled={busy}>
                    Move down
                  </MenuItem>
                )}
              </>
            )}
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={pick(onDelete)}>
              Delete…
            </MenuItem>
          </>
        );
      }}
    </Menu>
  );
}

export function GoalCard({
  goal,
  prefs,
  today,
  actions,
  onEdit,
  onDelete,
  onLinkedEdit,
  onMove,
  canUp,
  canDown,
}: {
  goal: GoalJ2;
  prefs: UnitPrefs;
  today: string;
  actions: GoalActions;
  onEdit: () => void;
  onDelete: () => void;
  onLinkedEdit: () => void;
  onMove: (dir: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const g = goal;
  const c = g.current;
  const meta = CATEGORY_META[g.category];
  const ratio = displayRatio(g);
  const binary = isBinary(g);
  const check = ringIsCheck(g);
  const Icon = meta.icon;
  const tracked = g.status === "active" || g.status === "paused" || !!c;
  const track = onTrackText(g);
  const busy = actions.busy === g.id;
  // "This week" already says "weekly"; custom periods also name their length.
  const sub = [g.subject, c ? periodLabel(g, c, today) : null, !c || g.period === "custom" ? scheduleLabel(g.period, g.periodDays) : null].filter((x, i, a) => x && a.indexOf(x) === i);
  const target = c ? fmtTarget(g, c.target, c.targetMax, prefs) : fmtTarget(g, g.targetValue, g.targetMax, prefs);

  return (
    <article className={cx("relative flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow)] transition-colors hover:border-line-strong", busy && "opacity-70")} aria-busy={busy}>
      <div className="flex items-start gap-3">
        <ProgressRing value={ratio} size={52} stroke={5} color={ringColor(g)} label={`${g.title}: ${ratio == null ? "no data yet" : check ? (ratio === 1 ? "on target" : "not on target yet") : `${Math.round(ratio * 100)}% of target`}`}>
          {check ? ratio === 1 ? <Check className="size-5 text-good" aria-hidden /> : <Icon className="size-4 text-muted" aria-hidden /> : ratio == null ? "—" : `${Math.min(999, Math.round(ratio * 100))}%`}
        </ProgressRing>
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="text-sm leading-snug font-semibold text-fg [overflow-wrap:anywhere]">
            <Link
              href={`/goals/${encodeURIComponent(g.id)}`}
              className="rounded-sm after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent/50"
            >
              {g.title}
            </Link>
          </h3>
          {sub.length > 0 && <p className="mt-0.5 truncate text-xs text-muted">{sub.join(" · ")}</p>}
        </div>
        <div className="relative z-10 -mt-1 -mr-2 shrink-0">
          <GoalMenu goal={g} actions={actions} onEdit={onEdit} onDelete={onDelete} onLinkedEdit={onLinkedEdit} onMove={onMove} canUp={canUp} canDown={canDown} />
        </div>
      </div>

      {tracked && c ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 text-fg">
              <span className="text-lg font-semibold tabular">{fmtPeriodValue(g, c.value, prefs, true)}</span>
              {!binary && <span className="ml-1.5 text-sm text-fg-2 tabular">/ {target}</span>}
            </p>
            <span className="flex items-center gap-1.5">
              {track && <span className={cx("text-xs", c.meetsNow ? "text-good-text" : "text-fg-2")}>{track}</span>}
              <StatusPill status={c.status} />
            </span>
          </div>
          <ProjectionLine goal={g} prefs={prefs} />
        </>
      ) : (
        <p className="text-sm text-fg-2">
          Target {target}
          <span className="text-muted">
            {g.status !== "active"
              ? ` · ${GOAL_STATUS_LABELS[g.status].toLowerCase()}, not tracking`
              : g.startDate > today
                ? ` · starts ${shortDay(g.startDate)}`
                : g.endDate && g.endDate < today
                  ? ` · ended ${shortDay(g.endDate)}`
                  : ""}
          </span>
        </p>
      )}

      {tracked && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-2">
          <StreakBadge count={g.streak.current} unit={g.streak.unit} best={g.streak.best} />
          <span>{successText(g)}</span>
          {g.successRate != null && <span className="text-muted">({Math.round(g.successRate * 100)}%)</span>}
        </div>
      )}

      {g.recent.length > 0 && <PeriodStrip periods={g.recent} title={periodTitle(g, prefs)} />}

      {(g.linked || g.status !== "active" || !g.showOnDashboard) && (
        <div className="flex flex-wrap gap-1.5">
          {g.linked && (
            <Badge tone="accent" title={g.linked === "nutrition" ? "From your daily nutrition targets" : "From your weight goals"}>
              <Link2 className="size-3" aria-hidden /> Linked
            </Badge>
          )}
          {g.status !== "active" && <Badge tone={g.status === "completed" ? "good" : "neutral"}>{GOAL_STATUS_LABELS[g.status]}</Badge>}
          {!g.showOnDashboard && (
            <Badge tone="outline" title="Not shown on the dashboard">
              <EyeOff className="size-3" aria-hidden /> Hidden
            </Badge>
          )}
        </div>
      )}
    </article>
  );
}
