# Calculation definitions

All values are stored at full precision and rounded only for display. A
missing value is *unknown* — never zero.

## Food and meal nutrition

- Every food item stores **grams** (`quantity × gramsPerUnit`) and a
  **per-100 g nutrient profile**. An item's nutrients are
  `per100g × grams / 100`; meal and day totals are sums of item values
  (`src/lib/nutrition/calc.ts`).
- If some foods lack data for a nutrient (common for micronutrients and AI
  estimates), the total is the sum of the foods that report it and is marked
  **partial** (“+” in the UI).
- Editing a nutrient total for an item back-solves its per-100 g value, so
  changing the amount later scales the corrected value. Corrected nutrients
  are listed per item and the item is labelled **Manual**.
- Data source labels: **Database** (USDA FoodData Central or your custom
  food), **Restaurant data** (numbers published by the restaurant or brand,
  found by the AI's web lookup and checked by the app, with a link to the
  source page), **AI estimate** (no match), **Manual** (entered/corrected by
  you).
- Restaurant data is published per serving. The app stores it per 100 g,
  using the published serving weight, or the AI's estimate of it when none is
  published. So 1 serving always equals the published numbers, and 2 servings
  are exactly double. Gram amounts are converted only when the serving weight
  is published. The original AI estimate is kept with each item.

## Days, time zones and midnight

- Each meal and weigh-in stores the exact instant (UTC) **and** the local
  calendar day it belongs to, plus the time zone used.
- A meal's day is its local date in your time zone. With *Day starts at* set
  to e.g. 3 AM, food eaten between midnight and 3 AM counts toward the previous
  day.
- A **night** weigh-in recorded between midnight and 5 AM belongs to the
  previous day (you weighed in before bed, after midnight). Morning weigh-ins
  always use the calendar day. Both can be edited.
- Changing your time zone later does not move existing records.

## Weight

- **Daily average** = mean of that day's morning and night readings; with
  one reading it is that reading (marked partial).
- **Night − morning** = night minus morning on days with both.
- **7-day rolling average** = mean of daily averages over the trailing 7
  calendar days, shown only when ≥ 3 of those days have data.
- **Weekly / monthly average** = mean of daily averages for days with data
  in that calendar week (Monday or Sunday start, configurable) or month.
- **Change vs previous day** = latest daily average − the previous calendar
  day's average (blank if that day has no weigh-in).
- **Change vs previous week / month** = current 7-day average − the 7-day
  average 7 / 30 days earlier (rolling averages damp water-weight swings).
- **Since start** = current 7-day average (or latest daily average) − starting
  weight. **To target** = target − the same current value.
- **Trend** = least-squares line through daily averages in the selected range
  (≥ 5 days), reported per week. It describes the past; it is not a prediction.

## Nutrition statistics

- A **logged day** has at least one meal. Averages, highs/lows and adherence
  use logged days only; unlogged days are reported as missing.
- **Goals are versioned.** Saving goals creates a version effective from
  today; each day is judged against the version in force on that day, so
  history is never re-scored. The very first goals apply to all earlier days.
- **Goal met** rules: calories, carbohydrates and fat within ±10% of target;
  protein and other “minimum” nutrients (fiber, vitamins, minerals) at or above
  target; “limit” nutrients (sodium, saturated/trans fat, sugar, cholesterol)
  at or below the limit.
- **7-day average intake** (charts) = mean of logged days in the trailing 7
  days, shown when ≥ 3 are logged.
- **Week by week** = mean over logged days in each calendar week, with the
  change from the previous week.
- **Day-to-day variability** = mean absolute change in calories between
  consecutive logged days, and the standard deviation of daily calories.
- **Meal composition** = per category, total calories ÷ number of logged days,
  and share of all calories/protein.
- **Calorie trend** = least-squares slope of daily calories over logged days,
  per week.

## Weight ↔ intake

- Weeks are paired only if they have ≥ 4 logged food days and ≥ 3 weigh-in
  days.
- **Correlation** (Pearson r) between a week's average calories and the
  *following* week's change in average weight; reported as tentative with
  fewer than 6 paired weeks, and always described as an association.
- **Rough maintenance estimate** (needs ≥ 14 logged days and ≥ 10 weigh-in
  days): average calories − (weight trend per day × 7,700 kcal/kg). It assumes
  complete logging and is shown as a ballpark figure.

## Optional target suggestions

Mifflin–St Jeor resting energy × activity factor (1.2–1.725) for
maintenance; weight-loss options are −10% or −20% at most, never below
1,500 kcal (male equation) / 1,200 kcal (female equation). Protein 1.6 g/kg,
fat ~30% of calories, carbohydrates the remainder. Suggestions are only
applied if you choose to save them.

## Goals

Goal progress is computed on every read from the underlying records
(`src/lib/goals/engine.ts`); nothing is cached.

- **Periods.** Daily goals are judged per calendar day; weekly goals per week
  (your week start); monthly per calendar month; custom goals in blocks of *N*
  days anchored on the goal's start date. History covers up to the last 366
  days.
- **Targets over time.** Changing a target applies from today. Each period is
  judged against the target in force on its first day, so past results never
  change when you raise or lower a goal.
- **Combining days.** Sum (distance, steps, workouts, pages), average over days
  with data (calories, sleep), days meeting a daily threshold ("protein ≥ 150 g
  on 5 days a week"), latest level (7-day average weight, best lift so far),
  share of eligible days (running consistency) and weekly rate (weight trend:
  least-squares slope over the 21 days ending with the week; needs 6+ weigh-in
  days spanning 10+ days).
- **Status.** A past period is *met*, *missed* or *no data* (nothing recorded,
  e.g. no steps synced); the current period is *in progress* until an
  "at least" running total reaches its target. Paused spans and, for running
  goals, planned rest/recovery days are *excused*.
- **Streaks** count consecutive met periods; excused and paused periods are
  skipped (they neither break nor extend a streak) and the current period never
  breaks a streak while it's still open. **Success rate** = met ÷ (met +
  missed + no data) over completed periods.
- **Projection** (weekly/monthly sums and counts) = current value + daily pace
  × remaining days. It is labeled as an estimate.
- **Linked goals.** Daily nutrition targets use the same rules as the nutrition
  dashboard (calories, carbs, fat within ±10%; protein at or above; limits at
  or below). Target weight uses the 7-day average weight.

## Running

- A day is **done** when a run is logged and — if the daily goal has a minimum
  distance and the run has a distance — the day's total reaches it. A run
  logged without a distance counts as done (you said you ran). Below the
  minimum is **short**. A planned **rest** or **recovery** day is excused;
  a past day with nothing logged is **missed**; today is **pending**.
- **Streak:** consecutive done days; rest/recovery and today-pending are
  skipped. **Consistency** = done ÷ (done + short + missed), excluding planned
  days off and days before you started tracking.
- **Days without rest:** consecutive days with a run and no rest/recovery
  day. At 10+ the app suggests planning a recovery day.
- No pace or duration is stored or computed.

## Steps & sleep

- One value per day, metric and source; a later sync replaces the earlier
  value. When several sources report a day, the most recently synced one is
  shown and the others listed — never summed.
- Sleep from raw samples: samples within 3 hours of each other form a night;
  asleep time is the union of asleep intervals (core, deep, REM, unspecified)
  across sources; stage minutes come from the single source with the most
  staged sleep; the night belongs to the day you woke up.
- Averages use days with data only; trend is a least-squares slope per week
  (needs 7+ days).

## Routines

- A day's completion = completed required activities ÷ required activities
  that existed that day (`active_from` ≤ day < `archived_on`). Optional
  activities are tracked but don't affect the percentage.
- Reading/count activities complete automatically when the amount reaches the
  target; writing a journal entry completes that routine's journaling activity.
- Completion % over a range = fully complete days ÷ tracked days (today counts
  only once complete). Per-activity rate = days done ÷ days the activity was
  part of the routine.

## Insights

Generated from the last *N* days (`src/lib/services/insights.ts`). Each is
labeled *Measured*, *Estimate* or *Pattern*, and needs a minimum amount of data
(typically 5+ days; the sleep-vs-lifting comparison needs 4+ sessions after
both short and long nights). Cautions (very low intake, losing more than 1% of
body weight per week, 10+ days without rest, mostly maximal-effort runs) are
shown first.
