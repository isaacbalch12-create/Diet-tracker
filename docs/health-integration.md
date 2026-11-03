# Phone health integration (steps, sleep, heart rate)

## What is and isn't possible

Apple Health (HealthKit) and Android Health Connect are **on-device APIs that
only native apps can call**. A web app — even one installed to the home screen —
cannot request HealthKit or Health Connect permissions or read their data. So
this app does not show a fake "Connect Apple Health" button. Instead:

```
iPhone / Android                                  This app
┌──────────────────────────────┐   HTTPS POST    ┌───────────────────────────┐
│ Health data (HealthKit /      │ ──────────────► │ /api/ingest/health         │
│ Health Connect)               │  Bearer token   │  token → connection        │
│   ↓ read with your permission │                 │  scopes filter metrics     │
│ Exporter: iOS Shortcut,       │                 │  parse + validate          │
│ Health Auto Export app, or an │                 │  upsert (day, metric,      │
│ Android exporter              │                 │          source)           │
└──────────────────────────────┘                 └───────────────────────────┘
```

1. In the app, **Health → Connect phone** creates a *connection*: a name, a
   platform and the exact data types (scopes) it may send. You get a token
   once; only its SHA-256 hash is stored.
2. A phone-side exporter reads the data with the phone's own permission
   prompt and POSTs it to `https://<your-app>/api/ingest/health` with
   `Authorization: Bearer <token>`.
3. The server keeps one value per **day × metric × source**. A later sync for
   the same day replaces the earlier value (daily totals only grow during the
   day), so re-sending the same days never creates duplicates.

### Permissions

- **On the phone:** iOS asks for permission per data type the first time the
  Shortcut or exporter reads it. Manage or revoke it in *Settings → Health →
  Data Access & Devices*. On Android, Health Connect permissions are managed in
  the Health Connect app.
- **In this app:** each connection only accepts the scopes you chose; anything
  else is ignored and reported. Revoke a connection at any time (optionally
  deleting everything it sent). Request only what you use — steps and sleep by
  default.

### Sleep score

Apple Health does not expose a sleep score to other apps. A sleep score is
stored **only** when the payload supplies one together with the name of the
device or app that calculated it (e.g. Oura, Fitbit, Garmin, Whoop). A bare
number without a provider is rejected. The app never calculates a score.

### Multiple sources

If two sources report the same day (e.g. a manual entry and a phone sync), the
most recently synced value is shown and the others are listed as
alternatives — values from different sources are never added together. Sleep
samples from several devices are merged as a union of time intervals, so
overlapping iPhone/Watch samples are not double counted; stage minutes come
from the single source with the most staged sleep. A night is attributed to
the day you wake up.

## Option 1 — iOS Shortcut (free)

Create a Shortcut with these actions (names as they appear in the Shortcuts app):

1. **Find Health Samples** — Type: *Steps*; Start Date *is in the last 7 days*;
   Group By: *Day*. (Grouping by day returns the same de-duplicated daily
   totals the Health app shows.)
2. **Repeat with Each** item:
   - **Format Date** — *Start Date* of the Repeat Item, custom format `yyyy-MM-dd`.
   - **Dictionary** — `date` = Formatted Date, `value` = Repeat Item (quantity).
   - **Add to Variable** `StepDays`.
3. **Find Health Samples** — Type: *Sleep Analysis*; Start Date *is in the last 2 days*.
4. **Repeat with Each** item:
   - **Format Date** — Start Date → ISO 8601; another for End Date → ISO 8601.
   - **Dictionary** — `start`, `end` (the formatted dates), `stage` = Repeat
     Item *Value*, `source` = Repeat Item *Source*.
   - **Add to Variable** `SleepSamples`.
5. **Dictionary** — `steps` = StepDays, `sleepSamples` = SleepSamples.
6. **Get Contents of URL** — `https://<your-app>/api/ingest/health`, Method
   *POST*, Header `Authorization` = `Bearer <token>`, Request Body *JSON* =
   the dictionary from step 5.
7. Automate it: *Shortcuts → Automation → Time of Day* (e.g. 9:00 AM and
   9:00 PM) → *Run Immediately*.

Compare the synced step count once with the Health app to confirm the
Shortcut is set up correctly.

## Option 2 — Health Auto Export (iOS app, paid feature)

The *Health Auto Export – JSON+CSV* app can POST Apple Health data on a
schedule ("REST API" automation), including sleep stages.

- URL: `https://<your-app>/api/ingest/health`
- Header: `Authorization: Bearer <token>`
- Export format: **JSON**; **Aggregate data: Day** (important — daily totals)
- Metrics: Step Count, Sleep Analysis, and optionally Resting Heart Rate,
  Heart Rate Variability, Active Energy (only those your connection allows).

The app's JSON (`{"data":{"metrics":[…]}}`) is recognized automatically,
including both aggregated and unaggregated sleep analysis.

## Option 3 — Android Health Connect

Health Connect has no web API. Use a native exporter (an existing app that can
POST Health Connect data as JSON, an automation tool, or a small companion app)
to send the JSON format below.

## JSON format

```json
{
  "days": [
    {
      "date": "2026-11-02",
      "steps": 8123,
      "restingHeartRate": 54,
      "hrv": 61,
      "activeEnergy": 520,
      "sleep": { "asleepMinutes": 431, "inBedMinutes": 470, "deepMinutes": 62, "remMinutes": 95, "coreMinutes": 274, "awakeMinutes": 18 },
      "sleepScore": { "value": 84, "provider": "Oura" }
    }
  ],
  "steps": [{ "date": "2026-11-01", "value": 10234 }],
  "sleepSamples": [
    { "start": "2026-11-01T23:12:00-05:00", "end": "2026-11-02T01:05:00-05:00", "stage": "Asleep Core", "source": "Apple Watch" }
  ]
}
```

- Dates: `YYYY-MM-DD` for days; timestamps in ISO 8601 **with a UTC offset**.
- Numbers may be sent as numbers or numeric strings (`"8,123"`).
- Stage names are recognized in any common spelling (`In Bed`, `Asleep`,
  `Asleep Core`, `Deep`, `REM`, `Awake`, HealthKit raw values 0–5).
- Plausibility limits: steps 0–200,000; sleep ≤ 20 h per night; resting HR
  20–250 bpm; HRV 1–500 ms. Out-of-range values are rejected, never clamped.

Test with curl:

```bash
curl -X POST https://<your-app>/api/ingest/health \
  -H "Authorization: Bearer hk_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"steps":[{"date":"2026-11-02","value":8123}]}'
```

The response lists what was accepted and what was ignored, with reasons:

```json
{ "status": "ok", "format": "native", "accepted": 1, "days": ["2026-11-02"], "byMetric": { "steps": 1 }, "ignored": [] }
```

## Going native later

The ingest API is deliberately client-agnostic. A future native wrapper
(e.g. Capacitor or React Native with HealthKit and Health Connect plugins)
would read the same data with the platform's permission dialogs and post this
same JSON — no server changes needed.
