"use client";

import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  Droplets,
  Dumbbell,
  Footprints,
  HeartPulse,
  Home,
  LogOut,
  Menu,
  Moon,
  Plus,
  Scale,
  Settings,
  Sparkles,
  Sun,
  Target,
  UtensilsCrossed,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, newRequestId } from "@/lib/client/api";
import { useInvalidateData, useSettings } from "@/lib/client/hooks";
import { cx, ErrorBanner, Modal, Spinner } from "./ui";
import { ReminderScheduler } from "./reminders";
import { useToast } from "./toast";

export const APP_NAME = "Momentum";

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: typeof Home;
}

const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Today", short: "Today", icon: Home },
      { href: "/goals", label: "Goals", short: "Goals", icon: Target },
    ],
  },
  {
    label: "Nutrition & body",
    items: [
      { href: "/nutrition", label: "Food today", short: "Food", icon: UtensilsCrossed },
      { href: "/log", label: "Log food", short: "Log", icon: Plus },
      { href: "/history", label: "Nutrition history", short: "History", icon: CalendarDays },
      { href: "/weight", label: "Weight", short: "Weight", icon: Scale },
    ],
  },
  {
    label: "Activity",
    items: [
      { href: "/training", label: "Training", short: "Train", icon: Dumbbell },
      { href: "/running", label: "Running", short: "Run", icon: Footprints },
      { href: "/health", label: "Steps & sleep", short: "Health", icon: HeartPulse },
    ],
  },
  {
    label: "Routines",
    items: [
      { href: "/routines/morning", label: "Morning routine", short: "Morning", icon: Sun },
      { href: "/routines/night", label: "Nightly routine", short: "Night", icon: Moon },
      { href: "/journal", label: "Journal", short: "Journal", icon: BookOpen },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", short: "Stats", icon: BarChart3 },
      { href: "/assistant", label: "AI assistant", short: "Assistant", icon: Sparkles },
    ],
  },
  { items: [{ href: "/settings", label: "Settings", short: "Settings", icon: Settings }] },
];

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/nutrition") return pathname === "/nutrition" || pathname.startsWith("/meals/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [busy, setBusy] = useState(false);
  const unit = settings.data?.settings.waterUnit ?? "oz";
  const amounts = unit === "oz" ? [8, 12, 16, 24] : [250, 350, 500, 750];
  const addWater = async (value: number) => {
    setBusy(true);
    try {
      await api.post("/api/water", { value, unit, clientRequestId: newRequestId() });
      await invalidate();
      toast.success(`Added ${value} ${unit} of water`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const links: { href: string; label: string; icon: typeof Home; tone: string }[] = [
    { href: "/log", label: "Meal", icon: UtensilsCrossed, tone: "text-[var(--series-cal)]" },
    { href: "/weight?log=1", label: "Weigh-in", icon: Scale, tone: "text-s1" },
    { href: "/training?start=1", label: "Workout", icon: Dumbbell, tone: "text-s2" },
    { href: "/running?log=1", label: "Run", icon: Footprints, tone: "text-s3" },
    { href: "/routines/morning", label: "Morning", icon: Sun, tone: "text-warning" },
    { href: "/routines/night", label: "Night", icon: Moon, tone: "text-accent" },
    { href: "/journal?new=1", label: "Journal", icon: BookOpen, tone: "text-fg-2" },
    { href: "/health?log=1", label: "Steps / sleep", icon: Activity, tone: "text-s1" },
  ];
  return (
    <Modal open={open} onClose={onClose} title="Quick add">
      <div className="grid grid-cols-4 gap-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} onClick={onClose} className="flex flex-col items-center gap-1.5 rounded-xl border border-line px-1 py-3 text-xs font-medium text-fg hover:bg-surface-2">
            <l.icon className={cx("size-5", l.tone)} aria-hidden />
            {l.label}
          </Link>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-surface-2 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg">
          <Droplets className="size-4 text-s1" aria-hidden /> Water
        </p>
        <div className="flex flex-wrap gap-2">
          {amounts.map((a) => (
            <button key={a} type="button" disabled={busy} onClick={() => addWater(a)} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg hover:bg-surface-3 disabled:opacity-50">
              +{a} {unit}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function MoreSheet({ open, onClose, pathname, onLogout, canLogout }: { open: boolean; onClose: () => void; pathname: string; onLogout: () => void; canLogout: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title="All sections">
      <div className="flex flex-col gap-4">
        {NAV_GROUPS.map((g, i) => (
          <div key={i}>
            {g.label && <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{g.label}</p>}
            <div className="grid grid-cols-3 gap-2">
              {g.items.map((n) => (
                <Link key={n.href} href={n.href} onClick={onClose} aria-current={isActive(pathname, n.href) ? "page" : undefined} className={cx("flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-xs font-medium", isActive(pathname, n.href) ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-fg hover:bg-surface-2")}>
                  <n.icon className="size-5" aria-hidden />
                  {n.short}
                </Link>
              ))}
            </div>
          </div>
        ))}
        {canLogout && (
          <button type="button" onClick={onLogout} className="flex items-center justify-center gap-2 rounded-lg border border-line py-2 text-sm text-muted hover:bg-surface-2">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        )}
      </div>
    </Modal>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const settings = useSettings();
  const [quick, setQuick] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (settings.data && !settings.data.settings.onboarded && pathname !== "/welcome") router.replace("/welcome");
  }, [settings.data, pathname, router]);

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    // Full reload so no cached data survives sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  };
  const canLogout = settings.data?.status.authMode === "password";

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-4 md:flex">
        <Link href="/" className="mb-5 flex items-center gap-2 px-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Zap className="size-4" aria-hidden />
          </span>
          <span className="text-base font-semibold">{APP_NAME}</span>
        </Link>
        <button type="button" onClick={() => setQuick(true)} className="mb-4 flex h-10 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-accent-fg hover:bg-accent-hover">
          <Plus className="size-4" aria-hidden /> Quick add
        </button>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-3">
          {NAV_GROUPS.map((g, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              {g.label && <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.label}</p>}
              {g.items.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={isActive(pathname, n.href) ? "page" : undefined}
                  className={cx("flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", isActive(pathname, n.href) ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}
                >
                  <n.icon className="size-4" aria-hidden />
                  {n.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        {canLogout && (
          <button type="button" onClick={logout} className="mt-3 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <Zap className="size-3.5" aria-hidden />
            </span>
            <span className="text-sm font-semibold">{APP_NAME}</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/goals" aria-label="Goals" className={cx("flex size-9 items-center justify-center rounded-lg", isActive(pathname, "/goals") ? "bg-accent-soft text-accent" : "text-fg-2")}>
              <Target className="size-5" aria-hidden />
            </Link>
            <Link href="/assistant" aria-label="AI assistant" className={cx("flex size-9 items-center justify-center rounded-lg", isActive(pathname, "/assistant") ? "bg-accent-soft text-accent" : "text-fg-2")}>
              <Sparkles className="size-5" aria-hidden />
            </Link>
            <Link href="/settings" aria-label="Settings" className={cx("flex size-9 items-center justify-center rounded-lg", isActive(pathname, "/settings") ? "bg-accent-soft text-accent" : "text-fg-2")}>
              <Settings className="size-5" aria-hidden />
            </Link>
          </div>
        </header>

        {settings.data?.settings.isDemo && (
          <div className="border-b border-warning/40 bg-warning-soft px-4 py-2 text-center text-xs font-medium text-warning-text">Demo mode — this database contains generated sample data, not real records.</div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-12">
          {settings.isLoading ? <Spinner label="Loading" /> : settings.error ? <ErrorBanner error={settings.error} onRetry={() => settings.refetch()} /> : children}
        </main>

        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          <ul className="grid grid-cols-5">
            {["/", "/nutrition"].map((href) => {
              const n = ALL_NAV.find((x) => x.href === href)!;
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-accent" : "text-muted")}>
                    <n.icon className="size-5" aria-hidden />
                    {n.short}
                  </Link>
                </li>
              );
            })}
            <li className="flex justify-center">
              <button type="button" onClick={() => setQuick(true)} aria-label="Quick add" className="-mt-4 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg">
                <Plus className="size-6" aria-hidden />
              </button>
            </li>
            <li>
              <Link href="/training" aria-current={isActive(pathname, "/training") ? "page" : undefined} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive(pathname, "/training") ? "text-accent" : "text-muted")}>
                <Dumbbell className="size-5" aria-hidden />
                Train
              </Link>
            </li>
            <li>
              <button type="button" onClick={() => setMore(true)} className="flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted">
                <Menu className="size-5" aria-hidden />
                More
              </button>
            </li>
          </ul>
        </nav>
      </div>
      <QuickAdd open={quick} onClose={() => setQuick(false)} />
      <MoreSheet open={more} onClose={() => setMore(false)} pathname={pathname} onLogout={logout} canLogout={canLogout} />
      {settings.data && <ReminderScheduler settings={settings.data.settings} />}
    </div>
  );
}
