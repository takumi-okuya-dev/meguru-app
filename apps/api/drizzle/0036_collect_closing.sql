-- 集金管理の締め・イベントのまとめ（specs/collect/001-event-day-collection data-model.md 2-7・2-9、tasks.md T057・T069）。
-- 新しい表（精算・イベントのまとめ）を作るだけ。今の表は変えない。
CREATE TABLE "collect"."event_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"roster_count" integer NOT NULL,
	"attended_count" integer NOT NULL,
	"by_method" jsonb NOT NULL,
	"by_media" jsonb NOT NULL,
	"awaiting_transfer" jsonb NOT NULL,
	"event_deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collect"."settlements" (
	"event_id" uuid NOT NULL,
	"receiver_key" text NOT NULL,
	"counted_amount" integer,
	"settled_at" timestamp with time zone,
	"expected_at_settle" integer,
	CONSTRAINT "settlements_event_id_receiver_key_pk" PRIMARY KEY("event_id","receiver_key"),
	CONSTRAINT "settlements_counted_amount_range" CHECK ("collect"."settlements"."counted_amount" >= 0),
	CONSTRAINT "settlements_settled_pair" CHECK (("collect"."settlements"."settled_at" IS NULL) = ("collect"."settlements"."expected_at_settle" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "collect"."settlements" ADD CONSTRAINT "settlements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_summaries_owner_idx" ON "collect"."event_summaries" USING btree ("owner_user_id","starts_at");