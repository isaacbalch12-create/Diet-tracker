# Momentum — nutrition, training, running, health & routines

One app for the whole picture: what you eat, what you weigh, how you train,
your daily run, steps and sleep from your phone, your morning and nightly
routines, and the goals that tie them together. It merges two earlier apps —
the **Diet Tracker** (this repository) and **LiftLog** (the workout tracker) —
into one product with shared goals, dashboard, statistics and navigation.

- **Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Recharts ·
  PostgreSQL via Drizzle ORM (embedded PGlite or any hosted Postgres) ·
  Anthropic Claude API · USDA FoodData Central.
- **Single-user:** password login, all data in your own database.

| Area | What it does |
| --- | --- |
| **Today** | Customizable dashboard: weight, calories & macros, water, workout, run, steps, sleep, morning/nightly routine progress, goal progress, insights and a chronological activity log. Reorder or hide sections and choose the overview metrics. |
| **Goals** | Any number of goals per area — nutrition (any nutrient, water), body (target weight, weekly rate, weigh-in consistency), exercise (workouts/week, estimated 1RM, weight × reps, sets/reps/volume, PRs), running (run every day, distance, run days, consistency), health (steps, sleep, sleep score when provided, resting HR, HRV), routines (completion, reading, journaling, mobility) and custom habits. Daily, weekly, monthly or custom periods; start/end dates; pause/resume; streaks; full history. Progress is computed live from your records, so every log updates every goal. Target changes apply from today — history keeps the targets it had. |
| **Nutrition** | Everything from the Diet Tracker: describe a meal or snap a photo; Claude identifies foods and portions, USDA data supplies nutrients, totals are computed deterministically; AI estimates are labeled and editable; daily dashboard with remaining calories/macros; history; analytics. |
| **Weight** | Morning and night weigh-ins, daily average, 7-day rolling average, trend, fluctuation, weekly/monthly averages. |
| **Training** | Everything from LiftLog except time tracking: fast set logging (weight, reps, optional RPE, warm-ups, notes) with last session's numbers beside every set, templates, repeat a workout, log past workouts, 100+ built-in exercises plus custom ones, per-exercise history and charts, estimated 1RM trends and plateau checks, rep records, personal records, weekly/monthly volume and muscle-group breakdowns. **No timers, durations or rest timers.** |
| **Running** | Daily running focused on consistency and distance (no pace or duration): log completion, distance, type, effort and notes; planned rest and recovery days never break a streak; streaks, consistency %, weekly/monthly distance, progression charts, records, recovery cautions. |
| **Steps & sleep** | Apple Health / Health Connect data via a token-protected sync endpoint (iOS Shortcut, Health Auto Export, or an Android exporter) plus manual entry: steps, sleep duration and stages, sleep score only when a connected source supplies one, resting HR, HRV, active energy — with source and last-sync time on every value. See [docs/health-integration.md](docs/health-integration.md). |
| **Routines & journal** | Separate morning and nightly routines (defaults: stretching & mobility, reading, journaling), fully editable: add/remove/reorder activities, required vs optional, numeric targets, mobility routine library, journal prompts, routine templates. Daily checklist, completion %, streaks, per-activity consistency. Journal with prompts, free writing and browsing by date. |
| **Analytics** | Tabs for Overview (labeled insights + daily/weekly/monthly summaries), Nutrition & body, Strength, Running, Steps & sleep and Routines, with 7D/30D/90D/6M/1Y/All filters. |
| **AI assistant** | Answers questions across all areas using read-only tools over your data; proposes changes you confirm. |

### Principles

- **Nothing is invented.** Missing days are gaps, not zeros. Thin data is
  reported as "not enough data". A sleep score is shown only with the name of
  the device that produced it.
- **Measured vs estimated vs observed.** Insights and statistics carry a label:
  *Measured* (counts of what you logged/synced), *Estimate* (model-based, e.g.
  estimated 1RM, maintenance calories) or *Pattern* (an association, not a cause).
- **Recovery counts.** Rest/recovery days are first-class; the app warns about
  long stretches without rest, very low intake or very fast weight loss, and
  never encourages pushing through pain.

## Moving your data into the unified app

- **Diet Tracker data** is preserved automatically: the unified schema only
  *adds* tables and columns (migration `0001_unified_tracker`). Existing meals,
  weigh-ins, goals (with their version history), photos, saved meals and
  assistant history are untouched.
- **LiftLog data** lives in your phone's browser (IndexedDB), so it can't be
  read by a server directly. In LiftLog open **Settings → Backup (JSON)**, then
  in this app open **Settings → Import workouts from LiftLog** and choose the
  file. The import merges by LiftLog's own ids: importing the same file twice
  changes nothing, and a newer backup updates only workouts edited since
  (newest copy wins; workouts edited here are never overwritten by an older
  copy). Exercises (including custom ones and favorites), templates, warm-up
  flags, RPE, notes and record celebrations come across; workout durations,
  rest timers and set completion times are intentionally not imported as
  features (the original timestamps are kept as provenance metadata only).
  Your LiftLog weekly target becomes a "Work out N× per week" goal.

## Quick start (local)

Requirements: Node.js 20.9+ (22 recommended).

```bash
npm install
cp .env.example .env.local        # then fill in what you need (all optional locally)
npm run usda:import               # one-time: stores ~13,000 USDA foods locally (~25 s)
npm run dev                       # http://localhost:3000
```

With no configuration the app runs with an **embedded PostgreSQL database**
(PGlite) in `./data/pglite`, no login (development only), and without AI
features. Add `ANTHROPIC_API_KEY` to `.env.local` to enable photo/text
analysis and the assistant.

Want to look around first? `npm run demo` creates a separate, clearly labelled
demo database (`./data/pglite-demo`, ~90 days of sample meals, weigh-ins,
workouts, runs, synced steps & sleep, routines and goals) and starts the app on
it. It never touches your real data.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `APP_PASSWORD` | production | Password for the single-user login. Without it (and `SESSION_SECRET`) a production server refuses to serve. |
| `SESSION_SECRET` | production | 32+ random characters used to sign the session cookie (`openssl rand -base64 48`). |
| `ANTHROPIC_API_KEY` | for AI | Enables text/photo meal analysis and the assistant. Get one at [console.anthropic.com](https://console.anthropic.com/). |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5-5`. |
| `ANTHROPIC_FALLBACKS` | no | Server-side refusal fallback is on by default; set `off` if a gateway rejects it. |
| `FDC_API_KEY` | recommended | Free [USDA API key](https://fdc.nal.usda.gov/api-key-signup) for online lookups (branded products, foods not in the local copy). Without it the shared, heavily rate-limited `DEMO_KEY` is used. |
| `DATABASE_URL` | hosted deploys | PostgreSQL connection string. Empty = embedded database in `PGLITE_DIR`. On Netlify, `NETLIFY_DB_URL` (set automatically by Netlify Database) is used instead. |
| `PGLITE_DIR` | no | Embedded database folder (default `./data/pglite`). |
| `AUTO_MIGRATE` | no | `true` to apply migrations on startup when using `DATABASE_URL`. |
| `DATABASE_PREPARE` | no | Leave `false` for transaction-mode poolers (Supabase pooler, PgBouncer). |
| `IMAGE_STORAGE` | no | `db` (default, photos stored in Postgres) or `s3` (any S3-compatible bucket; set `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). |

All secrets are read only on the server; nothing is exposed to the browser.

## Database and migrations

- Schema: `src/lib/db/schema.ts`; SQL migrations: `drizzle/`, mirrored into
  `netlify/database/migrations/` for Netlify Database.
- **Embedded (PGlite):** migrations run automatically on startup.
- **PostgreSQL:** run `npm run db:migrate` (with `DATABASE_URL` set) once per
  deploy, or set `AUTO_MIGRATE=true`.
- **Netlify Database:** every deploy applies `netlify/database/migrations/`
  before it is published. Never run `db:migrate` against `NETLIFY_DB_URL`.
- After changing the schema: `npm run db:generate` creates a new migration and
  copies it into `netlify/database/migrations/` (a unit test checks both
  folders match). Never edit a migration that has already been deployed.

Tables: `settings`, `goals` (versioned daily nutrition targets), `weight_entries`,
`meals`, `meal_items`, `meal_images`, `meal_analyses` (AI drafts),
`saved_meals`, `foods` (USDA + custom), `chat_conversations`,
`chat_messages`, `assistant_actions`; training: `exercises`, `workouts`,
`workout_exercises`, `workout_sets`, `workout_templates`; running:
`run_entries`; `water_logs`; phone health: `health_connections`,
`health_daily`, `health_sync_events`; routines: `routine_activities`,
`mobility_routines`, `routine_logs`, `routine_templates`, `journal_entries`;
goals: `user_goals`, `goal_checkins`.

## Nutrition data (USDA FoodData Central)

`npm run usda:import` downloads two official USDA datasets (cached in
`./data/usda`) and upserts them into the `foods` table:

- **FNDDS survey foods** (~5,400 “as eaten” foods with household portions
  like “1 large egg = 50 g”),
- **SR Legacy** (~7,800 reference foods).

Search is local full-text search (fast, offline, no rate limits). If local
results are thin, or you search branded products, the app queries the USDA
API and caches the results. You can also create custom foods from a nutrition
label. To load the foods into a hosted database, either run the import with
`DATABASE_URL` set, or sign in and use **Settings → Load USDA food database**
(also offered on the food search tab while the database is empty). The button
imports one dataset per request so each stays well under serverless time
limits; it is safe to run again (existing foods are updated, not duplicated).

## AI setup (Claude)

1. Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`).
2. Restart. **Settings → System status** shows whether AI is configured.

On Netlify (credit-based plans) no key is needed: Netlify AI Gateway injects
`ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` into functions automatically and
bills usage in Netlify credits. Setting your own `ANTHROPIC_API_KEY` in the
project's environment variables takes precedence over the gateway.

How the AI is used — and what it is *not* trusted with:

- **Meal analysis** (text or up to 4 photos): Claude splits the meal into
  foods, estimates portions in grams, and calls a `search_foods` tool against
  the USDA database to pick matches. The server then takes nutrient values from
  the matched database rows and computes all totals itself. Only foods without
  a database match use the model's per-100 g estimate, and they are labelled
  **AI estimate**. Implausible matches (database vs. estimate differ >2.5×) are
  flagged for review. When portions, oils or ingredients materially change the
  estimate, Claude asks up to 3 short clarifying questions.
- **Nothing is saved until you confirm** the draft (unless you tick *Quick
  save*). Requests carry an idempotency key, so a retried request returns the
  existing result instead of creating duplicates.
- **Assistant:** answers questions by calling read-only tools over your data
  (daily summaries, statistics, rankings, period comparisons, weight vs.
  intake, training, running, steps & sleep, routines, goals and insights). It can only *propose* changes (log a weight, update goals, delete an
  entry); they run after you press **Confirm**.

The app uses adaptive thinking with `effort: medium`, prompt caching, and the
server-side refusal fallback. Each meal analysis is typically a few model
calls (search → final answer); photo analysis costs more input tokens.

## Authentication & security

- Single-user password login (`APP_PASSWORD`), HS256-signed HTTP-only
  `SameSite=Lax` session cookie (30 days), login rate limiting, and an
  origin check on all state-changing API requests.
- Production refuses to run without `APP_PASSWORD` + `SESSION_SECRET`.
- Uploaded photos are validated by magic bytes (JPEG/PNG/WebP/GIF, ≤5 MB after
  in-browser resizing), served only to the signed-in user with
  `Content-Security-Policy: default-src 'none'`.
- CSV exports neutralize spreadsheet formula injection.
- The health sync endpoint (`/api/ingest/health`) authenticates with a
  per-connection bearer token (stored as a SHA-256 hash), accepts only the
  data types the connection allows, and can be revoked instantly.

## Deployment

### Option A — your own server (simplest; embedded database)

```bash
npm ci && npm run build
APP_PASSWORD=… SESSION_SECRET=… ANTHROPIC_API_KEY=… npm start   # port 3000
npm run usda:import    # once
```

Put it behind HTTPS (Caddy, nginx, Cloudflare Tunnel…) and back up
`./data/` (or use *Settings → Export & backup*). A `Dockerfile` and
`docker-compose.yml` are included (`docker compose up -d --build`, data in
`./data`).

### Option B — Netlify + Netlify Database

The repo is ready for Netlify: `netlify.toml` sets the build, Netlify's
Next.js runtime is applied automatically, and `@netlify/database` in
`package.json` makes Netlify provision a Postgres database and apply
`netlify/database/migrations/` on each deploy (requires a credit-based
Netlify plan).

1. Create a Netlify project from this repository (or `netlify init`).
2. In *Project configuration → Environment variables* add `APP_PASSWORD`,
   `SESSION_SECRET` (mark both secret), and `ANTHROPIC_API_KEY` /
   `FDC_API_KEY` when you have them. Scopes must include Functions.
3. Deploy. Environment variable changes only take effect after the next
   deploy (*Deploys → Trigger deploy*).
4. Sign in and click **Settings → Load USDA food database** once.

Netlify notes: synchronous functions stop after 60 s, so very long AI
analyses can time out (retry, or use a shorter description); request bodies
are limited to 6 MB. Photos are resized in the browser and uploaded one at a
time (5 MB cap each), but a backup that contains many photos may be too large
to restore through the browser.

### Option C — Vercel (or any serverless host) + hosted PostgreSQL

1. Create a Postgres database (Supabase, Neon, …) and copy its connection
   string (for Supabase use the pooler URL; keep `DATABASE_PREPARE=false`).
2. Locally: `DATABASE_URL=… npm run db:migrate && DATABASE_URL=… npm run usda:import`.
3. Import the repo in Vercel and set `DATABASE_URL`, `APP_PASSWORD`,
   `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `FDC_API_KEY` (and S3 settings if you
   prefer bucket storage for photos).
4. AI routes declare `maxDuration = 300`; make sure your plan allows long
   enough function durations (analysis usually takes 10–40 s).

The embedded database is refused on serverless platforms because their disks
are ephemeral.

## Testing

```bash
npm test             # unit/integration tests (Vitest, in-memory PostgreSQL)
npm run test:e2e     # Playwright: production build + fresh database + real browser
E2E_DATABASE_URL=postgres://…/empty_db npm run test:e2e   # same suite on PostgreSQL
npm run lint && npm run typecheck
```

Coverage includes: nutrient math and precision, partial-data handling,
time zones and late-night meals, DST, weight statistics (rolling/weekly/monthly
averages, trends, missing days), goal versioning, adherence, correlations,
meal create/edit/delete → daily totals, idempotent retries, USDA parsing and
search ranking, backup/restore, the AI tool loop and database resolution (with
a scripted model client), the assistant's confirm-before-change flow, image
validation, auth, and full UI flows in a browser.

## Project structure

```
src/
  app/                 Next.js routes: (app)/ pages, login, api/ route handlers
  views/               Page-level client components (dashboard, log, weight, …)
  components/          UI primitives, charts, item editor, food search, …
  lib/
    nutrition/         nutrients, deterministic calculator, goals, target suggestions
    weight/stats.ts    weight statistics
    analytics/         nutrition summary, weight ↔ intake relationship
    ai/                Claude client, meal analysis, assistant + tools
    foods/             USDA parsing/import, local search, FDC API client
    services/          meals, weights, settings/goals, stats, analysis, images, export
    db/                Drizzle schema + driver selection (PGlite / Postgres)
    time.ts, units.ts  calendar-date and unit helpers
scripts/               usda:import, db:migrate, demo seeding
drizzle/               SQL migrations
tests/unit, tests/e2e
docs/                  calculations and architecture notes
```

See [docs/calculations.md](docs/calculations.md) for exact definitions of
every statistic and [docs/architecture.md](docs/architecture.md) for the data
flow.

## Features

- **Weight:** morning/night weigh-ins (lb or kg, editable time and day),
  daily average and night−morning change, changes vs. previous day/week/month,
  since start and to target, 7-day rolling average, linear trend, weekly and
  monthly averages, fluctuation chart, gaps shown as gaps, edit/delete, ranges
  7d/30d/90d/6m/1y/all.
- **Food logging:** plain-English descriptions, photos (multi-photo, camera
  capture, in-browser resize/HEIC conversion where supported), database search,
  manual label entry, custom foods, saved favorites, recent meals, duplicate,
  custom meal categories, back-dated entries, clarifying questions, per-item
  editing of foods, amounts, units/portions and every nutrient, re-matching to a
  different database entry, quick-save option.
- **Nutrition tracking:** calories, protein, carbs, fat plus saturated/trans
  fat, fiber, sugar, sodium, cholesterol, potassium, calcium, iron, magnesium,
  zinc and vitamins A, C, D, B12 and folate. Each food is labelled
  *Database*, *AI estimate* or *Manual*, keeps its USDA reference, the original
  AI estimate, confidence and assumptions.
- **Dashboard:** totals vs. goals with remaining amounts, macro progress,
  weigh-ins, chronological meal timeline, biggest calorie/protein contributors,
  all-nutrient view, date navigation, missing-weigh-in banner.
- **Analytics:** averages (all nutrients), highs/lows, meals per day, goal
  adherence, % days meeting all macro goals, week-over-week table, day-to-day
  variability, meal-category composition, logging streaks, calorie and macro
  trends, weight vs. calories and weekly averages (stacked, synchronized
  charts), caveated observations, preset and custom ranges with data
  completeness. Every chart has a table view.
- **Assistant:** streaming chat over your data with confirm-gated changes.
- **Settings:** versioned goals, optional target calculator with stated
  assumptions, extra nutrient targets, units, time zone, day-start hour,
  week start, categories, reminders, theme, CSV exports, full JSON backup and
  restore.
- Responsive layout with mobile bottom navigation, dark/light themes, PWA
  manifest (add to home screen).

## Limitations and things that need configuration

- **AI features require `ANTHROPIC_API_KEY`** (or Netlify AI Gateway).
  Without it, logging works via database search and manual entry; the AI paths
  show a clear message. The AI pipeline is covered by automated tests with a
  scripted model client (tool loop, validation, database resolution,
  idempotency, confirmations); live text analysis was checked on the Netlify
  deployment through AI Gateway, but photo analysis and the assistant have
  not yet been exercised against the live API.
- **USDA data must be imported once** (`npm run usda:import`, or the
  *Load USDA food database* button in Settings); otherwise searches rely on
  the rate-limited USDA API.
- **Reminders** are browser notifications while the app (or installed PWA) is
  open; true background push notifications are not implemented.
- Single user only; no multi-account support.
- Photo-based portion estimates are inherently approximate; they are labelled
  as estimates with confidence levels and should be reviewed.
- Micronutrient totals are only as complete as the underlying foods; AI
  estimates usually include only a few nutrients, and totals are marked partial.
- The Dockerfile was not built in the development environment (no Docker
  daemon available); the app itself was verified with `next build`/`next start`.

Nutrition estimates and suggestions are informational and not medical advice.
