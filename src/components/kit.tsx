"use client";

/**
 * Shared building blocks for the unified tracker screens. Keep visual language
 * consistent: color carries identity/status, text carries the numbers.
 */
import { Flame, Info, Sparkles, Ruler, Eye } from "lucide-react";
import type { ReactNode } from "react";
import { RANGE_LABELS, type RangePreset } from "@/lib/time";
import { Badge, cx, Segmented } from "./ui";

export const DOMAIN_COLORS = {
  nutrition: "var(--series-cal)",
  body: "var(--series-1)",
  exercise: "var(--series-2)",
  training: "var(--series-2)",
  running: "var(--series-3)",
  health: "var(--series-1)",
  routine: "var(--series-cal)",
  routines: "var(--series-cal)",
  custom: "var(--text-2)",
  goals: "var(--accent)",
} as const;

export function PageHeader({ title, sub, actions, icon }: { title: string; sub?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
          {icon}
          {title}
        </h1>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Circular progress. `value` is a 0–1 ratio (values above 1 show a full ring). */
export function ProgressRing({ value, size = 56, stroke = 6, color = "var(--accent)", children, label }: { value: number | null; size?: number; stroke?: number; color?: string; children?: ReactNode; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} className="transition-[stroke-dashoffset] duration-500" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-fg tabular">{children}</div>
    </div>
  );
}

export type PeriodStatusName = "met" | "missed" | "in_progress" | "excused" | "paused" | "no_data" | "upcoming" | "not_reached";

const STATUS_STYLE: Record<PeriodStatusName, { label: string; cls: string }> = {
  met: { label: "Met", cls: "bg-good text-white" },
  missed: { label: "Missed", cls: "bg-critical/80 text-white" },
  in_progress: { label: "In progress", cls: "bg-accent-soft text-accent border border-accent/40" },
  excused: { label: "Rest day", cls: "bg-surface-3 text-fg-2" },
  paused: { label: "Paused", cls: "bg-surface-3 text-muted" },
  no_data: { label: "No data", cls: "border border-dashed border-line-strong text-muted" },
  upcoming: { label: "Upcoming", cls: "border border-line text-muted" },
  not_reached: { label: "Not reached yet", cls: "bg-surface-3 text-fg-2" },
};

export function statusLabel(s: PeriodStatusName): string {
  return STATUS_STYLE[s].label;
}

export function StatusPill({ status, className }: { status: PeriodStatusName; className?: string }) {
  const st = STATUS_STYLE[status];
  return <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", st.cls, className)}>{st.label}</span>;
}

/** A row of small squares, one per period, oldest first. */
export function PeriodStrip({ periods, title }: { periods: { start: string; end: string; status: PeriodStatusName; value?: number | null }[]; title?: (p: { start: string; end: string; status: PeriodStatusName; value?: number | null }) => string }) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label="History">
      {periods.map((p) => (
        <li key={p.start} title={title ? title(p) : `${p.start}${p.end !== p.start ? ` – ${p.end}` : ""}: ${statusLabel(p.status)}`} className={cx("size-3.5 rounded-[3px]", STATUS_STYLE[p.status].cls.replace(/text-\S+/g, ""))}>
          <span className="sr-only">
            {p.start}: {statusLabel(p.status)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StreakBadge({ count, unit, best }: { count: number; unit: string; best?: number }) {
  const singular = unit.replace(/s$/, "");
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-fg-2" title={best != null ? `Best: ${best} ${best === 1 ? singular : unit}` : undefined}>
      <Flame className={cx("size-3.5", count > 0 ? "text-[var(--serious)]" : "text-muted")} aria-hidden />
      {count} {count === 1 ? singular : unit}
    </span>
  );
}

/** Labels for data provenance, so measured data is never confused with estimates. */
export function KindBadge({ kind }: { kind: "measured" | "estimate" | "observation" | "ai" }) {
  if (kind === "measured")
    return (
      <Badge tone="good" title="Counts and averages of what you logged or synced">
        <Ruler className="size-3" aria-hidden /> Measured
      </Badge>
    );
  if (kind === "estimate")
    return (
      <Badge tone="warning" title="Derived from a model (e.g. estimated 1RM, energy balance) — approximate">
        <Info className="size-3" aria-hidden /> Estimate
      </Badge>
    );
  if (kind === "observation")
    return (
      <Badge tone="outline" title="A pattern in your data — an association, not proof of cause">
        <Eye className="size-3" aria-hidden /> Pattern
      </Badge>
    );
  return (
    <Badge tone="accent" title="Written by the AI assistant">
      <Sparkles className="size-3" aria-hidden /> AI
    </Badge>
  );
}

export const ANALYTICS_RANGES: RangePreset[] = ["7d", "30d", "90d", "6m", "1y", "all"];

export function RangeTabs({ value, onChange, options = ANALYTICS_RANGES }: { value: RangePreset; onChange: (r: RangePreset) => void; options?: RangePreset[] }) {
  return <Segmented label="Time period" size="sm" value={value} onChange={onChange} options={options.map((r) => ({ value: r, label: r === "all" ? "All" : r.toUpperCase() }))} />;
}

export function rangeTitle(r: RangePreset): string {
  return RANGE_LABELS[r];
}

/** "Synced 2h ago from Apple Health (iOS Shortcut)" */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function SourceLine({ label, syncedAt, origin }: { label: string; syncedAt?: string | null; origin?: string | null }) {
  return (
    <p className="text-[11px] text-muted">
      {label}
      {origin ? ` · ${origin}` : ""}
      {syncedAt ? ` · synced ${timeAgo(syncedAt)}` : ""}
    </p>
  );
}

/** Small numeric stepper input for fast logging. */
export function NumberStepper({ value, onChange, step = 1, min = 0, max = 100000, label, suffix, decimals = 0 }: { value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; label: string; suffix?: string; decimals?: number }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Number(v.toFixed(decimals)))));
  return (
    <div className="inline-flex items-center rounded-lg border border-line-strong bg-surface">
      <button type="button" aria-label={`Decrease ${label}`} className="h-10 w-9 text-lg text-fg-2 hover:bg-surface-2 rounded-l-lg" onClick={() => set((value ?? 0) - step)}>
        −
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        className="h-10 w-16 border-x border-line bg-transparent text-center text-sm text-fg tabular focus:outline-none"
        value={value ?? ""}
        onChange={(e) => {
          const t = e.target.value.replace(",", ".");
          if (t.trim() === "") return onChange(null);
          const n = Number(t);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {suffix && <span className="px-2 text-xs text-muted">{suffix}</span>}
      <button type="button" aria-label={`Increase ${label}`} className="h-10 w-9 text-lg text-fg-2 hover:bg-surface-2 rounded-r-lg" onClick={() => set((value ?? 0) + step)}>
        +
      </button>
    </div>
  );
}
