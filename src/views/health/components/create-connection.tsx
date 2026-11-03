"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button, ErrorBanner, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { ConnectionJ } from "@/lib/client/types";
import { CopyField } from "./copy";
import { metricName, type MetricKey } from "./health-utils";
import { ScopePicker } from "./scope-picker";

export type Platform = ConnectionJ["platform"];

export const PLATFORM_OPTIONS: { value: Platform; label: string; defaultName: string }[] = [
  { value: "ios_shortcut", label: "iPhone — Shortcuts app (free)", defaultName: "iPhone Shortcut" },
  { value: "health_auto_export", label: "iPhone — Health Auto Export app", defaultName: "Health Auto Export" },
  { value: "android", label: "Android — Health Connect exporter", defaultName: "Android phone" },
  { value: "other", label: "Other exporter or script", defaultName: "Custom exporter" },
];

export interface Created {
  connection: Pick<ConnectionJ, "id" | "name" | "platform" | "scopes" | "tokenPrefix">;
  token: string;
}

export function CreateConnectionForm({ onCreated }: { onCreated: (c: Created) => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [platform, setPlatform] = useState<Platform>("ios_shortcut");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<MetricKey[]>(["steps", "sleep"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const defaultName = PLATFORM_OPTIONS.find((p) => p.value === platform)?.defaultName ?? "My phone";

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<Created>("/api/vitals/connections", { name: name.trim() || defaultName, platform, scopes });
      await invalidate();
      toast.success("Connection created — copy the token now");
      onCreated(res);
      setName("");
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={create} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Phone or exporter">
          {(id) => (
            <Select id={id} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {PLATFORM_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name" hint="So you can tell connections apart.">
          {(id) => <Input id={id} value={name} maxLength={80} placeholder={defaultName} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
      <ScopePicker value={scopes} onChange={setScopes} />
      <p className="text-xs text-muted">Only the kinds you tick are accepted — anything else the phone sends is ignored and reported back. Steps and sleep are all this page needs; you can change this later.</p>
      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={saving} disabled={scopes.length === 0}>
          <KeyRound className="size-4" /> Create connection
        </Button>
      </div>
    </form>
  );
}

/** Shown once right after creation: the server only keeps a hash of the token. */
export function TokenReveal({ created, endpoint, onDismiss }: { created: Created; endpoint: string; onDismiss: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-text">
        <strong>Copy your token now — it won&apos;t be shown again.</strong> Only a fingerprint of it is stored. If you lose it, revoke this connection and create a new one. Treat it like a password: anyone with it can send data to your account (but can&apos;t read anything).
      </div>
      <p className="text-sm text-fg-2">
        &ldquo;{created.connection.name}&rdquo; may send: {created.connection.scopes.map(metricName).join(", ")}.
      </p>
      <CopyField label="Endpoint URL" value={endpoint} />
      <CopyField label="Token" value={created.token} secret />
      <CopyField label="Authorization header value" value={`Bearer ${created.token}`} secret />
      <p className="text-xs text-muted">Follow the setup guide below, paste these where it says, then come back here to see the first sync arrive.</p>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            if (window.confirm("Hide the token? It can't be shown again.")) onDismiss();
          }}
        >
          I&apos;ve saved it
        </Button>
      </div>
    </div>
  );
}
