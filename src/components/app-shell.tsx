"use client";

import { BarChart3, CalendarDays, Home, LogOut, Plus, Scale, Settings, Sparkles, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { useSettings } from "@/lib/client/hooks";
import { cx, ErrorBanner, Spinner } from "./ui";
import { ReminderScheduler } from "./reminders";

const NAV = [
  { href: "/", label: "Dashboard", short: "Today", icon: Home },
  { href: "/log", label: "Log Food", short: "Log", icon: UtensilsCrossed },
  { href: "/weight", label: "Weight", short: "Weight", icon: Scale },
  { href: "/history", label: "Nutrition History", short: "History", icon: CalendarDays },
  { href: "/analytics", label: "Analytics", short: "Stats", icon: BarChart3 },
  { href: "/assistant", label: "AI Assistant", short: "Assistant", icon: Sparkles },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings },
];

const MOBILE_TABS = ["/", "/weight", "/log", "/history", "/analytics"];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const settings = useSettings();

  useEffect(() => {
    if (settings.data && !settings.data.settings.onboarded && pathname !== "/welcome") router.replace("/welcome");
  }, [settings.data, pathname, router]);

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    // Full reload so no cached data survives sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  };

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <UtensilsCrossed className="size-4" aria-hidden />
          </span>
          <span className="text-base font-semibold">Diet Tracker</span>
        </Link>
        <Link href="/log" className="mb-4 flex h-10 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-accent-fg hover:bg-accent-hover">
          <Plus className="size-4" aria-hidden /> Log a meal
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(pathname, n.href) ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive(pathname, n.href) ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
              )}
            >
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </Link>
          ))}
        </nav>
        {settings.data?.status.authMode === "password" && (
          <button type="button" onClick={logout} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <UtensilsCrossed className="size-3.5" aria-hidden />
            </span>
            <span className="text-sm font-semibold">Diet Tracker</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/assistant" aria-label="AI Assistant" className={cx("flex size-9 items-center justify-center rounded-lg", isActive(pathname, "/assistant") ? "bg-accent-soft text-accent" : "text-fg-2")}>
              <Sparkles className="size-5" aria-hidden />
            </Link>
            <Link href="/settings" aria-label="Settings" className={cx("flex size-9 items-center justify-center rounded-lg", isActive(pathname, "/settings") ? "bg-accent-soft text-accent" : "text-fg-2")}>
              <Settings className="size-5" aria-hidden />
            </Link>
          </div>
        </header>

        {settings.data?.settings.isDemo && (
          <div className="border-b border-warning/40 bg-warning-soft px-4 py-2 text-center text-xs font-medium text-warning-text">
            Demo mode — this database contains generated sample data, not real records.
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-12">
          {settings.isLoading ? (
            <Spinner label="Loading" />
          ) : settings.error ? (
            <ErrorBanner error={settings.error} onRetry={() => settings.refetch()} />
          ) : (
            children
          )}
        </main>

        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          <ul className="grid grid-cols-5">
            {MOBILE_TABS.map((href) => {
              const n = NAV.find((x) => x.href === href)!;
              const active = isActive(pathname, href);
              if (href === "/log") {
                return (
                  <li key={href} className="flex justify-center">
                    <Link href="/log" aria-label="Log food" className="-mt-4 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg">
                      <Plus className="size-6" aria-hidden />
                    </Link>
                  </li>
                );
              }
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-accent" : "text-muted")}>
                    <n.icon className="size-5" aria-hidden />
                    {n.short}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      {settings.data && <ReminderScheduler settings={settings.data.settings} />}
    </div>
  );
}
