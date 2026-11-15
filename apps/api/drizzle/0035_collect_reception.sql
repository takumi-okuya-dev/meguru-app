-- 集金管理の受付・受付の手伝い（specs/collect/001-event-day-collection data-model.md 2-4〜2-6、tasks.md T035・T046）。
-- 新しい表（受付の記録・受付用リンク・手伝う人・端末）を作り、名簿の人に飛び入りの送り直しの印（client_request_id。空でよい）と
-- 手伝う人への外部キーを足すだけ。今ある行は書き換えない。
CREATE TABLE "collect"."helper_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"helper_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helper_devices_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "collect"."helpers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helpers_name_length" CHECK (char_length("collect"."helpers"."name") BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "collect"."reception_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"token_iv" "bytea" NOT NULL,
	"token_key_version" smallint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reception_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "collect"."reception_records" (
	"roster_person_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"method" text NOT NULL,
	"price_tier_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"amount_overridden" boolean DEFAULT false NOT NULL,
	"receiver_kind" text NOT NULL,
	"receiver_helper_id" uuid,
	"payment_status" text NOT NULL,
	"transfer_confirmed_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_request_id" uuid NOT NULL,
	CONSTRAINT "reception_records_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "reception_records_method_valid" CHECK ("collect"."reception_records"."method" IN ('cash', 'paypay', 'transfer_today', 'transfer_later', 'none')),
	CONSTRAINT "reception_records_amount_range" CHECK ("collect"."reception_records"."amount" BETWEEN 0 AND 999999),
	CONSTRAINT "reception_records_none_is_free" CHECK ("collect"."reception_records"."method" <> 'none' OR "collect"."reception_records"."amount" = 0),
	CONSTRAINT "reception_records_receiver_kind_valid" CHECK ("collect"."reception_records"."receiver_kind" IN ('owner', 'helper')),
	CONSTRAINT "reception_records_receiver_pair" CHECK (("collect"."reception_records"."receiver_kind" = 'helper') = ("collect"."reception_records"."receiver_helper_id" IS NOT NULL)),
	CONSTRAINT "reception_records_payment_status_valid" CHECK ("collect"."reception_records"."payment_status" IN ('paid', 'awaiting_transfer')),
	CONSTRAINT "reception_records_awaiting_only_transfer" CHECK ("collect"."reception_records"."payment_status" = 'paid' OR "collect"."reception_records"."method" IN ('transfer_today', 'transfer_later'))
);
--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
ALTER TABLE "collect"."helper_devices" ADD CONSTRAINT "helper_devices_helper_id_helpers_id_fk" FOREIGN KEY ("helper_id") REFERENCES "collect"."helpers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."helpers" ADD CONSTRAINT "helpers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."helpers" ADD CONSTRAINT "helpers_link_id_reception_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "collect"."reception_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."reception_links" ADD CONSTRAINT "reception_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD CONSTRAINT "reception_records_roster_person_id_roster_people_id_fk" FOREIGN KEY ("roster_person_id") REFERENCES "collect"."roster_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD CONSTRAINT "reception_records_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD CONSTRAINT "reception_records_price_tier_id_price_tiers_id_fk" FOREIGN KEY ("price_tier_id") REFERENCES "collect"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD CONSTRAINT "reception_records_receiver_helper_id_helpers_id_fk" FOREIGN KEY ("receiver_helper_id") REFERENCES "collect"."helpers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helper_devices_helper_idx" ON "collect"."helper_devices" USING btree ("helper_id");--> statement-breakpoint
CREATE INDEX "helpers_event_idx" ON "collect"."helpers" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "helpers_link_name_key_idx" ON "collect"."helpers" USING btree ("link_id","name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reception_links_one_active_key" ON "collect"."reception_links" USING btree ("event_id") WHERE "collect"."reception_links"."stopped_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reception_records_event_idx" ON "collect"."reception_records" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "reception_records_price_tier_idx" ON "collect"."reception_records" USING btree ("price_tier_id");--> statement-breakpoint
CREATE INDEX "reception_records_receiver_helper_idx" ON "collect"."reception_records" USING btree ("receiver_helper_id");--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD CONSTRAINT "roster_people_added_by_helper_id_helpers_id_fk" FOREIGN KEY ("added_by_helper_id") REFERENCES "collect"."helpers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD CONSTRAINT "roster_people_client_request_id_unique" UNIQUE("client_request_id");