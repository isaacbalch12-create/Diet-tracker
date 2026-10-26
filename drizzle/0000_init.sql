CREATE TABLE "assistant_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"display_text" text DEFAULT '' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"data_type" text NOT NULL,
	"external_id" text,
	"description" text NOT NULL,
	"brand" text,
	"category" text,
	"nutrients_per_100g" jsonb NOT NULL,
	"portions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(description, '') || ' ' || coalesce(brand, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"calories" double precision,
	"protein" double precision,
	"carbs" double precision,
	"fat" double precision,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_effective_from_unique" UNIQUE("effective_from")
);
--> statement-breakpoint
CREATE TABLE "meal_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"input_type" text NOT NULL,
	"input_text" text,
	"image_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"model" text,
	"usage" jsonb,
	"meal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_analyses_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "meal_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text NOT NULL,
	"storage" text NOT NULL,
	"storage_key" text,
	"data" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"grams_per_unit" double precision NOT NULL,
	"nutrients_per_100g" jsonb NOT NULL,
	"nutrient_source" text NOT NULL,
	"quantity_source" text NOT NULL,
	"manual_nutrients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"food_id" uuid,
	"source_ref" jsonb,
	"confidence" text,
	"cooking_method" text,
	"is_assumed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"portions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_original" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_items_quantity_ck" CHECK ("meal_items"."quantity" > 0 and "meal_items"."grams_per_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"eaten_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source" text NOT NULL,
	"analysis_id" uuid,
	"client_request_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meals_client_request_id_unique" UNIQUE("client_request_id")
);
--> statement-breakpoint
CREATE TABLE "saved_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"items" jsonb NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"weight_unit" text DEFAULT 'lb' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"day_start_hour" integer DEFAULT 0 NOT NULL,
	"week_starts_on" integer DEFAULT 1 NOT NULL,
	"starting_weight_kg" double precision,
	"starting_weight_date" date,
	"target_weight_kg" double precision,
	"meal_categories" jsonb DEFAULT '["Breakfast","Lunch","Dinner","Snack"]'::jsonb NOT NULL,
	"reminders" jsonb DEFAULT '{"enabled":false,"morning":"07:30","night":"22:00"}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "weight_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"period" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"weight_kg" double precision NOT NULL,
	"input_value" double precision NOT NULL,
	"input_unit" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_entries_period_ck" CHECK ("weight_entries"."period" in ('morning', 'night')),
	CONSTRAINT "weight_entries_positive_ck" CHECK ("weight_entries"."weight_kg" > 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_images" ADD CONSTRAINT "meal_images_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_seq_uq" ON "chat_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_source_external_uq" ON "foods" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "foods_search_idx" ON "foods" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "meal_images_meal_idx" ON "meal_images" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX "meal_items_meal_idx" ON "meal_items" USING btree ("meal_id","position");--> statement-breakpoint
CREATE INDEX "meals_local_date_idx" ON "meals" USING btree ("local_date","eaten_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_entries_day_period_uq" ON "weight_entries" USING btree ("local_date","period");