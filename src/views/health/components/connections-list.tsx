"use client";

import { ChevronDown, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { timeAgo } from "@/components/kit";
import { useToast } from "@/components/toast";
import { Badge, Button, cx, EmptyState, Modal, Skeleton } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { ConnectionJ } from "@/lib/client/types";
import { formatLocalDate } from "@/lib/time";
import { eventSummary, FORMAT_LABEL, metricName, type MetricKey, type SyncEventJ } from "./health-utils";
import { ScopePicker } from "./scope-picker";
import { EventStatusBadge } from "./sync-status";

const fmtInstant = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function EventRow({ ev }: { ev: SyncEventJ }) {
  const s = eventSummary(ev.summary);
  const daysText = s.days.length ? (s.days.length === 1 ? formatLocalDate(s.days[0], { month: "short", day: "numeric" }) : `${formatLocalDate(s.days[0], { month: "short", day: "numeric" })} – ${formatLocalDate(s.days[s.days.length - 1], { month: "short", day: "numeric" })}`) : null;
  const hasDetail = s.ignored.length > 0 || s.byMetric.length > 0 || !!ev.message;
  return (
    <li>
      <details className="group rounded-lg border border-line">
        <summary className={cx("flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-fg-2 [&::-webkit-details-marker]:hidden", !hasDetail && "cursor-default")}>
          <EventStatusBadge status={ev.status} />
          <span className="min-w-0 flex-1">
            <span title={fmtInstant(ev.receivedAt)}>{timeAgo(ev.receivedAt)}</span>
            {s.accepted != null ? ` · ${s.accepted} accepted` : ""}
            {s.ignored.length ? ` · ${s.ignored.length} ignored` : ""}
            {daysText ? ` · ${daysText}` : ""}
          </span>
          {hasDetail && <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />}
        </summary>
        {hasDetail && (
          <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2 text-xs text-fg-2">
            <p className="text-muted">Received {fmtInstant(ev.receivedAt)}{s.format ? ` · ${FORMAT_LABEL[s.format] ?? s.format}` : ""}</p>
            {ev.message && <p className="text-critical">{ev.message}</p>}
            {s.byMetric.length > 0 && <p>Stored: {s.byMetric.map((b) => `${metricName(b.metric)} ${b.count} day${b.count === 1 ? "" : "s"}`).join(", ")}</p>}
            {s.ignored.length > 0 && (
              <div>
                <p className="font-medium text-fg">Ignored</p>
                <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4">
                  {s.ignored.map((x, i) => (
                    <li key={`${x.item}-${i}`}>
                      <span className="font-mono">{x.item}</span>: {x.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </details>
    </li>
  );
}

function RevokeModal({ conn, onClose }: { conn: ConnectionJ; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    setBusy(true);
    try {
      const res = await api.del<{ ok: boolean; deleted: number }>(`/api/vitals/connections/${conn.id}${deleteData ? "?deleteData=1" : ""}`);
      await invalidate();
      toast.success(deleteData ? `Revoked “${conn.name}” and deleted ${res.deleted} value${res.deleted === 1 ? "" : "s"}` : `Revoked “${conn.name}”`);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">
        The token stops working immediately — the phone&apos;s next sync will be rejected. Also remove the automation on the phone, and if you like, the Health permission in iPhone Settings → Health → Data Access &amp; Devices.
      </p>
      <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-line-strong px-3 py-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--critical)]" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
        <span>
          <span className="block font-medium text-fg">Also delete everything it synced</span>
          <span className="block text-xs text-muted">Otherwise its past values stay and keep counting toward charts and goals.</span>
        </span>
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" size="lg" loading={busy} onClick={revoke}>
          Revoke{deleteData ? " & delete data" : ""}
        </Button>
      </div>
    </div>
  );
}

function ConnectionItem({ conn }: { conn: ConnectionJ }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [pending, setPending] = useState<MetricKey[] | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const revoked = !!conn.revokedAt;
  const scopes = pending ?? conn.scopes;

  const saveScopes = async (next: MetricKey[]) => {
    setPending(next);
    try {
      await api.patch(`/api/vitals/connections/${conn.id}`, { scopes: next });
      await invalidate();
      toast.success("Permissions updated");
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };

  const deleteData = async () => {
    if (!window.confirm(`Delete every value “${conn.name}” synced? This can't be undone.`)) return;
    setDeletingData(true);
    try {
      const res = await api.del<{ deleted: number }>(`/api/vitals/sources?source=${encodeURIComponent(`conn:${conn.id}`)}`);
      await invalidate();
      toast.success(`Deleted ${res.deleted} value${res.deleted === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeletingData(false);
    }
  };

  return (
    <li className={cx("flex flex-col gap-3 rounded-xl border border-line p-4", revoked && "bg-surface-2/60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
            <Smartphone className="size-4 text-muted" aria-hidden />
            {conn.name}
            {revoked ? <Badge tone="neutral">Revoked</Badge> : <Badge tone="good">Active</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {conn.platformLabel} · token <span className="font-mono">{conn.tokenPrefix}…</span> · created {new Date(conn.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
          <p className="text-xs text-fg-2">
            {revoked ? `Revoked ${timeAgo(conn.revokedAt)} · ` : ""}Last sync: {conn.lastUsedAt ? timeAgo(conn.lastUsedAt) : "never — run the shortcut or exporter once to test"}
          </p>
        </div>
        {revoked ? (
          <Button size="sm" variant="ghost" loading={deletingData} onClick={deleteData}>
            <Trash2 className="size-4" /> Delete its data
          </Button>
        ) : (
          <Button size="sm" variant="secondary" className="text-critical" onClick={() => setRevoking(true)}>
            Revoke
          </Button>
        )}
      </div>

      {revoked ? (
        <p className="text-xs text-muted">Could send: {conn.scopes.map(metricName).join(", ")}</p>
      ) : (
        <ScopePicker value={scopes} onChange={saveScopes} disabled={pending !== null} compact legend="Allowed data (changes apply to the next sync)" />
      )}

      {conn.recentEvents.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Recent syncs</p>
          <ul className="flex flex-col gap-1.5">
            {conn.recentEvents.map((ev) => (
              <EventRow key={ev.id} ev={ev} />
            ))}
          </ul>
        </div>
      ) : (
        !revoked && <p className="text-xs text-muted">No syncs received yet.</p>
      )}

      <Modal open={revoking} onClose={() => setRevoking(false)} title={`Revoke “${conn.name}”?`}>
        {revoking && <RevokeModal conn={conn} onClose={() => setRevoking(false)} />}
      </Modal>
    </li>
  );
}

export function ConnectionsList({ connections, loading }: { connections: ConnectionJ[] | undefined; loading: boolean }) {
  if (loading && !connections) return <Skeleton className="h-40" />;
  const list = [...(connections ?? [])].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt));
  if (!list.length) return <EmptyState title="No connections yet">Create one above, then follow the setup guide for your phone.</EmptyState>;
  return (
    <ul className="flex flex-col gap-3">
      {list.map((c) => (
        <ConnectionItem key={c.id} conn={c} />
      ))}
    </ul>
  );
}
