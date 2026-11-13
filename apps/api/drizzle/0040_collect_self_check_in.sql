-- 集金管理のセルフ受付（specs/collect/002-self-check-in data-model.md、tasks.md T004）。
-- 新しい表（飛び入りの申し出・参加者の端末）を作り、受付用リンクに種類（既定 helper）、受付の記録に本人の申告の列（既定 false・空）を足し、
-- 受付の記録の check を「確かめ待ち」「本人の申告」を受ける形に直す。今ある行は書き換えない（どの行も新しい check を満たす）。
CREATE TABLE "collect"."self_check_in_devices" (
	"link_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"window_started_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"search_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "self_check_in_devices_link_id_device_hash_pk" PRIMARY KEY("link_id","device_hash")
);
--> statement-breakpoint
CREATE TABLE "collect"."self_check_in_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"kana" text,
	"device_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"roster_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "self_check_in_requests_status_valid" CHECK ("collect"."self_check_in_requests"."status" IN ('pending', 'accepted', 'matched', 'rejected')),
	CONSTRAINT "self_check_in_requests_name_length" CHECK (char_length("collect"."self_check_in_requests"."name") BETWEEN 1 AND 50),
	CONSTRAINT "self_check_in_requests_kana_length" CHECK (char_length("collect"."self_check_in_requests"."kana") <= 50)
);
--> statement-breakpoint
ALTER TABLE "collect"."reception_records" DROP CONSTRAINT "reception_records_awaiting_only_transfer";--> statement-breakpoint
ALTER TABLE "collect"."reception_records" DROP CONSTRAINT "reception_records_receiver_kind_valid";--> statement-breakpoint
ALTER TABLE "collect"."reception_records" DROP CONSTRAINT "reception_records_payment_status_valid";--> statement-breakpoint
DROP INDEX "collect"."reception_links_one_active_key";--> statement-breakpoint
ALTER TABLE "collect"."reception_links" ADD COLUMN "kind" text DEFAULT 'helper' NOT NULL;--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD COLUMN "self_reported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD COLUMN "self_device_hash" text;--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collect"."self_check_in_devices" ADD CONSTRAINT "self_check_in_devices_link_id_reception_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "collect"."reception_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."self_check_in_requests" ADD CONSTRAINT "self_check_in_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."self_check_in_requests" ADD CONSTRAINT "self_check_in_requests_link_id_reception_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "collect"."reception_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."self_check_in_requests" ADD CONSTRAINT "self_check_in_requests_roster_person_id_roster_people_id_fk" FOREIGN KEY ("roster_person_id") REFERENCES "collect"."roster_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "self_check_in_requests_event_idx" ON "collect"."self_check_in_requests" USING btree ("event_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "self_check_in_requests_one_pending_key" ON "collect"."self_check_in_requests" USING btree ("link_id","device_hash") WHERE "collect"."self_check_in_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "reception_links_one_active_key" ON "collect"."reception_links" USING btree ("event_id","kind") WHERE "collect"."reception_links"."stopped_at" IS NULL;--> statement-breakpoint
ALTER TABLE "collect"."reception_links" ADD CONSTRAINT "reception_links_kind_valid" CHECK ("collect"."reception_links"."kind" IN ('helper', 'self'));--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD CONSTRAINT "reception_records_payment_status_pair" CHECK ("collect"."reception_records"."payment_status" = 'paid'
        OR ("collect"."reception_records"."payment_status" = 'awaiting_transfer' AND "collect"."reception_records"."method" IN ('transfer_today', 'transfer_later'))
        OR ("collect"."reception_records"."payment_status" = 'awaiting_confirmation' AND "collect"."reception_records"."method" IN ('cash', 'paypay') AND "collect"."reception_records"."receiver_kind" = 'self'));--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD CONSTRAINT "reception_records_self_receiver" CHECK ("collect"."reception_records"."receiver_kind" <> 'self' OR "collect"."reception_records"."self_reported");--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD CONSTRAINT "reception_records_receiver_kind_valid" CHECK ("collect"."reception_records"."receiver_kind" IN ('owner', 'helper', 'self'));--> statement-breakpoint
ALTER TABLE "collect"."reception_records" ADD CONSTRAINT "reception_records_payment_status_valid" CHECK ("collect"."reception_records"."payment_status" IN ('paid', 'awaiting_transfer', 'awaiting_confirmation'));