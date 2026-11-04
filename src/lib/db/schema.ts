import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { NutrientKey, NutrientProfile } from "../nutrition/nutrients";

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export type WeightPeriod = "morning" | "night";
/** "restaurant": published by the restaurant or brand, found by the AI's web lookup and verified by the app. */
export type NutrientSource = "database" | "restaurant" | "ai_estimate" | "manual";
export type QuantitySource = "user_stated" | "ai_estimate" | "manual";
export type Confidence = "high" | "medium" | "low";
export type MealSource = "text" | "photo" | "manual" | "saved_meal" | "copy" | "assistant";

export interface Portion {
  label: string;
  grams: number;
}

export interface FoodSourceRef {
  provider: "usda" | "custom" | "restaurant";
  fdcId?: string;
  dataType?: string;
  description: string;
  /** Source page for restaurant data. */
  url?: string;
}

export interface Reminders {
  enabled: boolean;
  morning: string; // HH:mm
  night: string; // HH:mm
}

export const DEFAULT_MEAL_CATEGORIES = ["Breakfast", "Lunch", "Dinner", "Snack"];
export const DEFAULT_RUN_TYPES = ["Easy", "Long", "Tempo", "Intervals", "Hills", "Recovery jog", "Trail", "Treadmill", "Race"];

/** Dashboard sections, in default order. Users can reorder and hide them. */
export const DASHBOARD_SECTIONS = ["overview", "goals", "nutrition", "training", "running", "health", "routines", "insights", "timeline"] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

/** Daily overview tiles. Users choose which appear and in which order. */
export const OVERVIEW_TILES = ["weight", "calories", "macros", "water", "workout", "run", "steps", "sleep", "morning", "night"] as const;
export type OverviewTile = (typeof OVERVIEW_TILES)[number];

export interface DashboardPrefs {
  order: DashboardSection[];
  hidden: DashboardSection[];
  tiles: OverviewTile[];
  /** Virtual goals (e.g. primary nutrition targets) hidden from the dashboard. */
  hiddenGoalIds: string[];
}

export const DEFAULT_DASHBOARD: DashboardPrefs = {
  order: [...DASHBOARD_SECTIONS],
  hidden: [],
  tiles: [...OVERVIEW_TILES],
  hiddenGoalIds: [],
};

/** Singleton row (id = 1) with user preferences. */
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    weightUnit: text("weight_unit").$type<"kg" | "lb">().notNull().default("lb"),
    timezone: text("timezone").notNull().default("UTC"),
    dayStartHour: integer("day_start_hour").notNull().default(0),
    weekStartsOn: integer("week_starts_on").notNull().default(1),
    startingWeightKg: doublePrecision("starting_weight_kg"),
    startingWeightDate: date("starting_weight_date", { mode: "string" }),
    targetWeightKg: doublePrecision("target_weight_kg"),
    mealCategories: jsonb("meal_categories").$type<string[]>().notNull().default(DEFAULT_MEAL_CATEGORIES),
    reminders: jsonb("reminders").$type<Reminders>().notNull().default({ enabled: false, morning: "07:30", night: "22:00" }),
    isDemo: boolean("is_demo").notNull().default(false),
    onboarded: boolean("onboarded").notNull().default(false),
    /** Training preferences (carried over from the LiftLog workout tracker). */
    distanceUnit: text("distance_unit").$type<"mi" | "km">().notNull().default("mi"),
    waterUnit: text("water_unit").$type<"oz" | "ml">().notNull().default("oz"),
    oneRmFormula: text("one_rm_formula").$type<"epley" | "brzycki">().notNull().default("epley"),
    maxRepsFor1rm: integer("max_reps_for_1rm").notNull().default(12),
    showRpe: boolean("show_rpe").notNull().default(false),
    runTypes: jsonb("run_types").$type<string[]>().notNull().default(DEFAULT_RUN_TYPES),
    dashboard: jsonb("dashboard").$type<DashboardPrefs>().notNull().default(DEFAULT_DASHBOARD),
    /** Default goals and routines are created once; deleting them later is respected. */
    defaultsSeeded: boolean("defaults_seeded").notNull().default(false),
    /** Version of the default routines last applied; bumped when the defaults change. */
    defaultsVersion: integer("defaults_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("settings_singleton", sql`${t.id} = 1`)],
);

/**
 * Versioned nutrition goals. The goal that applies to a day is the row with the
 * latest `effective_from` on or before that day, so editing goals never changes
 * how past days are judged.
 */
export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull().unique(),
  calories: doublePrecision("calories"),
  protein: doublePrecision("protein"),
  carbs: doublePrecision("carbs"),
  fat: doublePrecision("fat"),
  /** Optional targets for other nutrients. */
  extra: jsonb("extra").$type<Partial<Record<NutrientKey, number>>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const weightEntries = pgTable(
  "weight_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    period: text("period").$type<WeightPeriod>().notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true, mode: "date" }).notNull(),
    timezone: text("timezone").notNull(),
    /** Canonical value, full precision. */
    weightKg: doublePrecision("weight_kg").notNull(),
    /** What the user actually typed, for audit/display fidelity. */
    inputValue: doublePrecision("input_value").notNull(),
    inputUnit: text("input_unit").$type<"kg" | "lb">().notNull(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("weight_entries_day_period_uq").on(t.localDate, t.period),
    check("weight_entries_period_ck", sql`${t.period} in ('morning', 'night')`),
    check("weight_entries_positive_ck", sql`${t.weightKg} > 0`),
  ],
);

/** Reference foods: USDA FoodData Central imports/cache plus user-created foods. */
export const foods = pgTable(
  "foods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").$type<"usda" | "custom">().notNull(),
    dataType: text("data_type").notNull(),
    externalId: text("external_id"),
    description: text("description").notNull(),
    brand: text("brand"),
    category: text("category"),
    nutrientsPer100g: jsonb("nutrients_per_100g").$type<NutrientProfile>().notNull(),
    portions: jsonb("portions").$type<Portion[]>().notNull().default([]),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(description, '') || ' ' || coalesce(brand, ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("foods_source_external_uq").on(t.source, t.externalId),
    index("foods_search_idx").using("gin", t.searchVector),
  ],
);

export const meals = pgTable(
  "meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    eatenAt: timestamp("eaten_at", { withTimezone: true, mode: "date" }).notNull(),
    timezone: text("timezone").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    /** The original plain-English description, if any. */
    description: text("description"),
    source: text("source").$type<MealSource>().notNull(),
    analysisId: uuid("analysis_id"),
    /** Client-generated id; a retried save with the same id returns the existing meal. */
    clientRequestId: text("client_request_id").unique(),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("meals_local_date_idx").on(t.localDate, t.eatenAt)],
);

export const mealItems = pgTable(
  "meal_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealId: uuid("meal_id")
      .notNull()
      .references(() => meals.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    name: text("name").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    unit: text("unit").notNull(),
    gramsPerUnit: doublePrecision("grams_per_unit").notNull(),
    nutrientsPer100g: jsonb("nutrients_per_100g").$type<NutrientProfile>().notNull(),
    nutrientSource: text("nutrient_source").$type<NutrientSource>().notNull(),
    quantitySource: text("quantity_source").$type<QuantitySource>().notNull(),
    /** Nutrients the user overrode by hand. */
    manualNutrients: jsonb("manual_nutrients").$type<NutrientKey[]>().notNull().default([]),
    foodId: uuid("food_id").references(() => foods.id, { onDelete: "set null" }),
    sourceRef: jsonb("source_ref").$type<FoodSourceRef | null>(),
    confidence: text("confidence").$type<Confidence | null>(),
    cookingMethod: text("cooking_method"),
    isAssumed: boolean("is_assumed").notNull().default(false),
    notes: text("notes"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    portions: jsonb("portions").$type<Portion[]>().notNull().default([]),
    /** Snapshot of the original AI estimate, kept for review after corrections. */
    aiOriginal: jsonb("ai_original").$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("meal_items_meal_idx").on(t.mealId, t.position),
    check("meal_items_quantity_ck", sql`${t.quantity} > 0 and ${t.gramsPerUnit} > 0`),
  ],
);

/**
 * AI analyses of a description or photos. Nothing here counts toward totals until
 * the user confirms the draft, which creates a `meals` row.
 */
export const mealAnalyses = pgTable("meal_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Client-generated idempotency key: a retried request returns this row instead of re-running. */
  requestId: text("request_id").notNull().unique(),
  inputType: text("input_type").$type<"text" | "photo">().notNull(),
  inputText: text("input_text"),
  imageIds: jsonb("image_ids").$type<string[]>().notNull().default([]),
  status: text("status").$type<"pending" | "completed" | "failed" | "confirmed" | "discarded">().notNull(),
  /** Normalized draft (items with resolved nutrients, questions, notes). */
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  answers: jsonb("answers").$type<{ question: string; answer: string }[]>().notNull().default([]),
  error: text("error"),
  model: text("model"),
  usage: jsonb("usage").$type<Record<string, number> | null>(),
  mealId: uuid("meal_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mealImages = pgTable(
  "meal_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealId: uuid("meal_id").references(() => meals.id, { onDelete: "set null" }),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    storage: text("storage").$type<"db" | "s3">().notNull(),
    storageKey: text("storage_key"),
    data: bytea("data"),
    createdAt: createdAt(),
  },
  (t) => [index("meal_images_meal_idx").on(t.mealId)],
);

export interface SavedMealItem {
  name: string;
  quantity: number;
  unit: string;
  gramsPerUnit: number;
  nutrientsPer100g: NutrientProfile;
  nutrientSource: NutrientSource;
  quantitySource: QuantitySource;
  manualNutrients: NutrientKey[];
  foodId: string | null;
  sourceRef: FoodSourceRef | null;
  confidence: Confidence | null;
  cookingMethod: string | null;
  isAssumed: boolean;
  notes: string | null;
  portions: Portion[];
}

/** Favorite meal templates. Logging one copies its items, so later edits never rewrite history. */
export const savedMeals = pgTable("saved_meals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category"),
  items: jsonb("items").$type<SavedMealItem[]>().notNull(),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const chatConversations = pgTable("chat_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    /**
     * Exact API content blocks as a JSON string. Stored as text (not jsonb) so the
     * bytes replayed on later turns are identical to what the API returned.
     */
    content: text("content").notNull(),
    /** Text shown in the UI for this message. */
    displayText: text("display_text").notNull().default(""),
    /** Whether this message is shown in the transcript (tool-result turns are hidden). */
    visible: boolean("visible").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("chat_messages_seq_uq").on(t.conversationId, t.seq)],
);

export type AssistantActionType = "log_weight" | "update_goals" | "delete_meal" | "delete_weight_entry" | "open_food_logger";

/** Changes the assistant proposes. They run only after the user presses Confirm. */
export const assistantActions = pgTable("assistant_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => chatConversations.id, { onDelete: "cascade" }),
  type: text("type").$type<AssistantActionType>().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  summary: text("summary").notNull(),
  status: text("status").$type<"pending" | "confirmed" | "dismissed" | "failed">().notNull().default("pending"),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
});

// ===========================================================================
// Strength training (merged from the LiftLog workout tracker).
// Text ids keep LiftLog's original ids (e.g. "bi-barbell-bench-press", "w-…"),
// so importing the same LiftLog backup twice never creates duplicates.
// Deliberately no durations, timers or rest periods: progress is measured in
// sets, reps and weight only.
// ===========================================================================

export type MuscleGroup =
  | "chest" | "back" | "shoulders" | "biceps" | "triceps" | "forearms" | "traps"
  | "quads" | "hamstrings" | "glutes" | "calves" | "adductors" | "core" | "full body";
export type Equipment = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "smith machine" | "ez bar" | "trap bar" | "band" | "other";
export type ExerciseCategory = "compound" | "isolation";

export const exercises = pgTable("exercises", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  primaryMuscle: text("primary_muscle").$type<MuscleGroup>().notNull(),
  secondaryMuscles: jsonb("secondary_muscles").$type<MuscleGroup[]>().notNull().default([]),
  equipment: text("equipment").$type<Equipment>().notNull(),
  category: text("category").$type<ExerciseCategory>().notNull(),
  instructions: text("instructions").notNull().default(""),
  isCustom: boolean("is_custom").notNull().default(false),
  isFavorite: boolean("is_favorite").notNull().default(false),
  /** Archived exercises are hidden from pickers but keep their history. */
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type WorkoutStatus = "in_progress" | "completed";

export const workouts = pgTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    status: text("status").$type<WorkoutStatus>().notNull().default("in_progress"),
    notes: text("notes").notNull().default(""),
    templateId: text("template_id"),
    /** Unit used while logging (display only; sets are stored in kg). */
    unit: text("unit").$type<"kg" | "lb">().notNull(),
    /** Record keys already celebrated, so reopening a workout never re-celebrates. */
    celebratedRecordKeys: jsonb("celebrated_record_keys").$type<string[]>().notNull().default([]),
    source: text("source").$type<"app" | "liftlog">().notNull().default("app"),
    /** Provenance of imported workouts (original LiftLog fields), kept for fidelity, not shown as durations. */
    legacy: jsonb("legacy").$type<Record<string, unknown> | null>(),
    clientRequestId: text("client_request_id").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workouts_date_idx").on(t.localDate), check("workouts_status_ck", sql`${t.status} in ('in_progress', 'completed')`)],
);

export const workoutExercises = pgTable(
  "workout_exercises",
  {
    id: text("id").primaryKey(),
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id),
    position: integer("position").notNull().default(0),
    notes: text("notes").notNull().default(""),
  },
  (t) => [index("workout_exercises_workout_idx").on(t.workoutId, t.position)],
);

export type SetKind = "working" | "warmup";

export const workoutSets = pgTable(
  "workout_sets",
  {
    id: text("id").primaryKey(),
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    workoutExerciseId: text("workout_exercise_id")
      .notNull()
      .references(() => workoutExercises.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull(),
    position: integer("position").notNull().default(0),
    setNumber: integer("set_number").notNull().default(1),
    manualSetNumber: boolean("manual_set_number").notNull().default(false),
    weightKg: doublePrecision("weight_kg"),
    reps: integer("reps"),
    rpe: doublePrecision("rpe"),
    notes: text("notes").notNull().default(""),
    kind: text("kind").$type<SetKind>().notNull().default("working"),
    completed: boolean("completed").notNull().default(false),
    /** Targets copied from a template (reference only, never used in statistics). */
    targetWeightKg: doublePrecision("target_weight_kg"),
    targetReps: integer("target_reps"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("workout_sets_workout_idx").on(t.workoutId),
    index("workout_sets_exercise_idx").on(t.exerciseId),
    check("workout_sets_values_ck", sql`(${t.weightKg} is null or ${t.weightKg} >= 0) and (${t.reps} is null or ${t.reps} >= 0)`),
  ],
);

export interface TemplateItem {
  id: string;
  exerciseId: string;
  targetSets: number;
  targetReps: number | null;
  targetWeightKg: number | null;
  notes: string;
}

/** Saved workouts ("routines" in LiftLog). Starting one copies its items; edits never touch history. */
export const workoutTemplates = pgTable("workout_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes").notNull().default(""),
  items: jsonb("items").$type<TemplateItem[]>().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ===========================================================================
// Running: consistency and distance only (no duration, pace or timers).
// ===========================================================================

export type RunKind = "run" | "rest" | "recovery";

export const runEntries = pgTable(
  "run_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    /** "run" = a run; "rest"/"recovery" = a planned day off that never breaks a streak. */
    kind: text("kind").$type<RunKind>().notNull(),
    /** Canonical distance in meters; null when only completion was recorded. */
    distanceM: doublePrecision("distance_m"),
    inputDistance: doublePrecision("input_distance"),
    inputUnit: text("input_unit").$type<"mi" | "km" | null>(),
    runType: text("run_type"),
    /** Perceived effort 1–10. */
    effort: integer("effort"),
    notes: text("notes"),
    loggedAt: timestamp("logged_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    clientRequestId: text("client_request_id").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("run_entries_date_idx").on(t.localDate),
    uniqueIndex("run_entries_day_off_uq").on(t.localDate).where(sql`${t.kind} <> 'run'`),
    check("run_entries_kind_ck", sql`${t.kind} in ('run', 'rest', 'recovery')`),
    check("run_entries_effort_ck", sql`${t.effort} is null or (${t.effort} between 1 and 10)`),
    check("run_entries_distance_ck", sql`${t.distanceM} is null or ${t.distanceM} >= 0`),
  ],
);

// ===========================================================================
// Water
// ===========================================================================

export const waterLogs = pgTable(
  "water_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    amountMl: doublePrecision("amount_ml").notNull(),
    inputValue: doublePrecision("input_value").notNull(),
    inputUnit: text("input_unit").$type<"ml" | "oz">().notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    clientRequestId: text("client_request_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("water_logs_date_idx").on(t.localDate), check("water_logs_positive_ck", sql`${t.amountMl} > 0`)],
);

// ===========================================================================
// Phone health data (Apple Health / Health Connect) received through the
// token-authenticated ingest endpoint, plus manual entries.
// ===========================================================================

export type HealthMetric = "steps" | "sleep" | "sleep_score" | "resting_hr" | "hrv" | "active_energy";
export type HealthPlatform = "ios_shortcut" | "health_auto_export" | "android" | "other";

/** A device/app allowed to push health data. Only a SHA-256 hash of its token is stored. */
export const healthConnections = pgTable("health_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  platform: text("platform").$type<HealthPlatform>().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  /** Metrics this connection may write; anything else is ignored. */
  scopes: jsonb("scopes").$type<HealthMetric[]>().notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
});

export interface SleepDetails {
  inBedMinutes?: number | null;
  stages?: { deep?: number | null; rem?: number | null; core?: number | null; awake?: number | null; unspecified?: number | null } | null;
  start?: string | null;
  end?: string | null;
  /** Devices/apps the samples came from, as reported by the phone. */
  origins?: string[];
}

/**
 * One value per day, metric and source. A later sync for the same day replaces
 * the earlier value (phone totals only grow during the day), so repeated syncs
 * never duplicate data.
 */
export const healthDaily = pgTable(
  "health_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    metric: text("metric").$type<HealthMetric>().notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    /** Stable source key: "conn:<connection id>" or "manual". */
    source: text("source").notNull(),
    /** Human-readable source, e.g. "Apple Health (iPhone Shortcut)". */
    sourceLabel: text("source_label").notNull(),
    /** Originating device or app when reported (e.g. "Apple Watch", "Oura"). */
    origin: text("origin"),
    connectionId: uuid("connection_id").references(() => healthConnections.id, { onDelete: "set null" }),
    details: jsonb("details").$type<SleepDetails | Record<string, unknown> | null>(),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("health_daily_uq").on(t.localDate, t.metric, t.source), index("health_daily_metric_idx").on(t.metric, t.localDate)],
);

export const healthSyncEvents = pgTable(
  "health_sync_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").references(() => healthConnections.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    status: text("status").$type<"ok" | "partial" | "error">().notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    message: text("message"),
  },
  (t) => [index("health_sync_events_conn_idx").on(t.connectionId, t.receivedAt)],
);

// ===========================================================================
// Morning and nightly routines, mobility routines and journaling.
// ===========================================================================

export type RoutineSlot = "morning" | "night";
export type RoutineActivityKind = "mobility" | "reading" | "journal" | "checklist" | "count";

export interface JournalPrompt {
  id: string;
  text: string;
  enabled: boolean;
}

export interface RoutineActivityConfig {
  mobilityRoutineId?: string | null;
  prompts?: JournalPrompt[];
}

export const routineActivities = pgTable(
  "routine_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slot: text("slot").$type<RoutineSlot>().notNull(),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    kind: text("kind").$type<RoutineActivityKind>().notNull(),
    /** Required activities count toward the routine's completion percentage. */
    required: boolean("required").notNull().default(true),
    /** Optional completion target, e.g. 10 pages, 20 reps, 3 rounds. */
    targetValue: doublePrecision("target_value"),
    targetUnit: text("target_unit"),
    instructions: text("instructions"),
    config: jsonb("config").$type<RoutineActivityConfig>().notNull().default({}),
    /** History is judged against the activities that existed on each day. */
    activeFrom: date("active_from", { mode: "string" }).notNull(),
    archivedOn: date("archived_on", { mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("routine_activities_slot_idx").on(t.slot, t.position), check("routine_activities_slot_ck", sql`${t.slot} in ('morning', 'night')`)],
);

export interface MobilityItem {
  id: string;
  name: string;
  instructions: string;
  sets: number | null;
  reps: number | null;
  perSide: boolean;
  /** Free-form completion target, e.g. "5 slow breaths". */
  targetNote: string;
}

export const mobilityRoutines = pgTable("mobility_routines", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Organizational hint only; any routine can be used in either slot. */
  slot: text("slot").$type<RoutineSlot | null>(),
  items: jsonb("items").$type<MobilityItem[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export interface RoutineLogDetails {
  /** Mobility: ids of the items ticked off. */
  done?: string[];
  /** Reading: what was read. */
  title?: string | null;
  note?: string | null;
}

export const routineLogs = pgTable(
  "routine_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => routineActivities.id, { onDelete: "cascade" }),
    slot: text("slot").$type<RoutineSlot>().notNull(),
    completed: boolean("completed").notNull().default(false),
    value: doublePrecision("value"),
    details: jsonb("details").$type<RoutineLogDetails>().notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("routine_logs_day_activity_uq").on(t.localDate, t.activityId), index("routine_logs_date_idx").on(t.localDate, t.slot)],
);

export interface RoutineTemplateActivity {
  title: string;
  kind: RoutineActivityKind;
  required: boolean;
  targetValue: number | null;
  targetUnit: string | null;
  instructions: string | null;
  config: RoutineActivityConfig;
}

export const routineTemplates = pgTable("routine_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  slot: text("slot").$type<RoutineSlot>().notNull(),
  name: text("name").notNull(),
  activities: jsonb("activities").$type<RoutineTemplateActivity[]>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export interface JournalAnswer {
  promptId: string;
  prompt: string;
  answer: string;
}

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    slot: text("slot").$type<RoutineSlot>().notNull(),
    body: text("body").notNull().default(""),
    answers: jsonb("answers").$type<JournalAnswer[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("journal_entries_day_slot_uq").on(t.localDate, t.slot)],
);

// ===========================================================================
// Goals. Progress is never stored: it is computed from the underlying records,
// so logging a meal, workout, run or routine updates every goal immediately.
// ===========================================================================

export type GoalCategory = "nutrition" | "body" | "exercise" | "running" | "health" | "routine" | "custom";
export type GoalPeriod = "daily" | "weekly" | "monthly" | "custom";
export type GoalComparator = "at_least" | "at_most" | "range";
export type GoalStatus = "active" | "paused" | "completed" | "archived";

export interface GoalTargetVersion {
  from: string;
  value: number;
  max: number | null;
}

export const userGoals = pgTable(
  "user_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    category: text("category").$type<GoalCategory>().notNull(),
    metric: text("metric").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    comparator: text("comparator").$type<GoalComparator>().notNull(),
    targetValue: doublePrecision("target_value").notNull(),
    targetMax: doublePrecision("target_max"),
    unit: text("unit").notNull(),
    period: text("period").$type<GoalPeriod>().notNull(),
    /** Length of a custom period in days. */
    periodDays: integer("period_days"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    status: text("status").$type<GoalStatus>().notNull().default("active"),
    /** Paused spans are skipped when judging history and streaks. */
    pauses: jsonb("pauses").$type<{ from: string; to: string | null }[]>().notNull().default([]),
    /** Earlier targets, so changing a target never rewrites how past periods are judged. */
    targetHistory: jsonb("target_history").$type<GoalTargetVersion[]>().notNull().default([]),
    showOnDashboard: boolean("show_on_dashboard").notNull().default(true),
    position: integer("position").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("user_goals_period_ck", sql`${t.period} in ('daily', 'weekly', 'monthly', 'custom')`)],
);

/** Values for custom goals that are tracked by hand (e.g. "meditate", "no alcohol"). */
export const goalCheckins = pgTable(
  "goal_checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => userGoals.id, { onDelete: "cascade" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    value: doublePrecision("value").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("goal_checkins_goal_day_uq").on(t.goalId, t.localDate)],
);

export type Settings = typeof settings.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type WeightEntry = typeof weightEntries.$inferSelect;
export type Food = typeof foods.$inferSelect;
export type Meal = typeof meals.$inferSelect;
export type MealItem = typeof mealItems.$inferSelect;
export type MealAnalysis = typeof mealAnalyses.$inferSelect;
export type MealImage = typeof mealImages.$inferSelect;
export type SavedMeal = typeof savedMeals.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type AssistantAction = typeof assistantActions.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type WorkoutExercise = typeof workoutExercises.$inferSelect;
export type WorkoutSet = typeof workoutSets.$inferSelect;
export type WorkoutTemplate = typeof workoutTemplates.$inferSelect;
export type RunEntry = typeof runEntries.$inferSelect;
export type WaterLog = typeof waterLogs.$inferSelect;
export type HealthConnection = typeof healthConnections.$inferSelect;
export type HealthDaily = typeof healthDaily.$inferSelect;
export type HealthSyncEvent = typeof healthSyncEvents.$inferSelect;
export type RoutineActivity = typeof routineActivities.$inferSelect;
export type MobilityRoutine = typeof mobilityRoutines.$inferSelect;
export type RoutineLog = typeof routineLogs.$inferSelect;
export type RoutineTemplate = typeof routineTemplates.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type UserGoal = typeof userGoals.$inferSelect;
export type GoalCheckin = typeof goalCheckins.$inferSelect;
