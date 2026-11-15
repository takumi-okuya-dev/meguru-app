-- 集金管理の売上・経費・紹介と、運営メンバーへの分配（specs/collect/003-revenue-sharing data-model.md、tasks.md T004）。
-- 新しい表（運営メンバー・経費・招待）を作り、名簿の人に紹介した人（空）、イベントのまとめに経費の合計と紹介あり（既定0）を足す。
-- 今ある行は書き換えない（どの行も新しい check を満たす）。
CREATE TABLE "collect"."expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" integer NOT NULL,
	"payer_member_id" uuid,
	"payer_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_range" CHECK ("collect"."expenses"."amount" BETWEEN 1 AND 999999),
	CONSTRAINT "expenses_name_length" CHECK (char_length("collect"."expenses"."name") BETWEEN 1 AND 40),
	CONSTRAINT "expenses_payer_name_length" CHECK (char_length("collect"."expenses"."payer_name") BETWEEN 1 AND 40),
	CONSTRAINT "expenses_payer_either" CHECK ("collect"."expenses"."payer_member_id" IS NULL OR "collect"."expenses"."payer_name" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "collect"."sharing_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sharing_invites_member_id_unique" UNIQUE("member_id"),
	CONSTRAINT "sharing_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "collect"."sharing_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"ratio_tenths" integer,
	"position" integer NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"user_id" uuid,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sharing_members_role_valid" CHECK ("collect"."sharing_members"."role" IN ('leader', 'member')),
	CONSTRAINT "sharing_members_ratio" CHECK (("collect"."sharing_members"."role" = 'leader' AND "collect"."sharing_members"."ratio_tenths" BETWEEN 10 AND 50) OR ("collect"."sharing_members"."role" = 'member' AND "collect"."sharing_members"."ratio_tenths" IS NULL)),
	CONSTRAINT "sharing_members_link_pair" CHECK (("collect"."sharing_members"."user_id" IS NULL) = ("collect"."sharing_members"."linked_at" IS NULL)),
	CONSTRAINT "sharing_members_name_length" CHECK (char_length("collect"."sharing_members"."name") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "collect"."event_summaries" ADD COLUMN "expense_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collect"."event_summaries" ADD COLUMN "referred" jsonb DEFAULT '{"count":0,"paid":0,"awaiting":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD COLUMN "referrer" text;--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD COLUMN "referrer_key" text;--> statement-breakpoint
ALTER TABLE "collect"."expenses" ADD CONSTRAINT "expenses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."expenses" ADD CONSTRAINT "expenses_payer_member_id_sharing_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "collect"."sharing_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."sharing_invites" ADD CONSTRAINT "sharing_invites_member_id_sharing_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "collect"."sharing_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collect"."sharing_members" ADD CONSTRAINT "sharing_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "collect"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_event_idx" ON "collect"."expenses" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "expenses_payer_member_idx" ON "collect"."expenses" USING btree ("payer_member_id");--> statement-breakpoint
CREATE INDEX "sharing_members_event_idx" ON "collect"."sharing_members" USING btree ("event_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sharing_members_event_user_key" ON "collect"."sharing_members" USING btree ("event_id","user_id") WHERE "collect"."sharing_members"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sharing_members_event_owner_key" ON "collect"."sharing_members" USING btree ("event_id") WHERE "collect"."sharing_members"."is_owner";--> statement-breakpoint
CREATE INDEX "sharing_members_user_idx" ON "collect"."sharing_members" USING btree ("user_id") WHERE "collect"."sharing_members"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "roster_people_event_referrer_idx" ON "collect"."roster_people" USING btree ("event_id","referrer_key");--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD CONSTRAINT "roster_people_referrer_length" CHECK (char_length("collect"."roster_people"."referrer") <= 40);--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD CONSTRAINT "roster_people_referrer_pair" CHECK (("collect"."roster_people"."referrer" IS NULL) = ("collect"."roster_people"."referrer_key" IS NULL));