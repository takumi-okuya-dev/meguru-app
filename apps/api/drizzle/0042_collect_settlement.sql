-- 集金管理の精算の手順（specs/collect/003-revenue-sharing User Story 4、data-model.md 1-4・1-5、research.md R10、tasks.md T033）。
-- 「渡した」ものと、手伝う人と運営メンバーの対応の表を作る。新しい表だけで、今ある行は書き換えない。
CREATE TABLE "collect"."settlement_holders" (
	"helper_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid
);
--> statement-breakpoint
CREATE TABLE "collect"."settlement_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"from_key" text NOT NULL,
	"from_name" text NOT NULL,
	"to_key" text NOT NULL,
	"to_name" text NOT NULL,
	"amount" integer NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_transfers_amount_range" CHECK ("collect"."settlement_transfers"."amount" BETWEEN 1 AND 99999999),
	CONSTRAINT "settlement_transfers_not_self" CHECK ("collect"."settlement_transfers"."from_key" <> "collect"."settlement_transfers"."to_key"),
	CONSTRAINT "settlement_transfers_key_length" CHECK (char_length("collect"."settlement_transfers"."from_key") BETWEEN 3 AND 80 AND char_length("collect"."settlement_transfers"."to_key") BETWEEN 3 AND 80),
	CONSTRAINT "settlement_transfers_name_length" CHECK (char_length("collect"."settlement_transfers"."from_name") BETWEEN 1 AND 40 AND char_length("collect"."settlement_transfers"."to_name") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "collect"."settlement_holders" ADD CONSTRAINT "settlement_holders_helper_id_helpers_id_fk" FOREIGN KEY ("helper_id") REFERENCES "collect"."helpers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."settlement_holders" ADD CONSTRAINT "settlement_holders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."settlement_holders" ADD CONSTRAINT "settlement_holders_member_id_sharing_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "collect"."sharing_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."settlement_transfers" ADD CONSTRAINT "settlement_transfers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_holders_event_idx" ON "collect"."settlement_holders" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "settlement_transfers_event_idx" ON "collect"."settlement_transfers" USING btree ("event_id","done_at");