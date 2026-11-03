"use client";

import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Segmented } from "@/components/ui";
import { CodeBlock, CopyField } from "./copy";

export type GuideKey = "ios" | "hae" | "android" | "json";

export const PLATFORM_GUIDE: Record<string, GuideKey> = { ios_shortcut: "ios", health_auto_export: "hae", android: "android", other: "json" };

const TOKEN_PLACEHOLDER = "<your token>";

function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] break-words text-fg">{children}</code>;
}

function A({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-fg">{children}</strong>;
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-sm text-fg-2 marker:font-semibold marker:text-muted">{children}</ol>;
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <div className={tone === "warning" ? "flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-text" : "flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2"}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const SHORTCUT_BODY = `{
  "steps": [
    { "date": "2026-11-01", "value": 9412 },
    { "date": "2026-11-02", "value": 8123 }
  ],
  "sleepSamples": [
    {
      "start": "2026-11-01T23:12:00-05:00",
      "end": "2026-11-02T02:05:00-05:00",
      "stage": "Asleep Core",
      "source": "Apple Watch"
    }
  ]
}`;

export const EXAMPLE_PAYLOAD = `{
  "days": [
    {
      "date": "2026-11-02",
      "steps": 8123,
      "restingHeartRate": 54,
      "hrv": 61,
      "activeEnergy": 520,
      "sleep": {
        "asleepMinutes": 431,
        "inBedMinutes": 470,
        "deepMinutes": 62,
        "remMinutes": 95,
        "coreMinutes": 274,
        "awakeMinutes": 18
      },
      "sleepScore": { "value": 84, "provider": "Oura" }
    }
  ],
  "sleepSamples": [
    {
      "start": "2026-11-01T23:12:00-05:00",
      "end": "2026-11-02T06:41:00-05:00",
      "stage": "Asleep Core",
      "source": "Apple Watch"
    }
  ]
}`;

const HAE_EXAMPLE = `{
  "data": {
    "metrics": [
      {
        "name": "step_count",
        "units": "count",
        "data": [{ "date": "2026-11-02 00:00:00 -0500", "qty": 8123, "source": "iPhone" }]
      },
      {
        "name": "sleep_analysis",
        "units": "hr",
        "data": [{
          "date": "2026-11-02 00:00:00 -0500",
          "totalSleep": 7.18, "deep": 1.03, "rem": 1.58, "core": 4.57,
          "awake": 0.3, "inBed": 7.83,
          "sleepStart": "2026-11-01 23:12:00 -0500",
          "sleepEnd": "2026-11-02 06:41:00 -0500",
          "source": "Apple Watch"
        }]
      }
    ]
  }
}`;

const RESPONSE_EXAMPLE = `{
  "status": "partial",
  "format": "native",
  "accepted": 6,
  "days": ["2026-11-01", "2026-11-02"],
  "byMetric": { "steps": 2, "sleep": 1, "resting_hr": 1, "hrv": 1, "active_energy": 1 },
  "ignored": [
    { "item": "sleep_score 2026-11-02", "reason": "this connection is not allowed to write this kind of data (change it in Health → Connections)" }
  ]
}`;

function IosGuide({ endpoint }: { endpoint: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">
        Free, built into iPhone. The shortcut reads the last 7 days of steps and the last 2 nights of sleep from Apple Health and sends them here. Takes about 10 minutes to set up once.
      </p>
      <Steps>
        <li>
          Open the <A>Shortcuts</A> app, tap <A>+</A> to create a new shortcut and name it <C>Sync health</C>.
        </li>
        <li>
          Add the action <A>Find Health Samples</A>. Set <A>Type</A> to <C>Steps</C>, add the filter <A>Start Date</A> · <C>is in the last</C> · <C>7 days</C>, and set <A>Group By</A> to <C>Day</C> (this gives one daily total per day instead of hundreds of small samples).
        </li>
        <li>
          Add <A>Repeat with Each</A> (it repeats over the Health Samples). Inside the repeat:
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
            <li>
              <A>Format Date</A> — Date: <C>Repeat Item</C> → <C>Start Date</C>; Date Format: <C>Custom</C> with the format string <C>yyyy-MM-dd</C>.
            </li>
            <li>
              <A>Dictionary</A> with two items: key <C>date</C> = the <C>Formatted Date</C>; key <C>value</C> (type Number) = <C>Repeat Item</C> → <C>Value</C> (the step quantity).
            </li>
            <li>
              <A>Add to Variable</A> — Variable name <C>StepDays</C>.
            </li>
          </ul>
        </li>
        <li>
          After <A>End Repeat</A>, add another <A>Find Health Samples</A>: Type <C>Sleep Analysis</C>, filter <A>Start Date</A> · <C>is in the last</C> · <C>2 days</C>, no grouping.
        </li>
        <li>
          Add <A>Repeat with Each</A>. Inside it:
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
            <li>
              <A>Format Date</A>: <C>Repeat Item</C> → <C>Start Date</C>, format <C>ISO 8601</C> (turn on <A>Include Time</A>).
            </li>
            <li>
              A second <A>Format Date</A>: <C>Repeat Item</C> → <C>End Date</C>, format <C>ISO 8601</C> with time.
            </li>
            <li>
              <A>Dictionary</A>: <C>start</C> = first Formatted Date, <C>end</C> = second Formatted Date, <C>stage</C> = <C>Repeat Item</C> → <C>Value</C> (e.g. &ldquo;Asleep Core&rdquo;), <C>source</C> = <C>Repeat Item</C> → <C>Source</C>.
            </li>
            <li>
              <A>Add to Variable</A> — Variable name <C>SleepSamples</C>.
            </li>
          </ul>
        </li>
        <li>
          After <A>End Repeat</A>, add a final <A>Dictionary</A> with key <C>steps</C> = the <C>StepDays</C> variable and key <C>sleepSamples</C> = the <C>SleepSamples</C> variable.
        </li>
        <li>
          Add <A>Get Contents of URL</A>. URL: your endpoint (below). Tap <A>Show More</A>: Method <C>POST</C>; under <A>Headers</A> add <C>Authorization</C> with the value <C>Bearer {TOKEN_PLACEHOLDER}</C> (the word Bearer, a space, then your token); <A>Request Body</A> <C>JSON</C> containing that Dictionary.
          <p className="mt-1 text-xs text-muted">
            If your Shortcuts version only lets you add JSON fields one at a time, add a field <C>steps</C> (Array) set to <C>StepDays</C> and a field <C>sleepSamples</C> (Array) set to <C>SleepSamples</C> — it&apos;s the same JSON. Or choose Request Body <C>File</C>, pass the Dictionary, and add a header <C>Content-Type: application/json</C>.
          </p>
        </li>
        <li>
          Optional while testing: add <A>Show Result</A> after it to see the server&apos;s reply (how many values were accepted and why anything was ignored).
        </li>
        <li>
          Tap ▶ to run it once. iOS asks for Health permission <A>per data type</A> — allow only Steps and Sleep (and anything else you enabled). You can review or remove this later in iPhone <A>Settings → Health → Data Access &amp; Devices → Shortcuts</A>.
        </li>
        <li>
          Automate it: <A>Shortcuts → Automation → + → Time of Day</A>, e.g. <C>9:00 AM</C>, Repeat <C>Daily</C>, choose <A>Run Immediately</A>, and select <C>Sync health</C>. Add a second automation at <C>9:00 PM</C> so the day&apos;s steps are complete.
        </li>
      </Steps>
      <CopyField label="Endpoint URL" value={endpoint} />
      <CodeBlock label="What the shortcut sends (example)" code={SHORTCUT_BODY} />
      <Note>
        <p>
          <strong>Re-sending is safe.</strong> Each sync replaces that day&apos;s value from this connection — overlapping 7-day windows never create duplicates. Nights are assigned to the day you wake up, and overlapping samples from iPhone and Apple Watch are merged, not
          double-counted.
        </p>
        <p className="mt-1">After the first sync, compare one day&apos;s step count with the Health app. If it&apos;s much higher, check that Group By is set to Day.</p>
      </Note>
      <Note tone="warning">iPhone keeps Health data locked while the phone is locked, so an automation that fires while it&apos;s locked may send nothing. Pick times when you usually use your phone; the next run catches up on missed days.</Note>
    </div>
  );
}

function HaeGuide({ endpoint }: { endpoint: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">
        <A>Health Auto Export – JSON+CSV</A> is a third-party iPhone app. Its REST API automations are a paid premium feature. In return it sends sleep stages (deep, core, REM, awake) automatically and handles scheduling for you.
      </p>
      <Steps>
        <li>Install the app, open it and grant Health access for the data types you want to send (only those).</li>
        <li>
          Go to <A>Automations</A> → <A>+</A> (new automation) and choose <A>REST API</A>.
        </li>
        <li>
          <A>URL</A>: your endpoint (below).
        </li>
        <li>
          <A>Headers</A>: add a header named <C>Authorization</C> with the value <C>Bearer {TOKEN_PLACEHOLDER}</C>.
        </li>
        <li>
          <A>Data type</A>: Health Metrics. Select <C>Step Count</C> and <C>Sleep Analysis</C>, plus <C>Resting Heart Rate</C>, <C>Heart Rate Variability</C> or <C>Active Energy</C> only if you enabled them for this connection.
        </li>
        <li>
          <A>Export format</A>: <C>JSON</C>.
        </li>
        <li>
          <A>Aggregate data</A>: on, with interval <C>Day</C>. <strong>Important</strong> — this sends one daily total per metric instead of every individual sample.
        </li>
        <li>
          <A>Sync cadence</A>: e.g. every few hours, with a date range covering at least the last couple of days. Use <A>Manual export</A> once to test.
        </li>
      </Steps>
      <CopyField label="Endpoint URL" value={endpoint} />
      <CodeBlock label="What the app sends (abbreviated)" code={HAE_EXAMPLE} />
      <Note>Apple Health has no sleep score, so none is sent from this app. Background syncing depends on iOS allowing the app to run (Background App Refresh on, phone unlocked now and then).</Note>
    </div>
  );
}

function AndroidGuide({ endpoint }: { endpoint: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Note tone="warning">
        Health Connect is an on-device Android API. Browsers and web apps can&apos;t read it, and this app has no Android companion yet — you need a native exporter app or automation that reads Health Connect and POSTs JSON to your endpoint.
      </Note>
      <Steps>
        <li>Use an exporter/automation app (or a small app built with the Health Connect SDK) that can read Health Connect and send an HTTP POST with custom headers.</li>
        <li>Grant it Health Connect read permission only for the data types you enabled here (review it anytime in Android Settings — search for &ldquo;Health Connect&rdquo; → App permissions).</li>
        <li>
          Have it POST to your endpoint with the header <C>Authorization: Bearer {TOKEN_PLACEHOLDER}</C> and a JSON body in the format below, once or twice a day.
        </li>
      </Steps>
      <CopyField label="Endpoint URL" value={endpoint} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-1.5 pr-3 font-medium">Health Connect record</th>
              <th className="py-1.5 font-medium">JSON field (per day)</th>
            </tr>
          </thead>
          <tbody className="text-fg-2">
            {[
              ["StepsRecord (aggregated per day)", "days[].steps"],
              ["SleepSessionRecord total asleep", "days[].sleep.asleepMinutes"],
              ["Sleep stages DEEP / REM / LIGHT / AWAKE", "deepMinutes / remMinutes / coreMinutes / awakeMinutes"],
              ["RestingHeartRateRecord", "days[].restingHeartRate (bpm)"],
              ["HeartRateVariabilityRmssdRecord", "days[].hrv (ms; RMSSD, not SDNN)"],
              ["ActiveCaloriesBurnedRecord (per day)", "days[].activeEnergy (kcal)"],
            ].map(([a, b]) => (
              <tr key={a} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3">{a}</td>
                <td className="py-1.5 font-mono">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeBlock label="Request body" code={EXAMPLE_PAYLOAD} />
      <p className="text-xs text-muted">Instead of a nightly summary you can send raw sleep stages as sleepSamples (stage names like &ldquo;Deep&rdquo;, &ldquo;REM&rdquo;, &ldquo;Light&rdquo;, &ldquo;Awake&rdquo; are understood).</p>
    </div>
  );
}

function JsonGuide({ endpoint }: { endpoint: string }) {
  const curl = `curl -X POST "${endpoint}" \\
  -H "Authorization: Bearer hk_YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"days":[{"date":"2026-11-02","steps":8123,"sleep":{"asleepMinutes":431}}]}'`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">The app&apos;s own format, for any exporter or script. All fields are optional except each day&apos;s date; send only what you have.</p>
      <CodeBlock label="Example payload" code={EXAMPLE_PAYLOAD} />
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg-2">
        <li>
          <C>date</C> is the local calendar day <C>YYYY-MM-DD</C>. Timestamps need a UTC offset, e.g. <C>2026-11-01T23:12:00-05:00</C>. An optional top-level <C>&quot;timezone&quot;</C> (e.g. <C>America/Chicago</C>) is used for UTC (<C>Z</C>) timestamps.
        </li>
        <li>
          <C>sleep</C> describes the night that ends on <C>date</C> (the day you wake up). <C>asleepMinutes</C> is required; the other minutes are optional.
        </li>
        <li>
          <C>sleepSamples</C> are raw samples (<C>In Bed</C>, <C>Asleep</C>, <C>Asleep Core</C>, <C>Asleep Deep</C>, <C>Asleep REM</C>, <C>Awake</C>). They&apos;re merged into nights without double-counting overlaps. If a night arrives both as a summary and as samples, the samples win.
        </li>
        <li>
          <strong>A sleep score is accepted only with a named provider</strong> — <C>{`{"value": 84, "provider": "Oura"}`}</C>. A bare number is ignored. This app never calculates a score.
        </li>
        <li>Only data types enabled for the connection are stored; everything else is listed under &ldquo;ignored&rdquo; in the response. Implausible values are rejected (never clamped), and future dates are ignored.</li>
        <li>Sending the same day again replaces that day&apos;s value from this connection — no duplicates. Maximum payload 5 MB.</li>
        <li>Also accepted: flat lists <C>steps</C>, <C>restingHeartRate</C>, <C>hrv</C>, <C>activeEnergy</C> as <C>[{`{"date", "value"}`}]</C>, and <C>sleepScores</C> as <C>[{`{"date", "value", "provider"}`}]</C>.</li>
      </ul>
      <CodeBlock label="Test with curl" code={curl} />
      <Note tone="warning">A test writes real values for that date. Use a separate &ldquo;Test&rdquo; connection, then revoke it with &ldquo;also delete its data&rdquo; when you&apos;re done.</Note>
      <CodeBlock label="Response" code={RESPONSE_EXAMPLE} />
      <p className="text-xs text-muted">HTTP 200 when anything was accepted (status ok or partial), 422 when nothing was usable, 401 for a missing, unknown or revoked token.</p>
    </div>
  );
}

export function SetupGuides({ endpoint, guide, onGuide }: { endpoint: string; guide: GuideKey; onGuide: (g: GuideKey) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Segmented<GuideKey>
        label="Setup guide"
        size="sm"
        value={guide}
        onChange={onGuide}
        options={[
          { value: "ios", label: "iPhone Shortcut (free)" },
          { value: "hae", label: "Health Auto Export" },
          { value: "android", label: "Android" },
          { value: "json", label: "JSON & testing" },
        ]}
      />
      {guide === "ios" && <IosGuide endpoint={endpoint} />}
      {guide === "hae" && <HaeGuide endpoint={endpoint} />}
      {guide === "android" && <AndroidGuide endpoint={endpoint} />}
      {guide === "json" && <JsonGuide endpoint={endpoint} />}
    </div>
  );
}
