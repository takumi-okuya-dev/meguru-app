-- 集金管理のスキーマ collect と、PR1 の表（イベント・料金の区分・名簿・主催者の既定値・受け取った出来事）を作る
-- （specs/collect/001-event-day-collection data-model.md 2・5、tasks.md T012・T013）。表を足すだけで、今の表は変えない。
CREATE SCHEMA "collect";
--> statement-breakpoint
CREATE TABLE "collect"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"venue" text,
	"capacity" integer,
	"methods" text[] DEFAULT ARRAY['cash','paypay','transfer']::text[] NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_version" bigint,
	"paypay_checked_at" timestamp with time zone,
	"source_threads_promotion_id" text,
	"source_changed_at" timestamp with time zone,
	"source_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_name_length" CHECK (char_length("collect"."events"."name") BETWEEN 1 AND 100),
	CONSTRAINT "events_venue_length" CHECK (char_length("collect"."events"."venue") <= 100),
	CONSTRAINT "events_capacity_range" CHECK ("collect"."events"."capacity" BETWEEN 1 AND 10000),
	CONSTRAINT "events_ends_after_starts" CHECK ("collect"."events"."ends_at" IS NULL OR "collect"."events"."ends_at" > "collect"."events"."starts_at"),
	CONSTRAINT "events_methods_valid" CHECK (cardinality("collect"."events"."methods") >= 1 AND "collect"."events"."methods" <@ ARRAY['cash', 'paypay', 'transfer']::text[]),
	CONSTRAINT "events_next_number_positive" CHECK ("collect"."events"."next_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "collect"."owner_settings" (
	"owner_user_id" uuid PRIMARY KEY NOT NULL,
	"paypay_qr" "bytea",
	"paypay_qr_type" text,
	"bank_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_settings_paypay_qr_size" CHECK (octet_length("collect"."owner_settings"."paypay_qr") <= 307200),
	CONSTRAINT "owner_settings_paypay_qr_type_valid" CHECK ("collect"."owner_settings"."paypay_qr_type" IN ('image/png', 'image/jpeg')),
	CONSTRAINT "owner_settings_paypay_qr_pair" CHECK (("collect"."owner_settings"."paypay_qr" IS NULL) = ("collect"."owner_settings"."paypay_qr_type" IS NULL)),
	CONSTRAINT "owner_settings_bank_text_length" CHECK (char_length("collect"."owner_settings"."bank_text") <= 300)
);
--> statement-breakpoint
CREATE TABLE "collect"."price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "price_tiers_name_length" CHECK (char_length("collect"."price_tiers"."name") BETWEEN 1 AND 20),
	CONSTRAINT "price_tiers_amount_range" CHECK ("collect"."price_tiers"."amount" BETWEEN 0 AND 999999)
);
--> statement-breakpoint
CREATE TABLE "collect"."received_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"received_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collect"."roster_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"kana" text,
	"kana_key" text,
	"media" text NOT NULL,
	"price_tier_id" uuid NOT NULL,
	"memo" text,
	"added_by_helper_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_people_name_length" CHECK (char_length("collect"."roster_people"."name") BETWEEN 1 AND 50),
	CONSTRAINT "roster_people_kana_length" CHECK (char_length("collect"."roster_people"."kana") <= 50),
	CONSTRAINT "roster_people_memo_length" CHECK (char_length("collect"."roster_people"."memo") <= 200),
	CONSTRAINT "roster_people_media_valid" CHECK ("collect"."roster_people"."media" IN ('minato', 'kokuchpro', 'tunagate', 'jimoty', 'peatix', 'youtrust', 'walk_in', 'other')),
	CONSTRAINT "roster_people_number_positive" CHECK ("collect"."roster_people"."number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "collect"."price_tiers" ADD CONSTRAINT "price_tiers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD CONSTRAINT "roster_people_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD CONSTRAINT "roster_people_price_tier_id_price_tiers_id_fk" FOREIGN KEY ("price_tier_id") REFERENCES "collect"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "collect"."events" USING btree ("owner_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "price_tiers_event_idx" ON "collect"."price_tiers" USING btree ("event_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_people_event_number_key" ON "collect"."roster_people" USING btree ("event_id","number");--> statement-breakpoint
CREATE INDEX "roster_people_event_name_key_idx" ON "collect"."roster_people" USING btree ("event_id","name_key");--> statement-breakpoint
CREATE INDEX "roster_people_price_tier_idx" ON "collect"."roster_people" USING btree ("price_tier_id");