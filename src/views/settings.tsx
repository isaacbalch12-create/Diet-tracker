"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, Database, Download, Monitor, Moon, Sun, Upload, X, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { GoalsForm } from "@/components/goals-form";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, ErrorBanner, Field, Input, Segmented, Select } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSettings } from "@/lib/client/hooks";
import type { SettingsResponse } from "@/lib/client/types";
import { fromKg, type WeightUnit } from "@/lib/units";

export function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

function ProfileSection({ data }: { data: SettingsResponse }) {
  const toast = useToast();
  const qc = useQueryClient();
  const s = data.settings;
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const zones = useMemo(() => timeZones(), []);
  const [f, setF] = useState({ weightUnit: s.weightUnit, timezone: s.timezone, dayStartHour: s.dayStartHour, weekStartsOn: s.weekStartsOn });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/api/settings", f);
      await qc.invalidateQueries();
      toast.success("Preferences saved");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardTitle sub="Records keep the time zone they were logged in; changing it here affects new entries and what “today” means.">Units &amp; time</CardTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Weight unit">
          {() => (
            <Segmented
              label="Weight unit"
              value={f.weightUnit}
              onChange={(v) => setF({ ...f, weightUnit: v })}
              options={[
                { value: "lb", label: "Pounds (lb)" },
                { value: "kg", label: "Kilograms (kg)" },
              ]}
            />
          )}
        </Field>
        <Field label="Time zone" hint={browserTz !== f.timezone ? <button type="button" className="text-accent" onClick={() => setF({ ...f, timezone: browserTz })}>Use this device&apos;s zone ({browserTz})</button> : undefined}>
          {(id) => (
            <Select id={id} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {(zones.includes(f.timezone) ? zones : [f.timezone, ...zones]).map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Day starts at" hint="Food eaten after midnight but before this hour counts toward the previous day.">
          {(id) => (
            <Select id={id} value={f.dayStartHour} onChange={(e) => setF({ ...f, dayStartHour: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? "Midnight" : `${h}:00 AM`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Weeks start on">
          {(id) => (
            <Select id={id} value={f.weekStartsOn} onChange={(e) => setF({ ...f, weekStartsOn: Number(e.target.value) })}>
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </Select>
          )}
        </Field>
      </div>
      <Button className="mt-4" onClick={save} loading={saving}>
        Save preferences
      </Button>
    </Card>
  );
}

function WeightGoalsSection({ data }: { data: SettingsResponse }) {
  const toast = useToast();
  const qc = useQueryClient();
  const s = data.settings;
  const unit = s.weightUnit as WeightUnit;
  const show = (kg: number | null) => (kg == null ? "" : String(Number(fromKg(kg, unit).toFixed(1))));
  const [start, setStart] = useState(show(s.startingWeightKg));
  const [startDate, setStartDate] = useState(s.startingWeightDate ?? data.today);
  const [target, setTarget] = useState(show(s.targetWeightKg));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/api/settings", {
        startingWeight: start.trim() ? { value: Number(start), unit, date: startDate } : null,
        targetWeight: target.trim() ? { value: Number(target), unit } : null,
      });
      await qc.invalidateQueries();
      toast.success("Weight goals saved");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardTitle sub="Used for “change since start” and “to target”. Leave blank if not applicable.">Weight goals</CardTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={`Starting weight (${unit})`}>{(id) => <Input id={id} inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Starting date">{(id) => <Input id={id} type="date" value={startDate} max={data.today} onChange={(e) => setStartDate(e.target.value)} />}</Field>
        <Field label={`Target weight (${unit})`}>{(id) => <Input id={id} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Optional" />}</Field>
      </div>
      <Button className="mt-4" onClick={save} loading={saving}>
        Save weight goals
      </Button>
    </Card>
  );
}

function CategoriesSection({ data }: { data: SettingsResponse }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [cats, setCats] = useState<string[]>(data.settings.mealCategories);
  const [add, setAdd] = useState("");
  const save = async (next: string[]) => {
    setCats(next);
    try {
      await api.patch("/api/settings", { mealCategories: next });
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (err) {
      toast.error(err);
      setCats(data.settings.mealCategories);
    }
  };
  return (
    <Card>
      <CardTitle sub="Add your own (e.g. Pre-workout, Late snack). Removing one doesn't change meals already logged.">Meal categories</CardTitle>
      <ul className="flex flex-wrap gap-2">
        {cats.map((c) => (
          <li key={c} className="inline-flex items-center gap-1 rounded-full border border-line-strong py-1 pr-1 pl-3 text-sm">
            {c}
            <button type="button" aria-label={`Remove ${c}`} disabled={cats.length <= 1} onClick={() => save(cats.filter((x) => x !== c))} className="rounded-full p-0.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30">
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = add.trim();
          if (v && !cats.some((c) => c.toLowerCase() === v.toLowerCase())) save([...cats, v]);
          setAdd("");
        }}
      >
        <Input aria-label="New category" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="New category" className="max-w-xs" maxLength={40} />
        <Button type="submit" variant="secondary" disabled={!add.trim()}>
          Add
        </Button>
      </form>
    </Card>
  );
}

function RemindersSection({ data }: { data: SettingsResponse }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [r, setR] = useState(data.settings.reminders);
  // This section only renders client-side (after settings load), so reading browser APIs here is safe.
  const [perm, setPerm] = useState<string>(() => (typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"));
  const save = async (next = r) => {
    try {
      await api.patch("/api/settings", { reminders: next });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Reminders updated");
    } catch (err) {
      toast.error(err);
    }
  };
  const enable = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === "granted") {
      const next = { ...r, enabled: true };
      setR(next);
      save(next);
    }
  };
  return (
    <Card>
      <CardTitle sub="Browser notifications while the app is open or installed to your home screen, only if that weigh-in is missing. Background push isn't supported, so the dashboard also shows a reminder banner.">
        <span className="inline-flex items-center gap-2">
          <Bell className="size-4" /> Weigh-in reminders
        </span>
      </CardTitle>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Morning">{(id) => <Input id={id} type="time" value={r.morning} onChange={(e) => setR({ ...r, morning: e.target.value })} className="w-32" />}</Field>
        <Field label="Night">{(id) => <Input id={id} type="time" value={r.night} onChange={(e) => setR({ ...r, night: e.target.value })} className="w-32" />}</Field>
        <label className="flex h-10 items-center gap-2 text-sm text-fg-2">
          <input type="checkbox" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} className="size-4 accent-[var(--accent)]" /> Enabled
        </label>
        <Button variant="secondary" onClick={() => save()}>
          Save
        </Button>
        {perm !== "granted" && perm !== "unsupported" && (
          <Button variant="ghost" onClick={enable}>
            Allow notifications
          </Button>
        )}
      </div>
      {perm === "denied" && <p className="mt-2 text-xs text-warning-text">Notifications are blocked for this site in your browser settings.</p>}
      {perm === "unsupported" && <p className="mt-2 text-xs text-muted">This browser doesn&apos;t support notifications.</p>}
    </Card>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    try {
      const t = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
  const apply = (t: "system" | "light" | "dark") => {
    setTheme(t);
    try {
      if (t === "system") {
        localStorage.removeItem("theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("theme", t);
        document.documentElement.dataset.theme = t;
      }
    } catch {
      document.documentElement.dataset.theme = t === "system" ? "" : t;
    }
  };
  return (
    <Card>
      <CardTitle>Appearance</CardTitle>
      <Segmented
        label="Theme"
        value={theme}
        onChange={apply}
        options={[
          { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" />System</span> },
          { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-3.5" />Light</span> },
          { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
        ]}
      />
    </Card>
  );
}

function DataSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const restore = async (file: File) => {
    const typed = window.prompt("Restoring replaces ALL current records (meals, weights, goals, settings) with the backup. Type REPLACE to continue.");
    if (typed !== "REPLACE") return;
    setRestoring(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/import?confirm=replace-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Restore failed");
      await qc.invalidateQueries();
      toast.success(`Restored ${data.restored.meals} meals and ${data.restored.weights} weigh-ins`);
    } catch (err) {
      toast.error(err);
    } finally {
      setRestoring(false);
    }
  };
  const links = [
    ["Weights (CSV)", "/api/export?type=weights"],
    ["Food log — one row per food (CSV)", "/api/export?type=meals"],
    ["Daily summary (CSV)", "/api/export?type=daily"],
    ["Full backup (JSON)", "/api/export?type=backup"],
    ["Full backup with photos (JSON)", "/api/export?type=backup&images=1"],
  ];
  return (
    <Card>
      <CardTitle sub="Your data stays in your own database. Exports include every record with full precision.">Export &amp; backup</CardTitle>
      <div className="flex flex-wrap gap-2">
        {links.map(([label, href]) => (
          <a key={href} href={href} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm text-fg hover:bg-surface-2" download>
            <Download className="size-4" /> {label}
          </a>
        ))}
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={restoring}>
          <Upload className="size-4" /> Restore from backup…
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0]).finally(() => (e.target.value = ""))} />
        <p className="mt-2 text-xs text-muted">Replaces all current records after a confirmation. Reference USDA foods are kept.</p>
      </div>
    </Card>
  );
}

function StatusRow({ ok, label, children }: { ok: boolean | "warn"; label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2">
      {ok === true ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" aria-label="OK" /> : ok === "warn" ? <XCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warning" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-label="Not configured" />}
      <div className="text-sm">
        <p className="font-medium text-fg">{label}</p>
        <div className="text-fg-2">{children}</div>
      </div>
    </li>
  );
}

function StatusSection({ data }: { data: SettingsResponse }) {
  const st = data.status;
  return (
    <Card>
      <CardTitle>
        <span className="inline-flex items-center gap-2">
          <Database className="size-4" /> System status
        </span>
      </CardTitle>
      <ul className="divide-y divide-line">
        <StatusRow ok={st.aiConfigured} label="AI (Claude)">
          {st.aiConfigured ? (
            <>
              Configured · model <code>{st.aiModel}</code>
            </>
          ) : (
            <>Not configured — set ANTHROPIC_API_KEY to enable text/photo analysis and the assistant.</>
          )}
        </StatusRow>
        <StatusRow ok={st.usdaFoods > 1000 ? true : "warn"} label="Food database">
          {st.usdaFoods.toLocaleString()} USDA foods stored locally{st.customFoods ? `, ${st.customFoods} custom` : ""}.
          {st.usdaFoods < 1000 && <> Run <code>npm run usda:import</code> to load ~13,000 reference foods; until then searches use the USDA API.</>}
          {st.fdcApiKeyIsDemo && <> Online lookups use the shared DEMO_KEY (heavily rate-limited) — add a free FDC_API_KEY.</>}
        </StatusRow>
        <StatusRow ok={st.authMode === "password" ? true : "warn"} label="Sign-in">
          {st.authMode === "password" ? "Password protected." : "Open (local development mode). Set APP_PASSWORD and SESSION_SECRET before deploying."}
        </StatusRow>
        <StatusRow ok label="Storage">
          {st.database === "postgres" ? "PostgreSQL" : "Embedded PostgreSQL (PGlite) on this machine"} · photos in {st.imageStorage === "s3" ? "S3-compatible storage" : "the database"}
        </StatusRow>
      </ul>
      {data.settings.isDemo && (
        <p className="mt-2">
          <Badge tone="warning">Demo database</Badge>
        </p>
      )}
    </Card>
  );
}

export function SettingsView() {
  const q = useSettings();
  if (!q.data) return q.error ? <ErrorBanner error={q.error} /> : null;
  const data = q.data;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card id="goals">
        <CardTitle sub="Leave a field blank for no goal. Calories, carbs and fat count as met within ±10%; protein when at or above the goal.">Daily nutrition goals</CardTitle>
        <GoalsForm data={data} key={JSON.stringify(data.goals)} />
        {data.goalHistory.length > 1 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-fg-2">Goal history ({data.goalHistory.length} versions)</summary>
            <ul className="mt-2 flex flex-col gap-1 text-fg-2 tabular">
              {[...data.goalHistory].reverse().map((g) => (
                <li key={g.effectiveFrom}>
                  {g.effectiveFrom === "2000-01-01" ? "Initial" : `From ${g.effectiveFrom}`}: {g.calories ?? "—"} kcal · P {g.protein ?? "—"} · C {g.carbs ?? "—"} · F {g.fat ?? "—"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      <WeightGoalsSection data={data} key={`w${data.settings.updatedAt}`} />
      <ProfileSection data={data} key={`p${data.settings.updatedAt}`} />
      <CategoriesSection data={data} />
      <RemindersSection data={data} />
      <AppearanceSection />
      <DataSection />
      <StatusSection data={data} />
    </div>
  );
}
