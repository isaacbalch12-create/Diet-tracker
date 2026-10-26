"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, formatLocalDate } from "@/lib/time";
import { Button, IconButton } from "./ui";

export function DateNav({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) {
  const isToday = date === today;
  const label = isToday ? "Today" : date === addDays(today, -1) ? "Yesterday" : formatLocalDate(date, { weekday: "long", month: "short", day: "numeric" });
  return (
    <div className="flex items-center gap-1">
      <IconButton label="Previous day" onClick={() => onChange(addDays(date, -1))}>
        <ChevronLeft className="size-5" />
      </IconButton>
      <label className="relative cursor-pointer">
        <span className="block min-w-28 rounded-lg px-2 py-1 text-center text-lg font-semibold text-fg hover:bg-surface-2">{label}</span>
        <input
          type="date"
          aria-label="Choose date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <IconButton label="Next day" onClick={() => onChange(addDays(date, 1))} disabled={date >= today}>
        <ChevronRight className="size-5" />
      </IconButton>
      {!isToday && (
        <Button variant="ghost" size="sm" onClick={() => onChange(today)}>
          Today
        </Button>
      )}
    </div>
  );
}
