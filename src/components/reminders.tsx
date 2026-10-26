"use client";

import { useEffect } from "react";
import { api } from "@/lib/client/api";
import type { DaySummaryJ, SettingsJ } from "@/lib/client/types";

/** Milliseconds until the next HH:mm wall-clock time in a zone (within the next 24h). */
function msUntil(time: string, tz: string, now = new Date()): number {
  const [h, m] = time.split(":").map(Number);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const nowSec = get("hour") * 3600 + get("minute") * 60 + get("second");
  let diff = h * 3600 + m * 60 - nowSec;
  if (diff <= 0) diff += 86_400;
  return diff * 1000;
}

/**
 * Logging reminders while the app is open (or installed and running). Shows a
 * browser notification at the configured times if that weigh-in is missing.
 * True background push would need a push service and is not implemented.
 */
export function ReminderScheduler({ settings }: { settings: SettingsJ }) {
  useEffect(() => {
    if (!settings.reminders.enabled || typeof window === "undefined" || !("Notification" in window)) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (period: "morning" | "night", time: string) => {
      const t = setTimeout(async () => {
        try {
          const day = await api.get<DaySummaryJ>("/api/day");
          if (!day.weights[period] && Notification.permission === "granted") {
            new Notification("Diet Tracker", { body: period === "morning" ? "Time for your morning weigh-in." : "Log your night weight before bed.", icon: "/icon.svg", tag: `weigh-${period}` });
          }
        } catch {
          // ignore — reminders are best-effort
        }
        schedule(period, time);
      }, msUntil(time, settings.timezone));
      timers.push(t);
    };
    schedule("morning", settings.reminders.morning);
    schedule("night", settings.reminders.night);
    return () => timers.forEach(clearTimeout);
  }, [settings.reminders.enabled, settings.reminders.morning, settings.reminders.night, settings.timezone]);
  return null;
}
