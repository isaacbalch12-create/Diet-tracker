"use client";

import { ArrowLeft, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { PageHeader } from "@/components/kit";
import { useToast } from "@/components/toast";
import { Button, Card, CardTitle, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useConnections, useInvalidateData } from "@/lib/client/hooks";
import { LinkButton } from "@/views/running/components/link-button";
import { ConnectionsList } from "./components/connections-list";
import { CreateConnectionForm, TokenReveal, type Created } from "./components/create-connection";
import { PLATFORM_GUIDE, SetupGuides, type GuideKey } from "./components/setup-guides";

const noopSubscribe = () => () => undefined;

/** window.location.origin on the client, "" during server rendering. */
function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
}

function ExplainCard() {
  return (
    <Card>
      <CardTitle>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-good" aria-hidden /> How phone sync works
        </span>
      </CardTitle>
      <div className="flex flex-col gap-2.5 text-sm text-fg-2">
        <p>
          <strong className="text-fg">Why there&apos;s no &ldquo;Connect to Apple Health&rdquo; button:</strong> Apple Health (HealthKit) and Android Health Connect are only available to apps installed on the phone. No website — this one included — can read them
          directly.
        </p>
        <p>
          <strong className="text-fg">What happens instead:</strong> you create a connection here and get a private token. A free iPhone Shortcut, the Health Auto Export app (a paid feature), or an Android exporter reads your data on the phone and sends daily totals to this app
          with that token, on a schedule you choose.
        </p>
        <p>
          <strong className="text-fg">You decide what&apos;s shared:</strong> each connection may only send the kinds of data you tick (steps and sleep by default). Anything else it sends is ignored and reported back to you.
        </p>
        <p>
          <strong className="text-fg">Permissions on the phone:</strong> iOS asks for Health access per data type the first time the Shortcut or exporter app runs. Review or remove that anytime in iPhone <em>Settings → Health → Data Access &amp; Devices</em>.
        </p>
        <p>
          <strong className="text-fg">Revoke anytime:</strong> revoking a connection below stops its token immediately; you can also delete everything it synced.
        </p>
      </div>
    </Card>
  );
}

function ManualDataCard() {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    if (!window.confirm("Delete every steps, sleep and vitals value you entered by hand? Synced data is not affected. This can't be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.del<{ deleted: number }>("/api/vitals/sources?source=manual");
      await invalidate();
      toast.success(res.deleted ? `Deleted ${res.deleted} manually entered value${res.deleted === 1 ? "" : "s"}` : "There were no manually entered values");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle sub="Values typed in on the Steps & sleep page are stored separately from synced data, labeled “Entered manually”.">Manually entered values</CardTitle>
      {error ? (
        <div className="mb-3">
          <ErrorBanner error={error} />
        </div>
      ) : null}
      <Button variant="secondary" className="text-critical" loading={busy} onClick={run}>
        <Trash2 className="size-4" /> Delete all manually entered values
      </Button>
    </Card>
  );
}

export function HealthConnectView() {
  const origin = useOrigin();
  const connQ = useConnections();
  const [created, setCreated] = useState<Created | null>(null);
  const [guide, setGuide] = useState<GuideKey>("ios");
  const endpoint = `${origin || "https://<this app>"}/api/ingest/health`;
  const active = (connQ.data ?? []).filter((c) => !c.revokedAt).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <LinkButton href="/health" variant="ghost" size="sm" className="-ml-2 mb-1">
          <ArrowLeft className="size-4" aria-hidden /> Steps &amp; sleep
        </LinkButton>
        <PageHeader title="Phone health sync" icon={<Smartphone className="size-5 text-s1" aria-hidden />} sub="Send steps and sleep from Apple Health or Android Health Connect — only the data you choose." />
      </div>

      <ExplainCard />

      <Card>
        <CardTitle sub={created ? "Save these details — the token is only shown once." : "One connection per phone or exporter. It gets its own token you can revoke on its own."}>{created ? "Connection created" : "Step 1 · Create a connection"}</CardTitle>
        {created ? (
          <TokenReveal created={created} endpoint={endpoint} onDismiss={() => setCreated(null)} />
        ) : (
          <CreateConnectionForm
            onCreated={(c) => {
              setCreated(c);
              setGuide(PLATFORM_GUIDE[c.connection.platform] ?? "json");
            }}
          />
        )}
      </Card>

      <Card>
        <CardTitle sub="Pick your phone or exporter. Use the endpoint URL and token from step 1.">Step 2 · Set up your phone</CardTitle>
        <SetupGuides endpoint={endpoint} guide={guide} onGuide={setGuide} />
      </Card>

      <Card>
        <CardTitle sub={connQ.data ? `${active} active · tap a sync to see what was accepted or ignored, and why.` : undefined}>Connections &amp; permissions</CardTitle>
        {connQ.error ? <ErrorBanner error={connQ.error} onRetry={() => connQ.refetch()} /> : <ConnectionsList connections={connQ.data} loading={connQ.isLoading} />}
      </Card>

      <ManualDataCard />
    </div>
  );
}
