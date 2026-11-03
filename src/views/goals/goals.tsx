"use client";

import { Flame, Plus, Scale, Target, Trophy, UtensilsCrossed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/kit";
import { Button, Card, CardTitle, EmptyState, ErrorBanner, Segmented, Skeleton, Stat } from "@/components/ui";
import { useGoals, useSettings } from "@/lib/client/hooks";
import type { GoalJ2 } from "@/lib/client/types";
import { GoalCard } from "./components/goal-card";
import { GoalFormModal, PresetGrid, type GoalFormInit } from "./components/goal-form";
import { CATEGORY_META, CATEGORY_ORDER, plural, prefsOf, scrollToSection } from "./components/labels";
import { ConfirmDialog } from "./components/menu";
import { NutritionTargetsSection, WeightGoalsSection } from "./components/settings-sections";
import { useGoalActions } from "./components/use-goal-actions";

type Filter = "active" | "paused" | "completed" | "archived" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

const EMPTY_TEXT: Record<Filter, string> = {
  active: "Nothing active right now. Create a goal, or restore one from Paused, Completed or Archived.",
  paused: "Paused goals show up here. Pausing excuses those days from a goal's history.",
  completed: "Goals you mark completed show up here, with their history kept.",
  archived: "Archived goals are kept out of the way but keep their history.",
  all: "No goals yet.",
};

function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading goals">
      <Skeleton className="h-24" />
      <Skeleton className="h-8 w-72 max-w-full" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-52" />
        ))}
      </div>
    </div>
  );
}

function Summary({ goals }: { goals: GoalJ2[] }) {
  const active = goals.filter((g) => g.status === "active");
  const met = active.filter((g) => g.current?.status === "met").length;
  const onTrack = active.filter((g) => g.current?.status === "in_progress" && g.current.meetsNow).length;
  const tracked = active.filter((g) => g.current).length;
  const best = active.reduce<GoalJ2 | null>((b, g) => (g.streak.current > (b?.streak.current ?? 0) ? g : b), null);
  return (
    <Card>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Active goals" value={<span className="tabular">{active.length}</span>} sub={goals.length > active.length ? `${goals.length - active.length} not active` : "All tracking"} />
        <Stat
          label="Met this period"
          value={
            <span className="tabular">
              {met}
              <span className="text-base font-normal text-muted">/{tracked}</span>
            </span>
          }
          sub={onTrack ? `+${onTrack} on track` : "Today, this week or month"}
        />
        <Stat
          label="Best streak"
          value={
            best ? (
              <span className="inline-flex items-center gap-1 tabular">
                <Flame className="size-4 text-[var(--serious)]" aria-hidden />
                {plural(best.streak.current, best.streak.unit)}
              </span>
            ) : (
              "—"
            )
          }
          sub={best ? <span className="block truncate">{best.title}</span> : "Meet a goal to start one"}
        />
      </div>
    </Card>
  );
}

export function GoalsView({ new: isNew }: { new: string | null }) {
  const router = useRouter();
  const goalsQ = useGoals();
  const settingsQ = useSettings();
  const settings = settingsQ.data;
  const actions = useGoalActions(settings);
  const [filter, setFilter] = useState<Filter>("active");
  const [form, setForm] = useState<GoalFormInit | null>(isNew === "1" ? { mode: "create" } : null);
  const [toDelete, setToDelete] = useState<GoalJ2 | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Opening /goals?new=1 while already on the page (e.g. from a "New goal" link elsewhere).
  const [lastNew, setLastNew] = useState(isNew);
  if (isNew !== lastNew) {
    setLastNew(isNew);
    if (isNew === "1") setForm({ mode: "create" });
  }

  const ready = !!settings && !!goalsQ.data;
  // Deep links such as /goals#nutrition-targets: scroll once the content has rendered.
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const t = window.setTimeout(go, 60);
    window.addEventListener("hashchange", go);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", go);
    };
  }, [ready]);

  const closeForm = () => {
    setForm(null);
    if (isNew === "1") router.replace("/goals", { scroll: false });
  };

  const goals = goalsQ.data?.goals ?? [];
  const today = goalsQ.data?.today ?? settings?.today ?? "";
  const prefs = settings ? prefsOf(settings.settings) : null;
  const visible = goals.filter((g) => filter === "all" || g.status === filter);
  const groups = CATEGORY_ORDER.map((c) => ({ c, items: visible.filter((g) => g.category === c) })).filter((x) => x.items.length > 0);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const ok = await actions.remove(toDelete);
    setDeleting(false);
    if (ok) setToDelete(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Goals"
        icon={<Target className="size-5 text-accent" aria-hidden />}
        sub="Progress updates automatically from what you log and sync."
        actions={
          <Button onClick={() => setForm({ mode: "create" })} disabled={!settings}>
            <Plus className="size-4" aria-hidden /> New goal
          </Button>
        }
      />

      <nav aria-label="Goal settings" className="-mt-2 flex flex-wrap gap-2">
        <a
          href="#nutrition-targets"
          onClick={(e) => {
            if (scrollToSection("nutrition-targets")) e.preventDefault();
          }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-fg-2 hover:bg-surface-2 hover:text-fg"
        >
          <UtensilsCrossed className="size-3.5" aria-hidden /> Nutrition targets
        </a>
        <a
          href="#weight-goals"
          onClick={(e) => {
            if (scrollToSection("weight-goals")) e.preventDefault();
          }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-fg-2 hover:bg-surface-2 hover:text-fg"
        >
          <Scale className="size-3.5" aria-hidden /> Weight goals
        </a>
      </nav>

      {goalsQ.error && <ErrorBanner error={goalsQ.error} onRetry={() => goalsQ.refetch()} />}
      {settingsQ.error && <ErrorBanner error={settingsQ.error} onRetry={() => settingsQ.refetch()} />}

      {!goalsQ.data || !prefs ? (
        !goalsQ.error && <SummarySkeleton />
      ) : goals.length === 0 ? (
        <Card>
          <CardTitle sub="Pick one to start — every field stays editable before you save.">No goals yet — start with a preset</CardTitle>
          {settings && <PresetGrid ctx={{ prefs, settings }} onPick={(id) => setForm({ mode: "create", presetId: id })} limit={9} />}
          <Button variant="secondary" className="mt-4" onClick={() => setForm({ mode: "create" })}>
            <Trophy className="size-4" aria-hidden /> Browse all goal types
          </Button>
        </Card>
      ) : (
        <>
          <Summary goals={goals} />
          <Segmented<Filter> label="Show goals" size="sm" value={filter} onChange={setFilter} options={FILTERS} />
          {groups.length === 0 ? (
            <EmptyState icon={<Target className="size-6" aria-hidden />} title={`No ${filter === "all" ? "" : `${filter} `}goals`} action={filter === "active" ? <Button onClick={() => setForm({ mode: "create" })}>New goal</Button> : undefined}>
              {EMPTY_TEXT[filter]}
            </EmptyState>
          ) : (
            <div className={goalsQ.isFetching ? "flex flex-col gap-6 opacity-90 transition-opacity" : "flex flex-col gap-6"}>
              {groups.map(({ c, items }) => {
                const meta = CATEGORY_META[c];
                const Icon = meta.icon;
                return (
                  <section key={c} aria-labelledby={`goal-cat-${c}`} className="flex flex-col gap-2.5">
                    <h2 id={`goal-cat-${c}`} className="flex items-center gap-2 text-sm font-semibold text-fg">
                      <Icon className="size-4" style={{ color: meta.color }} aria-hidden />
                      {meta.label}
                      <span className="font-normal text-muted">{items.length}</span>
                    </h2>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {items.map((g, i) => (
                        <GoalCard
                          key={g.id}
                          goal={g}
                          prefs={prefs}
                          today={today}
                          actions={actions}
                          onEdit={() => setForm({ mode: "edit", goal: g })}
                          onDelete={() => setToDelete(g)}
                          onLinkedEdit={() => scrollToSection(g.linked === "nutrition" ? "nutrition-targets" : "weight-goals")}
                          onMove={(dir) => void actions.move(g, dir, goals, items)}
                          canUp={!g.linked && i > 0 && !items[i - 1].linked}
                          canDown={!g.linked && i < items.length - 1}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {settings && (
        <div className="mt-2 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-fg">Targets</h2>
          <NutritionTargetsSection data={settings} />
          <WeightGoalsSection data={settings} key={`w${settings.settings.updatedAt}`} />
        </div>
      )}

      {settings && <GoalFormModal init={form} settings={settings} onClose={closeForm} />}
      <ConfirmDialog open={!!toDelete} title="Delete goal?" confirmLabel="Delete goal" loading={deleting} onClose={() => setToDelete(null)} onConfirm={() => void confirmDelete()}>
        <p>
          “{toDelete?.title}” and its history will be deleted. This can&apos;t be undone. To keep the history, archive it instead.
        </p>
      </ConfirmDialog>
    </div>
  );
}
