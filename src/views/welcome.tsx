"use client";

import { useQueryClient } from "@tanstack/react-query";
import { UtensilsCrossed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { GoalsForm } from "@/components/goals-form";
import { Button, Card, CardTitle, ErrorBanner, Field, Input, Segmented, Select } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSettings } from "@/lib/client/hooks";
import { timeZones } from "./settings";

export function WelcomeView() {
  const q = useSettings();
  const router = useRouter();
  const qc = useQueryClient();
  const zones = useMemo(() => timeZones(), []);
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const [tz, setTz] = useState(browserTz);
  const [start, setStart] = useState("");
  const [target, setTarget] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!q.data) return null;

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patch("/api/settings", {
        weightUnit: unit,
        timezone: tz,
        startingWeight: start.trim() ? { value: Number(start), unit } : undefined,
        targetWeight: target.trim() ? { value: Number(target), unit } : undefined,
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      setStep(2);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };
  const finish = async () => {
    await api.patch("/api/settings", { onboarded: true });
    await qc.invalidateQueries();
    router.replace("/");
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
          <UtensilsCrossed className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Welcome to Diet Tracker</h1>
          <p className="text-sm text-muted">Two quick steps. Everything can be changed later in Settings.</p>
        </div>
      </div>
      {step === 1 ? (
        <Card>
          <CardTitle sub="Starting and target weight are optional.">1. Units, time zone and weight</CardTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Weight unit">
              {() => (
                <Segmented
                  label="Weight unit"
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: "lb", label: "Pounds" },
                    { value: "kg", label: "Kilograms" },
                  ]}
                />
              )}
            </Field>
            <Field label="Time zone">
              {(id) => (
                <Select id={id} value={tz} onChange={(e) => setTz(e.target.value)}>
                  {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={`Starting weight (${unit})`}>{(id) => <Input id={id} inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} placeholder="Optional" />}</Field>
            <Field label={`Target weight (${unit})`}>{(id) => <Input id={id} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Optional" />}</Field>
          </div>
          {error ? <div className="mt-3"><ErrorBanner error={error} /></div> : null}
          <div className="mt-4 flex gap-2">
            <Button onClick={saveProfile} loading={saving}>
              Continue
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <CardTitle sub="Optional — set goals now, use the calculator for a starting point, or skip.">2. Daily nutrition goals</CardTitle>
          <GoalsForm data={q.data} onSaved={finish} />
          <div className="mt-4 border-t border-line pt-3">
            <Button variant="ghost" onClick={finish}>
              Skip for now
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
