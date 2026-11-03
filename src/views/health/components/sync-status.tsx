"use client";

import { AlertTriangle, CheckCircle2, ChevronRight, CircleSlash, Smartphone } from "lucide-react";
import { timeAgo } from "@/components/kit";
import { Badge, Card, cx } from "@/components/ui";
import type { VitalsJ } from "@/lib/client/types";
import { LinkButton } from "@/views/running/components/link-button";
import { eventSummary, hoursSince, metricName } from "./health-utils";

const STALE_HOURS = 36;

export function EventStatusBadge({ status }: { status: string }) {
  if (status === "ok") return <Badge tone="good">OK</Badge>;
  if (status === "partial") return <Badge tone="warning">Partly accepted</Badge>;
  return <Badge tone="critical">Failed</Badge>;
}

/** Explains why there is no "Connect to Apple Health" button and what to do instead. */
export function NoConnectionCard({ hasData }: { hasData: boolean }) {
  return (
    <Card className="border-accent/30">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <Smartphone className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-fg">{hasData ? "No phone is syncing right now" : "Bring in steps and sleep from your phone"}</h2>
          <p className="mt-1 text-sm text-fg-2">
            Apple Health and Android Health Connect can only be read by apps installed on your phone — a website can&apos;t connect to them directly. Instead, a free iPhone Shortcut (or an exporter app) sends your daily steps and sleep here
            on a schedule, using a private token you can revoke at any time. You choose exactly which kinds of data it may send.
          </p>
          {hasData && <p className="mt-1 text-sm text-muted">The data below was entered by hand or synced by a connection that has since been revoked.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href="/health/connect" variant="primary">
              <Smartphone className="size-4" aria-hidden /> Set up phone sync
            </LinkButton>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function SyncBanner({ sync, hasData }: { sync: VitalsJ["sync"]; hasData: boolean }) {
  if (sync.activeConnections === 0) return <NoConnectionCard hasData={hasData} />;
  const age = hoursSince(sync.lastSyncAt);
  const stale = age == null || age > STALE_HOURS;
  const ev = sync.lastEvent;
  const summary = ev ? eventSummary(ev.summary) : null;
  const failed = ev?.status === "error";
  const tone = failed ? "critical" : stale || ev?.status === "partial" ? "warning" : "good";
  const Icon = tone === "good" ? CheckCircle2 : failed ? CircleSlash : AlertTriangle;
  return (
    <section
      aria-label="Phone sync status"
      className={cx(
        "flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        tone === "good" ? "border-line bg-surface" : tone === "warning" ? "border-warning/40 bg-warning-soft" : "border-critical/30 bg-critical-soft",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className={cx("mt-0.5 size-4 shrink-0", tone === "good" ? "text-good" : tone === "warning" ? "text-warning-text" : "text-critical")} aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-fg">
            Phone sync · {sync.activeConnections} connection{sync.activeConnections === 1 ? "" : "s"} · last sync {timeAgo(sync.lastSyncAt)}
          </p>
          {stale && <p className="text-fg-2">{sync.lastSyncAt ? "No data received for a while — check that the automation on your phone is still running (Health data can't be read while the iPhone is locked)." : "Nothing received yet — run the shortcut or exporter once to test it."}</p>}
          {ev && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-2">
              <EventStatusBadge status={ev.status} />
              <span>
                {timeAgo(ev.receivedAt)}
                {summary?.accepted != null ? ` · ${summary.accepted} value${summary.accepted === 1 ? "" : "s"} accepted` : ""}
                {summary && summary.byMetric.length ? ` (${summary.byMetric.map((b) => `${metricName(b.metric).toLowerCase()} ${b.count}`).join(", ")})` : ""}
                {summary && summary.ignored.length ? ` · ${summary.ignored.length} ignored` : ""}
              </span>
              {ev.message && <span className="text-critical">{ev.message}</span>}
            </p>
          )}
        </div>
      </div>
      <LinkButton href="/health/connect" size="sm" variant={tone === "good" ? "ghost" : "secondary"} className="self-start sm:self-auto">
        Connections <ChevronRight className="size-4" aria-hidden />
      </LinkButton>
    </section>
  );
}
