# Architecture

```
Browser (React client components, TanStack Query)
   │  JSON / NDJSON over same-origin fetch (session cookie)
   ▼
Next.js proxy (auth + origin check) → Route handlers (src/app/api/**)
   │                                    ▲
   │        Phone exporters ───────────┘ /api/ingest/health (bearer token, no session)
   │
   ├─ services/*  ── deterministic logic per area:
   │     meals, weights, stats, settings, export          (nutrition & body)
   │     training, liftlog-import                          (strength training)
   │     running, water, health                            (activity & phone data)
   │     routines, defaults                                (morning/night, journal)
   │     goals, insights, today                            (cross-area)
   ├─ training/*  ── pure strength math ported from LiftLog (1RM, sessions,
   │                 records replay, trends, plateaus, muscle volume)
   ├─ running/*   ── pure day classification, streaks, consistency
   ├─ health/*    ── payload parsers (native JSON, Health Auto Export), sleep merge
   ├─ goals/*     ── metric catalog + pure period/streak engine
   ├─ ai/*        ── Claude: meal analysis (tool loop) and assistant (tools)
   ├─ foods/*     ── USDA import, local full-text search, FDC API fallback
   └─ db/*        ── Drizzle ORM → PGlite (embedded) or PostgreSQL
```

## Unified data model

One PostgreSQL database holds every area. Calendar days are `YYYY-MM-DD`
strings computed in the user's time zone (with an optional late day boundary),
so a late snack, a night weigh-in after midnight and a workout all land on the
right day.

- **Nutrition & body:** `meals`, `meal_items`, `meal_images`, `meal_analyses`,
  `saved_meals`, `foods`, `weight_entries`, `goals` (versioned daily nutrition
  targets: the target in force on a day is the latest version on or before it).
- **Training:** `exercises` (built-ins keep LiftLog's stable ids such as
  `bi-barbell-bench-press`), `workouts` (local date, status, notes; no start/end
  times), `workout_exercises`, `workout_sets` (weight in kg at full precision),
  `workout_templates`.
- **Running:** `run_entries` — runs (distance in meters, type, effort 1–10,
  notes) and at most one rest/recovery marker per day (partial unique index).
- **Water:** `water_logs` (ml).
- **Phone health:** `health_connections` (hashed tokens + scopes),
  `health_daily` (one value per day × metric × source), `health_sync_events`.
- **Routines:** `routine_activities` (per slot, ordered, with `active_from` /
  `archived_on` so history is judged against the routine as it was),
  `mobility_routines`, `routine_logs`, `routine_templates`, `journal_entries`.
- **Goals:** `user_goals` (metric, params, comparator, target + target
  history, period, start/end, pauses) and `goal_checkins` for custom habits.

## Goals are computed, never stored

`services/goals.ts` loads only the data the active goals need, builds a
daily-value function per goal (`contextFor`), and `goals/engine.ts` splits the
goal's life into periods (daily/weekly/monthly/custom), aggregates (sum,
average, days meeting a threshold, latest level, share of days, weekly rate),
judges each period against the target that applied then, skips paused spans and
planned rest days, and derives streaks and success rates. Because nothing is
cached, logging or editing any record updates every goal on the next read.

The daily nutrition targets and target weight already live in their own
settings; they appear as *linked* goals (`nutrition:<key>`, `body:target_weight`)
so everything can be tracked in one list without two sources of truth.

## Strength statistics

Ported unchanged in spirit from LiftLog (`src/lib/training`), but keyed by local
dates instead of timestamps (each day is UTC-midnight milliseconds for
ordering, so results never depend on the server time zone). Records are derived
by replaying history, so editing or deleting a set corrects every record. The
workout editor autosaves the whole workout document (`PUT /api/workouts/:id`)
with client-generated ids, which makes saves idempotent.

## Logging a meal from text or a photo

1. The browser resizes photos (≤1568 px JPEG) and uploads them to
   `/api/images` (validated, stored in Postgres or S3).
2. `POST /api/analyze` with a client-generated `requestId`. A retry with the
   same id returns the stored analysis — no second AI call, no duplicate.
3. `runMealModel` (src/lib/ai/meal-analysis.ts) calls Claude with the photos and
   text, a fixed system prompt, a `search_foods` tool, a
   `lookup_restaurant_nutrition` tool and a JSON output schema. The restaurant
   tool (src/lib/ai/restaurant-lookup.ts) is a separate Claude request with
   the server-side web search tool (direct calls, so result URLs stay visible).
   It returns published per-serving values only when the cited page is one the
   search returned and the values pass range and calorie-vs-macro checks. A
   paused search turn (`pause_turn`) is resumed up to 3 times. It runs
   separately so that the meal analysis keeps its strict JSON output, and a web
   failure just means the item has no restaurant data.
4. `resolveItems` deterministically maps refs to database rows (`F…`) or
   verified restaurant facts (`R…`), takes nutrient values from them, falls
   back to the AI estimate only for unmatched items (labeled), and adds
   warnings for implausible values. Restaurant items are stored per 100 g,
   derived from the per-serving values, so n servings total exactly n × the
   published numbers.
5. The draft is stored in `meal_analyses` and shown for review. Saving calls
   `POST /api/meals` with its own idempotency key.

## Duplicate prevention

- Creates that can be retried (meals, workouts, runs, water) carry a
  client-generated `clientRequestId` with a unique index; a retry returns the
  original row.
- Health sync upserts on (day, metric, source); repeated syncs replace values.
- LiftLog import merges by original ids with newest-wins on `updatedAt`.
- Routine logs and journal entries are unique per (day, activity) and
  (day, slot).

## Assistant

`POST /api/assistant/chat` streams NDJSON events. The loop uses read-only tools
across every area (day, meals, nutrition/weight stats, rankings, comparisons,
training, exercise history, running, steps & sleep, routines, goals, insights).
`propose_action` stores a pending action that runs only after the user presses
Confirm.

## Failure handling

- AI unavailable / not configured / rate limited → typed, user-readable errors;
  manual logging keeps working.
- USDA API unavailable → local results plus a notice.
- Restaurant web lookup unavailable (web search not enabled, errors, nothing
  found) → the model is told, and falls back to USDA matches or labeled estimates.
- Health payloads: unusable items are ignored with reasons and recorded in the
  connection's sync log; an empty or invalid payload returns 422.
- All mutations validate input with zod; totals and goal progress are
  recomputed on every read.
