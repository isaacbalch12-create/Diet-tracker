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
  food), **AI estimate** (no database match), **Manual** (entered/corrected by
  you). The original AI estimate is kept with each item.

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
