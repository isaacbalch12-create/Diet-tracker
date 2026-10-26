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
export type NutrientSource = "database" | "ai_estimate" | "manual";
export type QuantitySource = "user_stated" | "ai_estimate" | "manual";
export type Confidence = "high" | "medium" | "low";
export type MealSource = "text" | "photo" | "manual" | "saved_meal" | "copy" | "assistant";

export interface Portion {
  label: string;
  grams: number;
}

export interface FoodSourceRef {
  provider: "usda" | "custom";
  fdcId?: string;
  dataType?: string;
  description: string;
}

export interface Reminders {
  enabled: boolean;
  morning: string; // HH:mm
  night: string; // HH:mm
}

export const DEFAULT_MEAL_CATEGORIES = ["Breakfast", "Lunch", "Dinner", "Snack"];

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
