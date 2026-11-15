CREATE TABLE "people"."threads_event_candidates" (
	"promotion_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"details_occurred_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people"."events" ADD COLUMN "source_threads_promotion_id" text;--> statement-breakpoint
CREATE INDEX "people_threads_event_candidates_user_idx" ON "people"."threads_event_candidates" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "people_events_user_source_threads_uq" ON "people"."events" USING btree ("user_id","source_threads_promotion_id");