CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"primary_muscle" text NOT NULL,
	"secondary_muscles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipment" text NOT NULL,
	"category" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"value" double precision NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "health_connections_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "health_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"source_label" text NOT NULL,
	"origin" text,
	"connection_id" uuid,
	"details" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"slot" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobility_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slot" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"target_value" double precision,
	"target_unit" text,
	"instructions" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_from" date NOT NULL,
	"archived_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routine_activities_slot_ck" CHECK ("routine_activities"."slot" in ('morning', 'night'))
);
--> statement-breakpoint
CREATE TABLE "routine_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"activity_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"value" double precision,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" text NOT NULL,
	"name" text NOT NULL,
	"activities" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"kind" text NOT NULL,
	"distance_m" double precision,
	"input_distance" double precision,
	"input_unit" text,
	"run_type" text,
	"effort" integer,
	"notes" text,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_entries_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "run_entries_kind_ck" CHECK ("run_entries"."kind" in ('run', 'rest', 'recovery')),
	CONSTRAINT "run_entries_effort_ck" CHECK ("run_entries"."effort" is null or ("run_entries"."effort" between 1 and 10)),
	CONSTRAINT "run_entries_distance_ck" CHECK ("run_entries"."distance_m" is null or "run_entries"."distance_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"metric" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comparator" text NOT NULL,
	"target_value" double precision NOT NULL,
	"target_max" double precision,
	"unit" text NOT NULL,
	"period" text NOT NULL,
	"period_days" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"pauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"show_on_dashboard" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_goals_period_ck" CHECK ("user_goals"."period" in ('daily', 'weekly', 'monthly', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "water_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"amount_ml" double precision NOT NULL,
	"input_value" double precision NOT NULL,
	"input_unit" text NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "water_logs_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "water_logs_positive_ck" CHECK ("water_logs"."amount_ml" > 0)
);
--> statement-breakpoint
CREATE TABLE "workout_exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"workout_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"workout_id" text NOT NULL,
	"workout_exercise_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"set_number" integer DEFAULT 1 NOT NULL,
	"manual_set_number" boolean DEFAULT false NOT NULL,
	"weight_kg" double precision,
	"reps" integer,
	"rpe" double precision,
	"notes" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'working' NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"target_weight_kg" double precision,
	"target_reps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sets_values_ck" CHECK (("workout_sets"."weight_kg" is null or "workout_sets"."weight_kg" >= 0) and ("workout_sets"."reps" is null or "workout_sets"."reps" >= 0))
);
--> statement-breakpoint
CREATE TABLE "workout_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"local_date" date NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"template_id" text,
	"unit" text NOT NULL,
	"celebrated_record_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"legacy" jsonb,
	"client_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "workouts_status_ck" CHECK ("workouts"."status" in ('in_progress', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "distance_unit" text DEFAULT 'mi' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "water_unit" text DEFAULT 'oz' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "one_rm_formula" text DEFAULT 'epley' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_reps_for_1rm" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "show_rpe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "run_types" jsonb DEFAULT '["Easy","Long","Tempo","Intervals","Hills","Recovery jog","Trail","Treadmill","Race"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "dashboard" jsonb DEFAULT '{"order":["overview","goals","nutrition","training","running","health","routines","insights","timeline"],"hidden":[],"tiles":["weight","calories","macros","water","workout","run","steps","sleep","morning","night"],"hiddenGoalIds":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "defaults_seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_goal_id_user_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."user_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_daily" ADD CONSTRAINT "health_daily_connection_id_health_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."health_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sync_events" ADD CONSTRAINT "health_sync_events_connection_id_health_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."health_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_logs" ADD CONSTRAINT "routine_logs_activity_id_routine_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."routine_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_exercise_id_workout_exercises_id_fk" FOREIGN KEY ("workout_exercise_id") REFERENCES "public"."workout_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_checkins_goal_day_uq" ON "goal_checkins" USING btree ("goal_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "health_daily_uq" ON "health_daily" USING btree ("local_date","metric","source");--> statement-breakpoint
CREATE INDEX "health_daily_metric_idx" ON "health_daily" USING btree ("metric","local_date");--> statement-breakpoint
CREATE INDEX "health_sync_events_conn_idx" ON "health_sync_events" USING btree ("connection_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_day_slot_uq" ON "journal_entries" USING btree ("local_date","slot");--> statement-breakpoint
CREATE INDEX "routine_activities_slot_idx" ON "routine_activities" USING btree ("slot","position");--> statement-breakpoint
CREATE UNIQUE INDEX "routine_logs_day_activity_uq" ON "routine_logs" USING btree ("local_date","activity_id");--> statement-breakpoint
CREATE INDEX "routine_logs_date_idx" ON "routine_logs" USING btree ("local_date","slot");--> statement-breakpoint
CREATE INDEX "run_entries_date_idx" ON "run_entries" USING btree ("local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "run_entries_day_off_uq" ON "run_entries" USING btree ("local_date") WHERE "run_entries"."kind" <> 'run';--> statement-breakpoint
CREATE INDEX "water_logs_date_idx" ON "water_logs" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "workout_exercises_workout_idx" ON "workout_exercises" USING btree ("workout_id","position");--> statement-breakpoint
CREATE INDEX "workout_sets_workout_idx" ON "workout_sets" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_sets_exercise_idx" ON "workout_sets" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workouts_date_idx" ON "workouts" USING btree ("local_date");