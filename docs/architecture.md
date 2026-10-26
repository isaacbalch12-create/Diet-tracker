# Architecture

```
Browser (React client components, TanStack Query)
   │  JSON / NDJSON over same-origin fetch (session cookie)
   ▼
Next.js proxy (auth + origin check) → Route handlers (src/app/api/**)
   │
   ├─ services/*  ── deterministic logic: meals, weights, goals, stats, export
   ├─ ai/*        ── Claude: meal analysis (tool loop) and assistant (tools)
   ├─ foods/*     ── USDA import, local full-text search, FDC API fallback
   └─ db/*        ── Drizzle ORM → PGlite (embedded) or PostgreSQL
```

## Logging a meal from text or a photo

1. The browser resizes photos (≤1568 px JPEG) and uploads them to
   `/api/images` (validated, stored in Postgres or S3).
2. `POST /api/analyze` with a client-generated `requestId`. A retry with the
   same id returns the stored analysis — no second AI call, no duplicate.
3. `runMealModel` (src/lib/ai/meal-analysis.ts) calls Claude with the photos and
   text, a fixed system prompt, a `search_foods` tool and a JSON output schema.
   Claude batches searches; the tool returns local USDA candidates with short
   refs (`F1`, `F2`, …) and per-100 g macros and portions. Claude returns
   structured items: amount, unit, grams per unit, chosen ref (or none), its
   own per-100 g estimate, confidence, assumptions and clarifying questions.
4. `resolveItems` deterministically maps refs to database rows (refs not in
   the returned candidates are rejected), takes nutrient values from the
   database, falls back to the AI estimate only for unmatched items, and adds
   warnings for implausible values.
5. The draft is stored in `meal_analyses` and shown for review. Answers to
   clarifying questions re-run the analysis with the previous draft as context.
6. Saving calls `POST /api/meals` with its own idempotency key; the analysis is
   marked confirmed and the photos are attached to the meal.

## Assistant

`POST /api/assistant/chat` streams NDJSON events. The loop
(src/lib/ai/assistant.ts) uses read-only tools (`get_day`, `get_meals`,
`get_nutrition_stats`, `get_weight_stats`, `get_food_rankings`,
`compare_periods`, `get_goals_and_settings`,
`get_weight_nutrition_relationship`) that call the same services as the UI.
`propose_action` stores a pending action; only `POST /api/assistant/actions/:id`
with `decision: "confirm"` (the Confirm button) executes it. Conversation
history is stored verbatim and replayed append-only with a fixed system prompt
and tool list (prompt caching; thinking blocks stay valid). The date context
is placed in each user message, not the system prompt.

## Failure handling

- AI unavailable / not configured / rate limited → typed, user-readable errors;
  manual logging keeps working.
- USDA API unavailable → local results plus a notice.
- All mutations validate input with zod; totals are recomputed on every read,
  so edits and deletions are always reflected immediately.
